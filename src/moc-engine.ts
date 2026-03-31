import { App, TFile, Notice, getAllTags } from "obsidian";
import {
	MocMode,
	MocParams,
	MocGeneratorSettings,
	NoteInfo,
	SortBy,
} from "./types";

interface NoteEntry {
	file: TFile;
	depth: number;
}

export class MocEngine {
	private app: App;
	private settings: MocGeneratorSettings;
	private cachedIndex: Map<string, NoteInfo[]> | null = null;

	constructor(app: App, settings: MocGeneratorSettings) {
		this.app = app;
		this.settings = settings;
	}

	invalidateCache(): void {
		this.cachedIndex = null;
	}

	private escapeRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// Fix 3a: exact tag match, supports nested tags (e.g. #moc won't match #moc-advanced)
	checkTagExist(file: TFile, tag: string): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return false;
		const tags = getAllTags(cache);
		if (!tags) return false;
		const normalized = tag.startsWith("#") ? tag : "#" + tag;
		return tags.some(
			(t) => t === normalized || t.startsWith(normalized + "/")
		);
	}

	// Fix 3b: multiple up values, Fix 5b: whitespace, 2a: multiple properties, 3c: caching
	private async buildChildrenIndex(): Promise<Map<string, NoteInfo[]>> {
		if (this.cachedIndex) return this.cachedIndex;

		const index = new Map<string, NoteInfo[]>();
		const allFiles = this.app.vault.getMarkdownFiles();
		const upProps = this.settings.upProperties;

		for (const file of allFiles) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const parentLinks: string[] = [];

			// Check all up properties in YAML frontmatter
			for (const upProp of upProps) {
				const raw = fm?.[upProp];
				if (raw) {
					const values = Array.isArray(raw) ? raw : [raw];
					for (const v of values) {
						if (typeof v === "string") parentLinks.push(v);
					}
				}
			}

			// Fallback to inline fields if no YAML links found
			if (parentLinks.length === 0) {
				const content = await this.app.vault.cachedRead(file);
				for (const upProp of upProps) {
					// Fix 5b: permissive whitespace in inline field regex
					const inlineRegex = new RegExp(
						`^\\s*${this.escapeRegex(upProp)}\\s*::\\s*(.+)$`,
						"m"
					);
					const match = content.match(inlineRegex);
					if (match) {
						parentLinks.push(match[1].trim());
					}
				}
			}

			// Resolve each parent link
			for (const linkRaw of parentLinks) {
				// Extract all [[...]] links from the value
				const linkMatches = [
					...linkRaw.matchAll(/\[\[(.+?)(?:\|.*?)?\]\]/g),
				];
				const linktexts =
					linkMatches.length > 0
						? linkMatches.map((m) => m[1])
						: [linkRaw];

				for (const linktext of linktexts) {
					const resolved =
						this.app.metadataCache.getFirstLinkpathDest(
							linktext,
							file.path
						);
					if (!resolved) continue;

					const parentPath = resolved.path;
					if (!index.has(parentPath)) {
						index.set(parentPath, []);
					}
					index.get(parentPath)!.push({
						file,
						priority: fm?.priority ?? Infinity,
					});
				}
			}
		}

		this.cachedIndex = index;
		return index;
	}

	// 2d: configurable sorting
	private sortNoteInfos(
		notes: NoteInfo[],
		sortBy: SortBy,
		customField?: string
	): void {
		notes.sort((a, b) => {
			switch (sortBy) {
				case "priority":
					if (a.priority !== b.priority)
						return a.priority - b.priority;
					return a.file.basename.localeCompare(b.file.basename);
				case "alphabetical":
					return a.file.basename.localeCompare(b.file.basename);
				case "created":
					return a.file.stat.ctime - b.file.stat.ctime;
				case "modified":
					return a.file.stat.mtime - b.file.stat.mtime;
				case "custom": {
					if (!customField) return 0;
					const aVal =
						this.app.metadataCache.getFileCache(a.file)
							?.frontmatter?.[customField] ?? "";
					const bVal =
						this.app.metadataCache.getFileCache(b.file)
							?.frontmatter?.[customField] ?? "";
					return String(aVal).localeCompare(String(bVal));
				}
				default:
					return 0;
			}
		});
	}

	private listLinksRecursive(
		notes: NoteEntry[],
		processed: string[],
		fileToProcess: TFile,
		params: MocParams,
		depth: number,
		index: Map<string, NoteInfo[]>
	): void {
		const children = [...(index.get(fileToProcess.path) ?? [])];
		const sortBy = params.sort ?? this.settings.defaultSort;
		const customField =
			params.customSortField ?? this.settings.customSortField;
		this.sortNoteInfos(children, sortBy, customField);

		for (const info of children) {
			if (processed.includes(info.file.path)) continue;
			processed.push(info.file.path);

			// Skip if embedded mode and page has embIgnoreTag
			if (params.mode === "embedded") {
				if (
					this.checkTagExist(info.file, this.settings.embIgnoreTag)
				) {
					continue;
				}
			}

			notes.push({ file: info.file, depth });

			// Depth limits (0 = unlimited)
			// depth=1 means only direct children (current depth 0), no recursion
			// depth=2 means children + grandchildren, etc.
			if (params.depth > 0 && depth + 1 >= params.depth) {
				continue;
			}

			// Don't go deeper if non-ignore-block and page has mocBlockTag
			if (!params.ignoreBlock) {
				if (
					this.checkTagExist(info.file, this.settings.mocBlockTag)
				) {
					continue;
				}
			}

			this.listLinksRecursive(
				notes,
				processed,
				info.file,
				params,
				depth + 1,
				index
			);
		}
	}

	// 2b: folder-scoped MOCs
	private collectFolderNotes(folderPath: string): NoteEntry[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => {
				const parent = f.parent?.path ?? "";
				return (
					parent === folderPath ||
					parent.startsWith(folderPath + "/")
				);
			})
			.map((f) => ({ file: f, depth: 0 }));
	}

	// 2c: tag-scoped MOCs
	private collectTagNotes(tag: string): NoteEntry[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => this.checkTagExist(f, tag))
			.map((f) => ({ file: f, depth: 0 }));
	}

	// 2e: include/exclude filters
	private applyFilters(
		notes: NoteEntry[],
		params: MocParams
	): NoteEntry[] {
		let result = notes;
		if (params.include) {
			result = result.filter((n) =>
				this.checkTagExist(n.file, params.include!)
			);
		}
		if (params.exclude) {
			result = result.filter(
				(n) => !this.checkTagExist(n.file, params.exclude!)
			);
		}
		return result;
	}

	private makeMarkdownList(notes: NoteEntry[]): string {
		let mocText = "";
		for (const n of notes) {
			for (let step = 0; step < n.depth; step++) {
				mocText += "\t";
			}
			mocText += "- [[" + n.file.basename + "]]\n";
		}
		return mocText;
	}

	private makeEmbeddedMarkdownList(notes: NoteEntry[]): string {
		let mocText = "";
		for (const n of notes) {
			for (let step = 0; step < n.depth; step++) {
				mocText += "#";
			}
			mocText += " " + n.file.basename + "\n\n";
			mocText += "![[" + n.file.basename + "]]\n\n";
		}
		return mocText;
	}

	private makeMoc(notes: NoteEntry[], params: MocParams): string {
		switch (params.mode) {
			case "list":
			case "folder":
			case "tag":
				return this.makeMarkdownList(notes);
			case "embedded":
				return this.makeEmbeddedMarkdownList(notes);
			default:
				new Notice("Unknown MOC mode: " + params.mode);
				return "";
		}
	}

	// 1a: new marker format with serialization
	private serializeMarkerParams(params: MocParams): string {
		const parts: string[] = [params.mode.toUpperCase()];
		if (params.depth > 0) parts.push(`DEPTH=${params.depth}`);
		if (params.ignoreBlock) parts.push("IGNORE-BLOCK");
		if (params.sort) parts.push(`SORT=${params.sort.toUpperCase()}`);
		if (params.include) parts.push(`INCLUDE=${params.include}`);
		if (params.exclude) parts.push(`EXCLUDE=${params.exclude}`);
		if (params.folderPath) parts.push(`PATH=${params.folderPath}`);
		if (params.tagFilter) parts.push(`TAG=${params.tagFilter}`);
		return parts.join(" ");
	}

	// 1a: backward-compat parsing of old markers + new format
	parseMarkerParams(raw: string): MocParams {
		const tokens = raw.trim().split(/\s+/);
		const first = tokens[0];

		// Backward compat: old-style compound types (with underscore)
		const legacyMap: Record<string, MocParams> = {
			LIST_IGNORE_BLOCK: { mode: "list", depth: 0, ignoreBlock: true },
			LIST_1: { mode: "list", depth: 1, ignoreBlock: false },
			LIST_1_IGNORE_BLOCK: {
				mode: "list",
				depth: 1,
				ignoreBlock: true,
			},
			LIST_2: { mode: "list", depth: 2, ignoreBlock: false },
			LIST_2_IGNORE_BLOCK: {
				mode: "list",
				depth: 2,
				ignoreBlock: true,
			},
			LIST_3: { mode: "list", depth: 3, ignoreBlock: false },
			LIST_3_IGNORE_BLOCK: {
				mode: "list",
				depth: 3,
				ignoreBlock: true,
			},
		};

		if (first in legacyMap) {
			return { ...legacyMap[first] };
		}

		// New format
		const params: MocParams = {
			mode: (first.toLowerCase() as MocMode) || "list",
			depth: 0,
			ignoreBlock: false,
		};

		for (let i = 1; i < tokens.length; i++) {
			const lower = tokens[i].toLowerCase();
			if (lower === "ignore-block") {
				params.ignoreBlock = true;
			} else if (lower.startsWith("depth=")) {
				params.depth = parseInt(lower.slice(6)) || 0;
			} else if (lower.startsWith("sort=")) {
				params.sort = lower.slice(5) as SortBy;
			} else if (lower.startsWith("include=")) {
				params.include = tokens[i].slice(8);
			} else if (lower.startsWith("exclude=")) {
				params.exclude = tokens[i].slice(8);
			} else if (lower.startsWith("path=")) {
				params.folderPath = tokens[i].slice(5);
			} else if (lower.startsWith("tag=")) {
				params.tagFilter = tokens[i].slice(4);
			}
		}

		return params;
	}

	private makeMarkers(
		fileName: string,
		mocText: string,
		params: MocParams
	): string {
		const paramStr = this.serializeMarkerParams(params);
		return `%% START MOC ${paramStr} [[${fileName}]] %%\n\n${mocText}\n%% END MOC %%`;
	}

	async addMocTag(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: any) => {
			if (!fm.tags) {
				fm.tags = [];
			}
			if (fm.tags.indexOf(this.settings.mocTag) === -1) {
				fm.tags.push(this.settings.mocTag);
			}
		});
	}

	// Core note generation for any mode
	private async generateNotes(
		file: TFile,
		params: MocParams,
		index: Map<string, NoteInfo[]>
	): Promise<NoteEntry[]> {
		let notes: NoteEntry[];

		if (params.mode === "folder") {
			const folderPath = params.folderPath ?? file.parent?.path ?? "";
			notes = this.collectFolderNotes(folderPath);
			notes = notes.filter((n) => n.file.path !== file.path);
			const noteInfos = notes.map((n) => ({
				file: n.file,
				priority:
					this.app.metadataCache.getFileCache(n.file)?.frontmatter
						?.priority ?? Infinity,
			}));
			this.sortNoteInfos(
				noteInfos,
				params.sort ?? this.settings.defaultSort,
				params.customSortField ?? this.settings.customSortField
			);
			notes = noteInfos.map((ni) => ({ file: ni.file, depth: 0 }));
		} else if (params.mode === "tag") {
			const tag = params.tagFilter ?? "";
			notes = this.collectTagNotes(tag);
			notes = notes.filter((n) => n.file.path !== file.path);
			const noteInfos = notes.map((n) => ({
				file: n.file,
				priority:
					this.app.metadataCache.getFileCache(n.file)?.frontmatter
						?.priority ?? Infinity,
			}));
			this.sortNoteInfos(
				noteInfos,
				params.sort ?? this.settings.defaultSort,
				params.customSortField ?? this.settings.customSortField
			);
			notes = noteInfos.map((ni) => ({ file: ni.file, depth: 0 }));
		} else {
			notes = [];
			const processed: string[] = [];
			this.listLinksRecursive(
				notes,
				processed,
				file,
				params,
				0,
				index
			);
		}

		notes = this.applyFilters(notes, params);
		return notes;
	}

	async generateMoc(file: TFile, params: MocParams): Promise<string> {
		const index = await this.buildChildrenIndex();
		const notes = await this.generateNotes(file, params, index);
		const mocText = this.makeMoc(notes, params);
		return this.makeMarkers(file.basename, mocText, params);
	}

	async insertMoc(file: TFile, params: MocParams): Promise<string> {
		await this.addMocTag(file);
		return this.generateMoc(file, params);
	}

	// 3d: deduplicated update logic
	private async updateMocInFile(
		file: TFile,
		index: Map<string, NoteInfo[]>
	): Promise<boolean> {
		let text = await this.app.vault.read(file);

		const regex =
			/%% START MOC (.+?) \[\[(.*?)\]\] %%\n([\s\S]*?)\n%% END MOC %%/g;
		const matches = [...text.matchAll(regex)];

		if (matches.length === 0) {
			// Only add moc tag when creating new markers
			await this.addMocTag(file);
			// Re-read after frontmatter modification
			text = await this.app.vault.read(file);
			const params: MocParams = {
				mode: "list",
				depth: this.settings.defaultDepth,
				ignoreBlock: this.settings.defaultIgnoreBlock,
			};
			const notes = await this.generateNotes(file, params, index);
			const mocText = this.makeMoc(notes, params);
			const markers = this.makeMarkers(file.basename, mocText, params);
			text = text.trimEnd() + "\n\n" + markers;
			await this.app.vault.modify(file, text);
			return true;
		}

		for (const match of matches) {
			const rawParams = match[1];
			const noteName = match[2];
			const params = this.parseMarkerParams(rawParams);

			const noteFile = this.app.metadataCache.getFirstLinkpathDest(
				noteName,
				file.path
			);
			if (!noteFile) {
				new Notice("MOC: Cannot find note: " + noteName);
				continue;
			}

			const notes = await this.generateNotes(noteFile, params, index);
			const mocText = this.makeMoc(notes, params);
			const replacement = this.makeMarkers(noteName, mocText, params);
			text = text.replace(match[0], replacement);
		}

		await this.app.vault.modify(file, text);
		return true;
	}

	async updateMoc(file: TFile): Promise<boolean> {
		const index = await this.buildChildrenIndex();
		return this.updateMocInFile(file, index);
	}

	async updateAllMocs(): Promise<number> {
		const index = await this.buildChildrenIndex();
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => this.checkTagExist(file, this.settings.mocTag));

		for (const file of files) {
			await this.updateMocInFile(file, index);
		}

		return files.length;
	}

	// 4c: status bar helper
	getChildCount(file: TFile): number | null {
		if (!this.cachedIndex) return null;
		const children = this.cachedIndex.get(file.path);
		return children ? children.length : 0;
	}

	private async resolveParentLinks(file: TFile): Promise<string[]> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const parentLinks: string[] = [];

		for (const upProp of this.settings.upProperties) {
			const raw = fm?.[upProp];
			if (raw) {
				const values = Array.isArray(raw) ? raw : [raw];
				for (const v of values) {
					if (typeof v === "string") parentLinks.push(v);
				}
			}
		}

		// Fallback to inline fields
		if (parentLinks.length === 0) {
			const content = await this.app.vault.cachedRead(file);
			for (const upProp of this.settings.upProperties) {
				const inlineRegex = new RegExp(
					`^\\s*${this.escapeRegex(upProp)}\\s*::\\s*(.+)$`,
					"m"
				);
				const match = content.match(inlineRegex);
				if (match) {
					parentLinks.push(match[1].trim());
				}
			}
		}

		return parentLinks;
	}

	private resolveLinksToFiles(parentLinks: string[], sourcePath: string): TFile[] {
		const results: TFile[] = [];
		for (const linkRaw of parentLinks) {
			const linkMatches = [...linkRaw.matchAll(/\[\[(.+?)(?:\|.*?)?\]\]/g)];
			const linktexts = linkMatches.length > 0
				? linkMatches.map((m) => m[1])
				: [linkRaw];

			for (const linktext of linktexts) {
				const resolved = this.app.metadataCache.getFirstLinkpathDest(
					linktext,
					sourcePath
				);
				if (resolved) {
					results.push(resolved);
				}
			}
		}
		return results;
	}

	async getParentFiles(file: TFile): Promise<TFile[]> {
		const parentLinks = await this.resolveParentLinks(file);
		return this.resolveLinksToFiles(parentLinks, file.path);
	}

	async getParentMocs(file: TFile): Promise<TFile[]> {
		const allParents = await this.getParentFiles(file);
		return allParents.filter((f) => this.checkTagExist(f, this.settings.mocTag));
	}

	async getAncestorChain(file: TFile): Promise<TFile[]> {
		const chain: TFile[] = [];
		const visited = new Set<string>();
		visited.add(file.path);

		let current = file;
		while (true) {
			const parents = await this.getParentFiles(current);
			if (parents.length === 0) break;
			const parent = parents[0];
			if (visited.has(parent.path)) break;
			visited.add(parent.path);
			chain.push(parent);
			current = parent;
		}
		return chain;
	}

	getParentsFromCache(filePath: string): TFile[] {
		if (!this.cachedIndex) return [];
		const parents: TFile[] = [];
		for (const [parentPath, children] of this.cachedIndex) {
			if (children.some((c) => c.file.path === filePath)) {
				const parentFile = this.app.vault.getAbstractFileByPath(parentPath);
				if (parentFile instanceof TFile) {
					parents.push(parentFile);
				}
			}
		}
		return parents;
	}

	async findOrphans(): Promise<TFile[]> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const orphans: TFile[] = [];
		for (const file of allFiles) {
			if (this.checkTagExist(file, this.settings.mocTag)) continue;
			const parents = await this.getParentFiles(file);
			if (parents.length === 0) {
				orphans.push(file);
			}
		}
		orphans.sort((a, b) => a.basename.localeCompare(b.basename));
		return orphans;
	}

	async getIndex(): Promise<Map<string, NoteInfo[]>> {
		return this.buildChildrenIndex();
	}

	async getMaxChildPriority(file: TFile): Promise<number> {
		const index = await this.buildChildrenIndex();
		const children = index.get(file.path) ?? [];
		let max = 0;
		for (const child of children) {
			if (child.priority !== Infinity && child.priority > max) {
				max = child.priority;
			}
		}
		return max;
	}

	async getDirectChildren(file: TFile): Promise<NoteInfo[]> {
		const index = await this.buildChildrenIndex();
		const children = [...(index.get(file.path) ?? [])];
		this.sortNoteInfos(children, "priority");
		return children;
	}

	async getChildrenTree(rootFile: TFile): Promise<{ parent: TFile; children: NoteInfo[] }[]> {
		const index = await this.buildChildrenIndex();
		const directChildren = [...(index.get(rootFile.path) ?? [])];
		this.sortNoteInfos(directChildren, "priority");

		const groups: { parent: TFile; children: NoteInfo[] }[] = [
			{ parent: rootFile, children: directChildren },
		];

		for (const child of directChildren) {
			if (this.checkTagExist(child.file, this.settings.mocTag)) {
				const subChildren = [...(index.get(child.file.path) ?? [])];
				this.sortNoteInfos(subChildren, "priority");
				if (subChildren.length > 0) {
					groups.push({ parent: child.file, children: subChildren });
				}
			}
		}

		return groups;
	}

	async renumberPriorities(items: { file: TFile; newPriority: number }[]): Promise<void> {
		for (const item of items) {
			await this.app.fileManager.processFrontMatter(item.file, (fm: any) => {
				fm.priority = item.newPriority;
			});
		}
		this.invalidateCache();
	}

	// 2.3: Check if a MOC's marker content is stale compared to current index
	async isMocStale(file: TFile): Promise<boolean> {
		if (!this.checkTagExist(file, this.settings.mocTag)) return false;

		const content = await this.app.vault.cachedRead(file);
		const regex = /%% START MOC (.+?) \[\[(.*?)\]\] %%\n([\s\S]*?)\n%% END MOC %%/g;
		const matches = [...content.matchAll(regex)];
		if (matches.length === 0) return false;

		const index = await this.buildChildrenIndex();

		for (const match of matches) {
			const rawParams = match[1];
			const noteName = match[2];
			const params = this.parseMarkerParams(rawParams);

			const noteFile = this.app.metadataCache.getFirstLinkpathDest(noteName, file.path);
			if (!noteFile) continue;

			const notes = await this.generateNotes(noteFile, params, index);
			const expected = this.makeMoc(notes, params);
			const actual = match[3];

			if (expected.trim() !== actual.trim()) return true;
		}
		return false;
	}

	// 4.2: Find likely parent for a new file based on folder/links
	async findLikelyParent(file: TFile): Promise<TFile | null> {
		// Strategy 1: Check if the file's folder matches a MOC's folder
		const folder = file.parent?.path ?? "";
		const allFiles = this.app.vault.getMarkdownFiles();

		for (const f of allFiles) {
			if (f.path === file.path) continue;
			if (!this.checkTagExist(f, this.settings.mocTag)) continue;
			if (f.parent?.path === folder) return f;
		}

		// Strategy 2: Check if any outgoing links point to a MOC
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.links) {
			for (const link of cache.links) {
				const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
				if (target && this.checkTagExist(target, this.settings.mocTag)) {
					return target;
				}
			}
		}

		return null;
	}

	// Get all descendants as a flat list
	async getDescendantsFlat(file: TFile): Promise<TFile[]> {
		const index = await this.buildChildrenIndex();
		const result: TFile[] = [];
		const visited = new Set<string>();
		visited.add(file.path);

		const collect = (parentPath: string) => {
			const children = index.get(parentPath) ?? [];
			for (const child of children) {
				if (visited.has(child.file.path)) continue;
				visited.add(child.file.path);
				result.push(child.file);
				collect(child.file.path);
			}
		};

		collect(file.path);
		return result;
	}

	// 1.3: Check if a file has moc-auto-update disabled in frontmatter
	isAutoUpdateDisabled(file: TFile): boolean {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return fm?.["moc-auto-update"] === false;
	}

	async removeMocTag(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: any) => {
			if (Array.isArray(fm.tags)) {
				fm.tags = fm.tags.filter((t: string) => t !== this.settings.mocTag);
			}
		});
	}

	async removeMocMarkers(file: TFile): Promise<void> {
		let content = await this.app.vault.read(file);
		content = content.replace(/%% START MOC .+? \[\[.*?\]\] %%\n[\s\S]*?\n%% END MOC %%\n?/g, "");
		await this.app.vault.modify(file, content.trimEnd() + "\n");
	}

	async getSiblings(file: TFile): Promise<{ prev: TFile | null; next: TFile | null }> {
		const parents = await this.getParentFiles(file);
		if (parents.length === 0) return { prev: null, next: null };
		const children = await this.getDirectChildren(parents[0]);
		const idx = children.findIndex(c => c.file.path === file.path);
		return {
			prev: idx > 0 ? children[idx - 1].file : null,
			next: idx < children.length - 1 ? children[idx + 1].file : null,
		};
	}

	getParentCountFromCache(filePath: string): number {
		if (!this.cachedIndex) return 0;
		let count = 0;
		for (const children of this.cachedIndex.values()) {
			if (children.some(c => c.file.path === filePath)) count++;
		}
		return count;
	}

	async getStats(): Promise<{
		totalNotes: number;
		totalMocs: number;
		orphanCount: number;
		staleMocCount: number;
		maxDepth: number;
		largestMoc: { file: TFile; count: number } | null;
	}> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const index = await this.buildChildrenIndex();

		let totalMocs = 0;
		let orphanCount = 0;
		let staleMocCount = 0;
		let largestMoc: { file: TFile; count: number } | null = null;

		for (const file of allFiles) {
			const isMoc = this.checkTagExist(file, this.settings.mocTag);
			if (isMoc) {
				totalMocs++;
				const children = index.get(file.path) ?? [];
				if (!largestMoc || children.length > largestMoc.count) {
					largestMoc = { file, count: children.length };
				}
				const stale = await this.isMocStale(file);
				if (stale) staleMocCount++;
			} else {
				const parents = await this.getParentFiles(file);
				if (parents.length === 0) orphanCount++;
			}
		}

		// Compute max depth
		let maxDepth = 0;
		const computeDepth = async (file: TFile, visited: Set<string>): Promise<number> => {
			const children = index.get(file.path) ?? [];
			let max = 0;
			for (const child of children) {
				if (visited.has(child.file.path)) continue;
				visited.add(child.file.path);
				const d = await computeDepth(child.file, visited);
				if (d > max) max = d;
			}
			return max + (children.length > 0 ? 1 : 0);
		};

		// Only compute from roots to avoid redundancy
		for (const file of allFiles) {
			if (!this.checkTagExist(file, this.settings.mocTag)) continue;
			const parents = await this.getParentFiles(file);
			if (parents.length === 0) {
				const d = await computeDepth(file, new Set([file.path]));
				if (d > maxDepth) maxDepth = d;
			}
		}

		return {
			totalNotes: allFiles.length,
			totalMocs,
			orphanCount,
			staleMocCount,
			maxDepth,
			largestMoc,
		};
	}

	async updateNoteParent(note: TFile, oldParent: TFile, newParent: TFile): Promise<void> {
		const upProp = this.settings.upProperties[0] || "up";
		const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;

		if (fm?.[upProp] !== undefined) {
			// Update in YAML frontmatter
			await this.app.fileManager.processFrontMatter(note, (fmData: any) => {
				const raw = fmData[upProp];
				if (typeof raw === "string") {
					fmData[upProp] = raw.replace(
						`[[${oldParent.basename}]]`,
						`[[${newParent.basename}]]`
					);
				} else if (Array.isArray(raw)) {
					fmData[upProp] = raw.map((v: string) =>
						typeof v === "string"
							? v.replace(`[[${oldParent.basename}]]`, `[[${newParent.basename}]]`)
							: v
					);
				}
			});
		} else {
			// Update inline field
			let content = await this.app.vault.read(note);
			const regex = new RegExp(
				`^(\\s*${this.escapeRegex(upProp)}\\s*::\\s*)(.+)$`,
				"m"
			);
			content = content.replace(regex, (_match, prefix, value) => {
				return prefix + value.replace(
					`[[${oldParent.basename}]]`,
					`[[${newParent.basename}]]`
				);
			});
			await this.app.vault.modify(note, content);
		}
		this.invalidateCache();
	}
}
