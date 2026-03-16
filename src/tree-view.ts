import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { MocEngine } from "./moc-engine";
import { MocGeneratorSettings } from "./types";

export const NOTE_TREE_VIEW_TYPE = "note-tree-view";

export class NoteTreeView extends ItemView {
	private engine: MocEngine;
	private settings: MocGeneratorSettings;

	constructor(leaf: WorkspaceLeaf, engine: MocEngine, settings: MocGeneratorSettings) {
		super(leaf);
		this.engine = engine;
		this.settings = settings;
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
		await this.buildTree();

		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.rebuildDebounced();
			})
		);
	}

	private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

	private rebuildDebounced(): void {
		if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
		this.rebuildTimer = setTimeout(() => this.buildTree(), 1000);
	}

	private async buildTree(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("note-tree-view");

		const allFiles = this.app.vault.getMarkdownFiles();
		const roots: TFile[] = [];
		for (const f of allFiles) {
			if (this.engine.checkTagExist(f, this.settings.mocTag)) {
				const parents = await this.engine.getParentFiles(f);
				if (parents.length === 0) {
					roots.push(f);
				}
			}
		}
		roots.sort((a, b) => a.basename.localeCompare(b.basename));

		if (roots.length === 0) {
			container.createEl("p", {
				text: "No root MOC notes found.",
				cls: "pane-empty",
			});
			return;
		}

		const index = await this.engine.getIndex();
		for (const root of roots) {
			this.renderNode(container, root, index, new Set());
		}
	}

	private renderNode(
		parentEl: HTMLElement,
		file: TFile,
		index: Map<string, { file: TFile; priority: number }[]>,
		visited: Set<string>
	): void {
		if (visited.has(file.path)) return;
		visited.add(file.path);

		const children = index.get(file.path) ?? [];
		const hasChildren = children.length > 0;

		const nodeEl = parentEl.createDiv({ cls: "tree-node" });
		const headerEl = nodeEl.createDiv({ cls: "tree-node-header" });

		const iconEl = headerEl.createSpan({ cls: "tree-node-icon" });
		if (hasChildren) {
			setIcon(iconEl, "chevron-right");
		}

		const labelEl = headerEl.createSpan({
			cls: "tree-node-label",
			text: file.basename,
		});

		let childrenEl: HTMLElement | null = null;
		let expanded = false;

		headerEl.addEventListener("click", (e) => {
			if (e.ctrlKey || e.metaKey) {
				// Navigate on ctrl/cmd click
				this.app.workspace.getLeaf(false).openFile(file);
				return;
			}

			if (!hasChildren) {
				this.app.workspace.getLeaf(false).openFile(file);
				return;
			}

			expanded = !expanded;
			if (expanded) {
				setIcon(iconEl, "chevron-down");
				if (!childrenEl) {
					childrenEl = nodeEl.createDiv({ cls: "tree-node-children" });
					const sorted = [...children].sort((a, b) =>
						a.priority !== b.priority
							? a.priority - b.priority
							: a.file.basename.localeCompare(b.file.basename)
					);
					for (const child of sorted) {
						this.renderNode(childrenEl, child.file, index, new Set(visited));
					}
				}
				childrenEl.style.display = "";
			} else {
				setIcon(iconEl, "chevron-right");
				if (childrenEl) {
					childrenEl.style.display = "none";
				}
			}
		});

		// Double click navigates
		headerEl.addEventListener("dblclick", () => {
			this.app.workspace.getLeaf(false).openFile(file);
		});
	}
}
