import { ItemView, Menu, TFile, WorkspaceLeaf, setIcon, Notice } from "obsidian";
import { MocEngine } from "./moc-engine";
import { MocGeneratorSettings, NoteInfo } from "./types";

export const NOTE_TREE_VIEW_TYPE = "note-tree-view";

export interface TreeViewHost {
	engine: MocEngine;
	settings: MocGeneratorSettings;
	createChildNote(parentFile: TFile): void;
	addExistingChildToParent(parentFile: TFile): void;
	updateMoc(file: TFile): Promise<void>;
	promoteToMoc(file: TFile): Promise<void>;
	demoteFromMoc(file: TFile): Promise<void>;
	batchCreateChildren(parentFile: TFile): void;
}

interface NodeState {
	file: TFile;
	headerEl: HTMLElement;
	nodeEl: HTMLElement;
	childrenEl: HTMLElement | null;
	expanded: boolean;
	hasChildren: boolean;
	stale: boolean;
	toggle: (force?: boolean) => void;
}

export class NoteTreeView extends ItemView {
	private host: TreeViewHost;
	private nodeMap = new Map<string, NodeState>();
	private focusedPath: string | null = null;
	private searchQuery = "";
	private treeContainer: HTMLElement | null = null;
	private searchInput: HTMLInputElement | null = null;
	private staleCache = new Map<string, boolean>();
	private dragSourcePath: string | null = null;

	constructor(leaf: WorkspaceLeaf, host: TreeViewHost) {
		super(leaf);
		this.host = host;
	}

	getViewType(): string {
		return NOTE_TREE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Note Tree";
	}

	getIcon(): string {
		return "list-tree";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("note-tree-view");

		// Search/filter input
		const searchWrap = container.createDiv({ cls: "tree-search-wrap" });
		this.searchInput = searchWrap.createEl("input", {
			cls: "tree-search-input",
			attr: { type: "text", placeholder: "Filter notes..." },
		});
		this.searchInput.addEventListener("input", () => {
			this.searchQuery = this.searchInput!.value.toLowerCase();
			this.buildTree();
		});

		// #5: Collapse/Expand all buttons
		const btnWrap = searchWrap.createDiv({ cls: "tree-toolbar" });
		const expandBtn = btnWrap.createEl("button", {
			cls: "tree-toolbar-btn",
			attr: { "aria-label": "Expand all" },
		});
		setIcon(expandBtn, "unfold-vertical");
		expandBtn.addEventListener("click", () => {
			for (const state of this.nodeMap.values()) {
				if (state.hasChildren && !state.expanded) state.toggle(true);
			}
		});
		const collapseBtn = btnWrap.createEl("button", {
			cls: "tree-toolbar-btn",
			attr: { "aria-label": "Collapse all" },
		});
		setIcon(collapseBtn, "fold-vertical");
		collapseBtn.addEventListener("click", () => {
			for (const state of this.nodeMap.values()) {
				if (state.expanded) state.toggle(false);
			}
		});

		this.treeContainer = container.createDiv({ cls: "tree-container" });

		await this.buildTree();

		// Rebuild on metadata changes
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.rebuildDebounced();
			})
		);

		// Auto-reveal active file
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.host.settings.autoRevealInTree) {
					const file = this.app.workspace.getActiveFile();
					if (file) this.revealFile(file);
				}
			})
		);

		// Keyboard navigation
		container.addEventListener("keydown", (e) => this.handleKeydown(e));
	}

	private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

	private rebuildDebounced(): void {
		if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
		this.rebuildTimer = setTimeout(() => {
			this.staleCache.clear();
			this.buildTree();
		}, 1000);
	}

	private async buildTree(): Promise<void> {
		if (!this.treeContainer) return;

		// Preserve expanded state
		const expandedPaths = new Set<string>();
		for (const [path, state] of this.nodeMap) {
			if (state.expanded) expandedPaths.add(path);
		}

		this.treeContainer.empty();
		this.nodeMap.clear();

		// #14: Dashboard / stats section
		await this.renderStats();

		const allFiles = this.app.vault.getMarkdownFiles();
		const roots: TFile[] = [];
		for (const f of allFiles) {
			if (this.host.engine.checkTagExist(f, this.host.settings.mocTag)) {
				const parents = await this.host.engine.getParentFiles(f);
				if (parents.length === 0) {
					roots.push(f);
				}
			}
		}
		roots.sort((a, b) => a.basename.localeCompare(b.basename));

		if (roots.length === 0) {
			this.treeContainer.createEl("p", {
				text: "No root MOC notes found.",
				cls: "pane-empty",
			});
			return;
		}

		const index = await this.host.engine.getIndex();

		// Pre-compute stale status for MOC nodes
		await this.computeStaleStatus();

		// If search is active, find matching files and required ancestors
		let matchingPaths: Set<string> | null = null;
		if (this.searchQuery) {
			matchingPaths = new Set<string>();
			for (const f of allFiles) {
				if (f.basename.toLowerCase().includes(this.searchQuery)) {
					matchingPaths.add(f.path);
					const chain = await this.host.engine.getAncestorChain(f);
					for (const ancestor of chain) {
						matchingPaths.add(ancestor.path);
					}
				}
			}
		}

		for (const root of roots) {
			if (matchingPaths && !matchingPaths.has(root.path)) continue;
			this.renderNode(
				this.treeContainer,
				root,
				index,
				new Set(),
				expandedPaths,
				matchingPaths
			);
		}
	}

	// #14: Stats section
	private statsCollapsed = true;
	private async renderStats(): Promise<void> {
		if (!this.treeContainer) return;
		const statsWrap = this.treeContainer.createDiv({ cls: "tree-stats" });
		const statsHeader = statsWrap.createDiv({ cls: "tree-stats-header" });
		statsHeader.createSpan({ text: "Stats" });
		const chevron = statsHeader.createSpan({ cls: "tree-stats-chevron" });
		setIcon(chevron, this.statsCollapsed ? "chevron-right" : "chevron-down");

		const statsBody = statsWrap.createDiv({ cls: "tree-stats-body" });
		statsBody.style.display = this.statsCollapsed ? "none" : "";

		statsHeader.addEventListener("click", () => {
			this.statsCollapsed = !this.statsCollapsed;
			statsBody.style.display = this.statsCollapsed ? "none" : "";
			setIcon(chevron, this.statsCollapsed ? "chevron-right" : "chevron-down");
			if (!this.statsCollapsed && statsBody.childElementCount === 0) {
				this.populateStats(statsBody);
			}
		});
	}

	private async populateStats(body: HTMLElement): Promise<void> {
		body.empty();
		body.createDiv({ cls: "tree-stats-row", text: "Loading..." });

		try {
			const stats = await this.host.engine.getStats();
			body.empty();

			const addRow = (label: string, value: string, onClick?: () => void) => {
				const row = body.createDiv({ cls: "tree-stats-row" });
				row.createSpan({ text: label });
				const valEl = row.createSpan({ cls: "tree-stats-value", text: value });
				if (onClick) {
					valEl.style.cursor = "pointer";
					valEl.style.textDecoration = "underline";
					valEl.addEventListener("click", onClick);
				}
			};

			addRow("Total notes", String(stats.totalNotes));
			addRow("MOCs", String(stats.totalMocs));
			addRow("Orphans", String(stats.orphanCount), () => {
				(this.app as any).commands.executeCommandById("note-tree:find-orphans");
			});
			addRow("Stale MOCs", String(stats.staleMocCount), () => {
				(this.app as any).commands.executeCommandById("note-tree:update-all-mocs");
			});
			addRow("Max depth", String(stats.maxDepth));
			if (stats.largestMoc) {
				addRow(
					"Largest MOC",
					`${stats.largestMoc.file.basename} (${stats.largestMoc.count})`,
					() => {
						this.app.workspace.getLeaf(false).openFile(stats.largestMoc!.file);
					}
				);
			}
		} catch {
			body.empty();
			body.createDiv({ cls: "tree-stats-row", text: "Failed to load stats" });
		}
	}

	private async computeStaleStatus(): Promise<void> {
		const allMocs = this.app.vault
			.getMarkdownFiles()
			.filter((f) =>
				this.host.engine.checkTagExist(f, this.host.settings.mocTag)
			);
		for (const moc of allMocs) {
			if (!this.staleCache.has(moc.path)) {
				const stale = await this.host.engine.isMocStale(moc);
				this.staleCache.set(moc.path, stale);
			}
		}
	}

	private renderNode(
		parentEl: HTMLElement,
		file: TFile,
		index: Map<string, NoteInfo[]>,
		visited: Set<string>,
		expandedPaths: Set<string>,
		matchingPaths: Set<string> | null
	): void {
		if (visited.has(file.path)) return;
		visited.add(file.path);

		const children = index.get(file.path) ?? [];
		const filteredChildren = matchingPaths
			? children.filter((c) => matchingPaths.has(c.file.path))
			: children;
		const hasChildren = filteredChildren.length > 0;
		const isMoc = this.host.engine.checkTagExist(
			file,
			this.host.settings.mocTag
		);
		const isStale = this.staleCache.get(file.path) ?? false;
		const isMatch =
			this.searchQuery &&
			file.basename.toLowerCase().includes(this.searchQuery);

		const nodeEl = parentEl.createDiv({ cls: "tree-node" });
		const headerEl = nodeEl.createDiv({ cls: "tree-node-header" });
		headerEl.setAttribute("tabindex", "0");
		headerEl.dataset.path = file.path;

		// #6: Tooltip with file path
		headerEl.setAttribute("title", file.path);

		// #13: Drag-and-drop with position-aware drop
		headerEl.draggable = true;
		headerEl.addEventListener("dragstart", (e) => {
			this.dragSourcePath = file.path;
			headerEl.addClass("is-dragging");
			e.dataTransfer?.setData("text/plain", file.path);
		});
		headerEl.addEventListener("dragend", () => {
			this.dragSourcePath = null;
			headerEl.removeClass("is-dragging");
			this.clearDropIndicators();
		});
		headerEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (this.dragSourcePath === file.path) return;
			this.clearDropIndicators();

			const rect = headerEl.getBoundingClientRect();
			const threshold = rect.height / 3;

			if (e.clientY < rect.top + threshold) {
				headerEl.addClass("tree-drop-above");
			} else if (e.clientY > rect.bottom - threshold) {
				headerEl.addClass("tree-drop-below");
			} else {
				headerEl.addClass("tree-drop-target");
			}
		});
		headerEl.addEventListener("dragleave", () => {
			headerEl.removeClass("tree-drop-target");
			headerEl.removeClass("tree-drop-above");
			headerEl.removeClass("tree-drop-below");
		});
		headerEl.addEventListener("drop", (e) => {
			e.preventDefault();
			const isAbove = headerEl.hasClass("tree-drop-above");
			const isBelow = headerEl.hasClass("tree-drop-below");
			this.clearDropIndicators();

			if (this.dragSourcePath && this.dragSourcePath !== file.path) {
				if (isAbove || isBelow) {
					this.handleSiblingReorder(this.dragSourcePath, file, isAbove ? "before" : "after");
				} else {
					this.handleTreeDrop(this.dragSourcePath, file);
				}
			}
		});

		// Icon
		const iconEl = headerEl.createSpan({ cls: "tree-node-icon" });
		if (hasChildren) {
			setIcon(iconEl, "chevron-right");
		}

		// Label
		const labelEl = headerEl.createSpan({
			cls: "tree-node-label" + (isMatch ? " tree-node-match" : ""),
			text: file.basename,
		});

		// #3: Child count badge
		if (hasChildren) {
			headerEl.createSpan({
				cls: "tree-node-count",
				text: `${filteredChildren.length}`,
			});
		}

		// #11: Multi-parent indicator
		const parentCount = this.host.engine.getParentCountFromCache(file.path);
		if (parentCount > 1) {
			const multiEl = headerEl.createSpan({
				cls: "tree-node-multi-parent",
				text: `+${parentCount - 1}`,
			});
			const parentNames = this.host.engine.getParentsFromCache(file.path).map(p => p.basename);
			multiEl.setAttribute("title", "Also in: " + parentNames.join(", "));
		}

		// Stale indicator
		if (isMoc && isStale) {
			const staleEl = headerEl.createSpan({ cls: "tree-node-stale" });
			staleEl.setAttribute("aria-label", "MOC is outdated");
			setIcon(staleEl, "alert-circle");
		}

		// #9: Recently modified indicator
		const recentThreshold = this.host.settings.recentModifiedHours * 60 * 60 * 1000;
		if (Date.now() - file.stat.mtime < recentThreshold) {
			const recentEl = headerEl.createSpan({ cls: "tree-node-recent" });
			recentEl.setAttribute("aria-label", "Recently modified");
		}

		let childrenEl: HTMLElement | null = null;
		let expanded =
			expandedPaths.has(file.path) ||
			(!!matchingPaths && hasChildren);

		const toggle = (force?: boolean) => {
			if (!hasChildren) return;
			expanded = force !== undefined ? force : !expanded;
			nodeState.expanded = expanded;
			if (expanded) {
				setIcon(iconEl, "chevron-down");
				if (!childrenEl) {
					childrenEl = nodeEl.createDiv({
						cls: "tree-node-children",
					});
					nodeState.childrenEl = childrenEl;
					const sorted = [...filteredChildren].sort((a, b) =>
						a.priority !== b.priority
							? a.priority - b.priority
							: a.file.basename.localeCompare(b.file.basename)
					);
					for (const child of sorted) {
						this.renderNode(
							childrenEl,
							child.file,
							index,
							new Set(visited),
							expandedPaths,
							matchingPaths
						);
					}
				}
				childrenEl.style.display = "";
			} else {
				setIcon(iconEl, "chevron-right");
				if (childrenEl) {
					childrenEl.style.display = "none";
				}
			}
		};

		const nodeState: NodeState = {
			file,
			headerEl,
			nodeEl,
			childrenEl: null,
			expanded: false,
			hasChildren,
			stale: isStale,
			toggle,
		};
		this.nodeMap.set(file.path, nodeState);

		// Split click targets — icon toggles, label opens file
		iconEl.addEventListener("click", (e) => {
			e.stopPropagation();
			toggle();
		});

		labelEl.addEventListener("click", (e) => {
			e.stopPropagation();
			const newTab = e.ctrlKey || e.metaKey;
			this.app.workspace.getLeaf(newTab).openFile(file);
		});

		// #12: Inline rename on double-click
		labelEl.addEventListener("dblclick", (e) => {
			e.stopPropagation();
			this.startInlineRename(file, labelEl);
		});

		// Clicking the header area (but not icon/label) toggles expand
		headerEl.addEventListener("click", () => {
			if (hasChildren) {
				toggle();
			} else {
				this.app.workspace.getLeaf(false).openFile(file);
			}
		});

		// Context menu
		headerEl.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.showContextMenu(file, e);
		});

		// Auto-expand if was previously expanded or search requires it
		if (expanded) {
			toggle(true);
		}
	}

	// #12: Inline rename
	private startInlineRename(file: TFile, labelEl: HTMLElement): void {
		const input = document.createElement("input");
		input.type = "text";
		input.value = file.basename;
		input.className = "tree-rename-input";

		const originalText = labelEl.textContent;
		labelEl.textContent = "";
		labelEl.appendChild(input);
		input.focus();
		input.select();

		let committed = false;

		const commit = async () => {
			if (committed) return;
			committed = true;
			const newName = input.value.trim();
			if (newName && newName !== file.basename) {
				const newPath = file.path.replace(/[^/]+$/, newName + "." + file.extension);
				try {
					await this.app.fileManager.renameFile(file, newPath);
				} catch (err) {
					new Notice("Rename failed: " + err);
				}
			}
			labelEl.textContent = newName || originalText;
		};

		const cancel = () => {
			committed = true;
			labelEl.textContent = originalText;
		};

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); commit(); }
			if (e.key === "Escape") { e.preventDefault(); cancel(); }
			e.stopPropagation();
		});
		input.addEventListener("blur", commit);
	}

	// Context menu
	private showContextMenu(file: TFile, e: MouseEvent): void {
		const menu = new Menu();
		const isMoc = this.host.engine.checkTagExist(
			file,
			this.host.settings.mocTag
		);

		menu.addItem((item) => {
			item.setTitle("Open in new tab")
				.setIcon("external-link")
				.onClick(() => {
					this.app.workspace.getLeaf(true).openFile(file);
				});
		});

		if (isMoc) {
			menu.addItem((item) => {
				item.setTitle("Create child note")
					.setIcon("plus")
					.onClick(() => {
						this.host.createChildNote(file);
					});
			});

			menu.addItem((item) => {
				item.setTitle("Add existing note as child")
					.setIcon("file-plus")
					.onClick(() => {
						this.host.addExistingChildToParent(file);
					});
			});

			// #4: Update MOC in context menu
			menu.addItem((item) => {
				item.setTitle("Update MOC")
					.setIcon("refresh-cw")
					.onClick(async () => {
						await this.host.updateMoc(file);
						this.staleCache.delete(file.path);
						await this.buildTree();
					});
			});

			// #10: Batch create children
			menu.addItem((item) => {
				item.setTitle("Batch create children")
					.setIcon("plus-square")
					.onClick(() => {
						this.host.batchCreateChildren(file);
					});
			});

			// #7: Demote from MOC
			menu.addItem((item) => {
				item.setTitle("Demote from MOC")
					.setIcon("arrow-down-circle")
					.onClick(async () => {
						await this.host.demoteFromMoc(file);
						this.staleCache.clear();
						await this.buildTree();
					});
			});
		} else {
			// #7: Promote to MOC
			menu.addItem((item) => {
				item.setTitle("Promote to MOC")
					.setIcon("arrow-up-circle")
					.onClick(async () => {
						await this.host.promoteToMoc(file);
						this.staleCache.clear();
						await this.buildTree();
					});
			});
		}

		menu.showAtMouseEvent(e);
	}

	// Keyboard navigation
	private handleKeydown(e: KeyboardEvent): void {
		const focused = this.treeContainer?.querySelector(
			".tree-node-header:focus"
		) as HTMLElement;
		if (!focused) return;

		const path = focused.dataset.path;
		if (!path) return;

		const state = this.nodeMap.get(path);
		if (!state) return;

		const visiblePaths = this.getVisiblePaths();
		const currentIdx = visiblePaths.indexOf(path);
		if (currentIdx < 0) return;

		switch (e.key) {
			case "ArrowDown": {
				e.preventDefault();
				const nextPath = visiblePaths[currentIdx + 1];
				if (nextPath) this.focusNode(nextPath);
				break;
			}
			case "ArrowUp": {
				e.preventDefault();
				const prevPath = visiblePaths[currentIdx - 1];
				if (prevPath) this.focusNode(prevPath);
				break;
			}
			case "ArrowRight": {
				e.preventDefault();
				if (state.hasChildren && !state.expanded) {
					state.toggle(true);
				} else if (state.hasChildren && state.expanded) {
					const nextPath = visiblePaths[currentIdx + 1];
					if (nextPath) this.focusNode(nextPath);
				}
				break;
			}
			case "ArrowLeft": {
				e.preventDefault();
				if (state.expanded) {
					state.toggle(false);
				} else {
					// Go to parent node
					const parentNodeEl =
						state.nodeEl.parentElement?.closest(".tree-node");
					if (parentNodeEl) {
						const parentHeader = parentNodeEl.querySelector(
							":scope > .tree-node-header"
						) as HTMLElement;
						parentHeader?.focus();
					}
				}
				break;
			}
			case "Enter": {
				e.preventDefault();
				this.app.workspace.getLeaf(false).openFile(state.file);
				break;
			}
			case "n": {
				if (e.ctrlKey || e.metaKey || e.altKey) break;
				const isMoc = this.host.engine.checkTagExist(
					state.file,
					this.host.settings.mocTag
				);
				if (isMoc) {
					e.preventDefault();
					this.host.createChildNote(state.file);
				}
				break;
			}
			// #12: F2 for inline rename
			case "F2": {
				e.preventDefault();
				const labelEl = state.headerEl.querySelector(".tree-node-label") as HTMLElement;
				if (labelEl) this.startInlineRename(state.file, labelEl);
				break;
			}
		}
	}

	private getVisiblePaths(): string[] {
		const paths: string[] = [];
		const headers =
			this.treeContainer?.querySelectorAll(".tree-node-header") ?? [];
		headers.forEach((h) => {
			const el = h as HTMLElement;
			if (el.offsetParent !== null) {
				const p = el.dataset.path;
				if (p) paths.push(p);
			}
		});
		return paths;
	}

	private focusNode(path: string): void {
		const state = this.nodeMap.get(path);
		if (state) {
			state.headerEl.focus();
			this.focusedPath = path;
		}
	}

	// Reveal active file in tree
	async revealFile(file: TFile): Promise<void> {
		let state = this.nodeMap.get(file.path);
		if (state) {
			this.highlightNode(state.headerEl);
			return;
		}

		// Expand ancestors to reveal the file
		const chain = await this.host.engine.getAncestorChain(file);
		if (chain.length === 0) return;

		const reversed = [...chain].reverse();
		for (const ancestor of reversed) {
			const ancestorState = this.nodeMap.get(ancestor.path);
			if (ancestorState && !ancestorState.expanded) {
				ancestorState.toggle(true);
				// Wait for children to render
				await new Promise((r) => setTimeout(r, 10));
			}
		}

		state = this.nodeMap.get(file.path);
		if (state) {
			this.highlightNode(state.headerEl);
		}
	}

	private highlightNode(el: HTMLElement): void {
		el.scrollIntoView({ behavior: "smooth", block: "center" });
		el.addClass("tree-node-highlighted");
		setTimeout(() => el.removeClass("tree-node-highlighted"), 2000);
	}

	// Handle drag-drop — reparent (drop onto center)
	private async handleTreeDrop(
		sourcePath: string,
		newParent: TFile
	): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		const oldParents = await this.host.engine.getParentFiles(sourceFile);
		const upProp = this.host.settings.upProperties[0] || "up";

		if (oldParents.length > 0) {
			await this.host.engine.updateNoteParent(
				sourceFile,
				oldParents[0],
				newParent
			);
		} else {
			await this.app.fileManager.processFrontMatter(
				sourceFile,
				(fm: any) => {
					fm[upProp] = `[[${newParent.basename}]]`;
				}
			);
		}

		this.host.engine.invalidateCache();

		for (const oldP of oldParents) {
			if (
				this.host.engine.checkTagExist(
					oldP,
					this.host.settings.mocTag
				)
			) {
				await this.host.engine.updateMoc(oldP);
			}
		}
		if (
			this.host.engine.checkTagExist(
				newParent,
				this.host.settings.mocTag
			)
		) {
			await this.host.engine.updateMoc(newParent);
		}

		new Notice(
			`Moved ${(sourceFile as TFile).basename} → ${newParent.basename}`
		);
		this.staleCache.clear();
		await this.buildTree();
	}

	// #13: Handle sibling reorder (drop above/below)
	private async handleSiblingReorder(
		sourcePath: string,
		targetFile: TFile,
		position: "before" | "after"
	): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		// Get the target's parent
		const targetParents = await this.host.engine.getParentFiles(targetFile);
		if (targetParents.length === 0) return;
		const parent = targetParents[0];

		// Get all siblings sorted by priority
		const siblings = await this.host.engine.getDirectChildren(parent);
		const targetIdx = siblings.findIndex(c => c.file.path === targetFile.path);
		if (targetIdx < 0) return;

		// Check if source has a different parent — reparent if needed
		const sourceParents = await this.host.engine.getParentFiles(sourceFile);
		const upProp = this.host.settings.upProperties[0] || "up";

		if (sourceParents.length > 0 && sourceParents[0].path !== parent.path) {
			await this.host.engine.updateNoteParent(sourceFile, sourceParents[0], parent);
		} else if (sourceParents.length === 0) {
			await this.app.fileManager.processFrontMatter(sourceFile, (fm: any) => {
				fm[upProp] = `[[${parent.basename}]]`;
			});
		}

		// Compute new priority
		let newPriority: number;
		const targetPriority = siblings[targetIdx].priority === Infinity ? (targetIdx + 1) * 10 : siblings[targetIdx].priority;

		if (position === "before") {
			const prevPriority = targetIdx > 0
				? (siblings[targetIdx - 1].priority === Infinity ? targetIdx * 10 : siblings[targetIdx - 1].priority)
				: 0;
			newPriority = Math.floor((prevPriority + targetPriority) / 2);
			if (newPriority === prevPriority || newPriority === targetPriority) {
				newPriority = targetPriority - 1;
			}
		} else {
			const nextPriority = targetIdx < siblings.length - 1
				? (siblings[targetIdx + 1].priority === Infinity ? (targetIdx + 2) * 10 : siblings[targetIdx + 1].priority)
				: targetPriority + 20;
			newPriority = Math.floor((targetPriority + nextPriority) / 2);
			if (newPriority === targetPriority || newPriority === nextPriority) {
				newPriority = targetPriority + 1;
			}
		}

		// Set priority on source file
		await this.app.fileManager.processFrontMatter(sourceFile, (fm: any) => {
			fm.priority = newPriority;
		});

		this.host.engine.invalidateCache();

		// Update affected MOCs
		if (this.host.engine.checkTagExist(parent, this.host.settings.mocTag)) {
			await this.host.engine.updateMoc(parent);
		}
		for (const oldP of sourceParents) {
			if (oldP.path !== parent.path && this.host.engine.checkTagExist(oldP, this.host.settings.mocTag)) {
				await this.host.engine.updateMoc(oldP);
			}
		}

		new Notice(`Reordered ${(sourceFile as TFile).basename}`);
		this.staleCache.clear();
		await this.buildTree();
	}

	private clearDropIndicators(): void {
		this.treeContainer
			?.querySelectorAll(".tree-drop-target, .tree-drop-above, .tree-drop-below")
			.forEach((el) => {
				el.removeClass("tree-drop-target");
				el.removeClass("tree-drop-above");
				el.removeClass("tree-drop-below");
			});
	}
}
