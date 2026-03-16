import { App, Modal, Setting, SuggestModal, TFile, setIcon, DropdownComponent } from "obsidian";
import { MocMode, MocParams, NoteInfo, SortBy } from "./types";

// Reusable file suggest modal (moved from main.ts for shared use)
export class FileSuggestModal extends SuggestModal<TFile> {
	private files: TFile[];
	private onChooseCallback: (file: TFile) => void;

	constructor(app: App, files: TFile[], placeholder: string, onChoose: (file: TFile) => void) {
		super(app);
		this.files = files;
		this.onChooseCallback = onChoose;
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): TFile[] {
		if (!query) return this.files;
		const lower = query.toLowerCase();
		return this.files.filter((f) => f.basename.toLowerCase().includes(lower));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createEl("div", { text: file.basename });
		el.createEl("small", { text: file.path });
	}

	onChooseSuggestion(file: TFile): void {
		this.onChooseCallback(file);
	}
}

interface MocOption {
	mode: MocMode;
	label: string;
	description: string;
}

const MOC_OPTIONS: MocOption[] = [
	{
		mode: "list",
		label: "List",
		description: "Nested bullet list of child notes (via parent-property links)",
	},
	{
		mode: "embedded",
		label: "Embedded",
		description: "Embed full note content with headings",
	},
	{
		mode: "folder",
		label: "Folder",
		description: "List all notes in a specific folder",
	},
	{
		mode: "tag",
		label: "Tag",
		description: "List all notes with a specific tag",
	},
];

export class MocModeSuggestModal extends SuggestModal<MocOption> {
	private onChooseCallback: (params: MocParams) => void;
	private defaultDepth: number;
	private defaultIgnoreBlock: boolean;

	constructor(
		app: App,
		defaultDepth: number,
		defaultIgnoreBlock: boolean,
		onChoose: (params: MocParams) => void
	) {
		super(app);
		this.defaultDepth = defaultDepth;
		this.defaultIgnoreBlock = defaultIgnoreBlock;
		this.onChooseCallback = onChoose;
		this.setPlaceholder("Select MOC mode");
	}

	getSuggestions(query: string): MocOption[] {
		if (!query) return MOC_OPTIONS;
		const lower = query.toLowerCase();
		return MOC_OPTIONS.filter(
			(o) =>
				o.label.toLowerCase().includes(lower) ||
				o.description.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(option: MocOption, el: HTMLElement): void {
		el.createEl("div", { text: option.label });
		el.createEl("small", { text: option.description });
	}

	onChooseSuggestion(option: MocOption, _evt: MouseEvent | KeyboardEvent): void {
		if (option.mode === "folder") {
			new TextInputModal(
				this.app,
				"Folder path",
				"Enter folder path (e.g. Notes/Topics)",
				(value) => {
					this.onChooseCallback({
						mode: "folder",
						depth: 0,
						ignoreBlock: false,
						folderPath: value,
					});
				}
			).open();
		} else if (option.mode === "tag") {
			new TextInputModal(
				this.app,
				"Tag",
				"Enter tag (e.g. #topic or topic)",
				(value) => {
					this.onChooseCallback({
						mode: "tag",
						depth: 0,
						ignoreBlock: false,
						tagFilter: value.startsWith("#") ? value : "#" + value,
					});
				}
			).open();
		} else {
			this.onChooseCallback({
				mode: option.mode,
				depth: this.defaultDepth,
				ignoreBlock: this.defaultIgnoreBlock,
			});
		}
	}
}

interface ParentOption {
	file: TFile | null;
	label: string;
	description: string;
	isSeparator?: boolean;
}

export class ParentNoteSuggestModal extends SuggestModal<ParentOption> {
	private options: ParentOption[];
	private onChooseCallback: (file: TFile | null) => void;

	constructor(
		app: App,
		mocFiles: TFile[],
		otherFiles: TFile[],
		preselected: TFile | null,
		onChoose: (file: TFile | null) => void
	) {
		super(app);
		this.onChooseCallback = onChoose;
		this.setPlaceholder("Select parent note");

		// Build ordered options list
		this.options = [];

		// "(No parent)" always first
		this.options.push({
			file: null,
			label: "(No parent)",
			description: "Create a standalone note",
		});

		// If preselected, put it right after "(No parent)"
		const preselectedPath = preselected?.path;

		if (preselected) {
			this.options.push({
				file: preselected,
				label: "→ " + preselected.basename,
				description: preselected.path,
			});
		}

		// MOC files (excluding preselected)
		for (const f of mocFiles) {
			if (f.path === preselectedPath) continue;
			this.options.push({
				file: f,
				label: f.basename,
				description: f.path,
			});
		}

		// Separator + other files
		if (otherFiles.length > 0) {
			this.options.push({
				file: null,
				label: "── Other notes ──",
				description: "",
				isSeparator: true,
			});
			for (const f of otherFiles) {
				if (f.path === preselectedPath) continue;
				this.options.push({
					file: f,
					label: f.basename,
					description: f.path,
				});
			}
		}
	}

	getSuggestions(query: string): ParentOption[] {
		if (!query) return this.options.filter((o) => !o.isSeparator);
		const lower = query.toLowerCase();
		return this.options.filter(
			(o) =>
				!o.isSeparator &&
				(o.label.toLowerCase().includes(lower) ||
					o.description.toLowerCase().includes(lower))
		);
	}

	renderSuggestion(option: ParentOption, el: HTMLElement): void {
		el.createEl("div", { text: option.label });
		if (option.description) {
			el.createEl("small", { text: option.description });
		}
	}

	onChooseSuggestion(option: ParentOption, _evt: MouseEvent | KeyboardEvent): void {
		if (option.isSeparator) return;
		this.onChooseCallback(option.file);
	}
}

export interface NewNoteInfo {
	name: string;
	aliases: string;
	priority: number;
	isMoc: boolean;
}

export class CreateNoteModal extends Modal {
	private defaultPriority: number;
	private onSubmit: (info: NewNoteInfo) => void;

	constructor(
		app: App,
		defaultPriority: number,
		onSubmit: (info: NewNoteInfo) => void
	) {
		super(app);
		this.defaultPriority = defaultPriority;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Create new note" });

		let name = "";
		let aliases = "";
		let priority = this.defaultPriority;
		let isMoc = false;

		const submit = () => {
			this.close();
			this.onSubmit({ name, aliases, priority, isMoc });
		};

		new Setting(contentEl).setName("Note name").addText((text) => {
			text.setPlaceholder("Note name").onChange((value) => {
				name = value;
			});
			setTimeout(() => text.inputEl.focus(), 50);
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					submit();
				}
			});
		});

		new Setting(contentEl)
			.setName("Aliases")
			.setDesc("Comma-separated")
			.addText((text) => {
				text.setPlaceholder("Alias1, Alias2").onChange((value) => {
					aliases = value;
				});
			});

		new Setting(contentEl)
			.setName("Create as MOC")
			.setDesc("Add MOC tag to this note")
			.addToggle((toggle) => {
				toggle.setValue(false).onChange((value) => {
					isMoc = value;
				});
			});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Create")
				.setCta()
				.onClick(() => {
					submit();
				})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export interface ReorderGroupData {
	parent: TFile;
	label: string;
	items: NoteInfo[];
}

export class ReorderModal extends Modal {
	private groups: ReorderGroupData[];
	private onSave: (groups: ReorderGroupData[]) => void;
	private scrollEl: HTMLElement | null = null;
	private dragSource: { groupIdx: number; itemIdx: number } | null = null;
	// Maps sub-MOC file path -> group index for nested rendering
	private subMocGroupMap = new Map<string, number>();

	constructor(
		app: App,
		groups: ReorderGroupData[],
		onSave: (groups: ReorderGroupData[]) => void
	) {
		super(app);
		this.groups = groups.map((g) => ({
			parent: g.parent,
			label: g.label,
			items: [...g.items],
		}));
		this.onSave = onSave;

		// Build sub-MOC lookup: which items in group 0 are also group parents?
		this.rebuildSubMocMap();
	}

	private rebuildSubMocMap(): void {
		this.subMocGroupMap.clear();
		for (let i = 1; i < this.groups.length; i++) {
			this.subMocGroupMap.set(this.groups[i].parent.path, i);
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("moc-reorder-modal");
		contentEl.createEl("h3", { text: "Reorder MOC children" });

		this.scrollEl = contentEl.createDiv({ cls: "moc-reorder-scroll" });
		this.renderAll();

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Save").setCta().onClick(() => {
				this.close();
				this.onSave(this.groups);
			})
		);

		// Keyboard: Alt+Up / Alt+Down within group
		contentEl.addEventListener("keydown", (e) => {
			if (!e.altKey) return;
			const focused = contentEl.querySelector(
				".moc-reorder-item:focus"
			) as HTMLElement;
			if (!focused) return;
			const gIdx = parseInt(focused.dataset.group ?? "-1");
			const iIdx = parseInt(focused.dataset.index ?? "-1");
			if (gIdx < 0 || iIdx < 0) return;
			const group = this.groups[gIdx];
			if (!group) return;

			if (e.key === "ArrowUp" && iIdx > 0) {
				e.preventDefault();
				[group.items[iIdx], group.items[iIdx - 1]] = [
					group.items[iIdx - 1],
					group.items[iIdx],
				];
				this.renderAll();
				this.focusItem(gIdx, iIdx - 1);
			} else if (
				e.key === "ArrowDown" &&
				iIdx < group.items.length - 1
			) {
				e.preventDefault();
				[group.items[iIdx], group.items[iIdx + 1]] = [
					group.items[iIdx + 1],
					group.items[iIdx],
				];
				this.renderAll();
				this.focusItem(gIdx, iIdx + 1);
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}

	private focusItem(groupIdx: number, itemIdx: number) {
		const el = this.scrollEl?.querySelector(
			`[data-group="${groupIdx}"][data-index="${itemIdx}"]`
		) as HTMLElement;
		el?.focus();
	}

	private clearAllIndicators() {
		this.scrollEl
			?.querySelectorAll(
				".drag-over-above, .drag-over-below, .drag-over-group"
			)
			.forEach((el) => {
				el.removeClass("drag-over-above");
				el.removeClass("drag-over-below");
				el.removeClass("drag-over-group");
			});
	}

	private handleDrop(targetGroupIdx: number, targetItemIdx: number) {
		if (!this.dragSource) return;
		const { groupIdx: srcGIdx, itemIdx: srcIIdx } = this.dragSource;
		const srcGroup = this.groups[srcGIdx];
		const targetGroup = this.groups[targetGroupIdx];
		if (!srcGroup || !targetGroup) return;

		const [movedItem] = srcGroup.items.splice(srcIIdx, 1);

		let adjustedIdx = targetItemIdx;
		if (srcGIdx === targetGroupIdx && srcIIdx < targetItemIdx) {
			adjustedIdx--;
		}

		targetGroup.items.splice(adjustedIdx, 0, movedItem);
		this.dragSource = null;
		this.renderAll();
	}

	private renderAll() {
		if (!this.scrollEl) return;
		this.scrollEl.empty();
		this.rebuildSubMocMap();

		// Render as a nested tree starting from the root group (index 0)
		const rootGroup = this.groups[0];
		if (!rootGroup) return;

		// Root header
		const rootHeader = this.scrollEl.createDiv({ cls: "moc-reorder-tree-root" });
		const rootIcon = rootHeader.createSpan({ cls: "moc-reorder-tree-icon" });
		setIcon(rootIcon, "folder-tree");
		rootHeader.createSpan({
			cls: "moc-reorder-tree-root-label",
			text: rootGroup.label,
		});
		rootHeader.createSpan({
			cls: "moc-reorder-group-count",
			text: ` (${rootGroup.items.length})`,
		});

		// Root children container
		const rootBody = this.scrollEl.createDiv({ cls: "moc-reorder-tree-children" });
		this.renderGroupItems(rootBody, 0);
	}

	private renderGroupItems(container: HTMLElement, groupIdx: number): void {
		const group = this.groups[groupIdx];
		if (!group) return;

		container.dataset.group = String(groupIdx);

		if (group.items.length === 0) {
			container.createDiv({
				cls: "moc-reorder-empty",
				text: "No children — drop items here",
			});
		}

		// Drop on container body (for empty groups or dropping at end)
		container.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (!this.dragSource) return;
			const target = e.target as HTMLElement;
			if (!target.closest(".moc-reorder-item")) {
				this.clearAllIndicators();
				container.addClass("drag-over-group");
			}
		});

		container.addEventListener("dragleave", (e) => {
			if (!container.contains(e.relatedTarget as Node)) {
				container.removeClass("drag-over-group");
			}
		});

		container.addEventListener("drop", (e) => {
			e.preventDefault();
			const target = e.target as HTMLElement;
			if (!target.closest(".moc-reorder-item")) {
				this.clearAllIndicators();
				this.handleDrop(groupIdx, group.items.length);
			}
		});

		group.items.forEach((item, itemIdx) => {
			const isSubMoc = this.subMocGroupMap.has(item.file.path);
			const subGroupIdx = this.subMocGroupMap.get(item.file.path);

			// Wrapper for item + its nested children
			const nodeWrap = container.createDiv({ cls: "moc-reorder-tree-node" });

			const row = nodeWrap.createDiv({
				cls: "moc-reorder-item" + (isSubMoc ? " is-sub-moc" : ""),
			});
			row.setAttribute("tabindex", "0");
			row.dataset.group = String(groupIdx);
			row.dataset.index = String(itemIdx);
			row.draggable = true;

			// Grip
			const grip = row.createSpan({ cls: "moc-reorder-grip" });
			setIcon(grip, "grip-vertical");

			// Icon for sub-MOCs vs leaf
			const itemIcon = row.createSpan({ cls: "moc-reorder-item-icon" });
			if (isSubMoc) {
				setIcon(itemIcon, "folder");
			} else {
				setIcon(itemIcon, "file-text");
			}

			// Label
			row.createSpan({
				cls: "moc-reorder-label",
				text: item.file.basename,
			});

			// Sub-MOC child count badge
			if (isSubMoc && subGroupIdx !== undefined) {
				const subGroup = this.groups[subGroupIdx];
				row.createSpan({
					cls: "moc-reorder-sub-count",
					text: `${subGroup.items.length}`,
				});
			}

			// Actions
			const actions = row.createSpan({ cls: "moc-reorder-actions" });

			const btnUp = actions.createEl("button", {
				cls: "moc-reorder-btn",
			});
			setIcon(btnUp, "arrow-up");
			btnUp.addEventListener("click", (e) => {
				e.stopPropagation();
				if (itemIdx > 0) {
					[group.items[itemIdx], group.items[itemIdx - 1]] = [
						group.items[itemIdx - 1],
						group.items[itemIdx],
					];
					this.renderAll();
					this.focusItem(groupIdx, itemIdx - 1);
				}
			});

			const btnDown = actions.createEl("button", {
				cls: "moc-reorder-btn",
			});
			setIcon(btnDown, "arrow-down");
			btnDown.addEventListener("click", (e) => {
				e.stopPropagation();
				if (itemIdx < group.items.length - 1) {
					[group.items[itemIdx], group.items[itemIdx + 1]] = [
						group.items[itemIdx + 1],
						group.items[itemIdx],
					];
					this.renderAll();
					this.focusItem(groupIdx, itemIdx + 1);
				}
			});

			// Drag start
			row.addEventListener("dragstart", (e) => {
				this.dragSource = { groupIdx, itemIdx };
				row.addClass("is-dragging");
				e.dataTransfer?.setData(
					"text/plain",
					`${groupIdx}:${itemIdx}`
				);
			});

			row.addEventListener("dragend", () => {
				this.dragSource = null;
				row.removeClass("is-dragging");
				this.clearAllIndicators();
			});

			// Drag over item = position indicator
			row.addEventListener("dragover", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.clearAllIndicators();
				const rect = row.getBoundingClientRect();
				const mid = rect.top + rect.height / 2;
				if (e.clientY < mid) {
					row.addClass("drag-over-above");
				} else {
					row.addClass("drag-over-below");
				}
			});

			row.addEventListener("dragleave", () => {
				row.removeClass("drag-over-above");
				row.removeClass("drag-over-below");
			});

			// Drop on item
			row.addEventListener("drop", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.clearAllIndicators();
				const rect = row.getBoundingClientRect();
				const mid = rect.top + rect.height / 2;
				const targetIdx =
					e.clientY < mid ? itemIdx : itemIdx + 1;
				this.handleDrop(groupIdx, targetIdx);
			});

			// Render nested children for sub-MOCs
			if (isSubMoc && subGroupIdx !== undefined) {
				const subChildren = nodeWrap.createDiv({
					cls: "moc-reorder-tree-children moc-reorder-tree-nested",
				});
				this.renderGroupItems(subChildren, subGroupIdx);
			}
		});
	}
}

export class OrphanListModal extends Modal {
	private orphans: TFile[];
	private onAssignParent: (orphan: TFile) => void;
	private onBulkAssign: (orphans: TFile[]) => void;
	private selected = new Set<string>();

	constructor(
		app: App,
		orphans: TFile[],
		onAssignParent: (orphan: TFile) => void,
		onBulkAssign?: (orphans: TFile[]) => void
	) {
		super(app);
		this.orphans = orphans;
		this.onAssignParent = onAssignParent;
		this.onBulkAssign = onBulkAssign ?? onAssignParent as any;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: `Orphan notes (${this.orphans.length})` });

		if (this.orphans.length === 0) {
			contentEl.createEl("p", { text: "No orphan notes found." });
			return;
		}

		// 3.2: Bulk actions bar
		const actionsBar = contentEl.createDiv({ cls: "moc-orphan-actions" });
		actionsBar.style.display = "flex";
		actionsBar.style.gap = "8px";
		actionsBar.style.marginBottom = "8px";
		actionsBar.style.alignItems = "center";

		const selectAllCb = actionsBar.createEl("input", { attr: { type: "checkbox" } });
		const selectLabel = actionsBar.createSpan({ text: "Select all" });
		selectLabel.style.fontSize = "0.9em";
		selectLabel.style.color = "var(--text-muted)";
		selectLabel.style.cursor = "pointer";
		selectLabel.addEventListener("click", () => {
			selectAllCb.click();
		});

		const countLabel = actionsBar.createSpan({ text: "" });
		countLabel.style.flex = "1";
		countLabel.style.fontSize = "0.85em";
		countLabel.style.color = "var(--text-faint)";

		const bulkBtn = actionsBar.createEl("button", { text: "Assign selected to..." });
		bulkBtn.style.flexShrink = "0";
		bulkBtn.disabled = true;

		const updateCount = () => {
			countLabel.textContent = this.selected.size > 0
				? `${this.selected.size} selected`
				: "";
			bulkBtn.disabled = this.selected.size === 0;
		};

		selectAllCb.addEventListener("change", () => {
			const checked = selectAllCb.checked;
			this.selected.clear();
			if (checked) {
				for (const o of this.orphans) this.selected.add(o.path);
			}
			listEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
				cb.checked = checked;
			});
			updateCount();
		});

		bulkBtn.addEventListener("click", () => {
			const selectedFiles = this.orphans.filter((o) => this.selected.has(o.path));
			if (selectedFiles.length > 0) {
				this.close();
				this.onBulkAssign(selectedFiles);
			}
		});

		const listEl = contentEl.createDiv({ cls: "moc-orphan-list" });
		listEl.style.maxHeight = "400px";
		listEl.style.overflowY = "auto";

		for (const orphan of this.orphans) {
			const row = listEl.createDiv({ cls: "moc-orphan-item" });
			row.style.display = "flex";
			row.style.alignItems = "center";
			row.style.justifyContent = "space-between";
			row.style.padding = "4px 8px";
			row.style.borderBottom = "1px solid var(--background-modifier-border)";

			// 3.2: Checkbox
			const cb = row.createEl("input", { attr: { type: "checkbox" } });
			cb.style.marginRight = "8px";
			cb.style.flexShrink = "0";
			cb.addEventListener("change", () => {
				if (cb.checked) {
					this.selected.add(orphan.path);
				} else {
					this.selected.delete(orphan.path);
				}
				updateCount();
			});

			const nameEl = row.createSpan({ text: orphan.basename });
			nameEl.style.flex = "1";
			nameEl.style.overflow = "hidden";
			nameEl.style.textOverflow = "ellipsis";
			nameEl.style.whiteSpace = "nowrap";
			nameEl.style.cursor = "pointer";
			nameEl.addEventListener("click", () => {
				this.close();
				this.app.workspace.getLeaf(false).openFile(orphan);
			});

			const btn = row.createEl("button", { text: "Assign parent" });
			btn.style.marginLeft = "8px";
			btn.style.flexShrink = "0";
			btn.addEventListener("click", () => {
				this.close();
				this.onAssignParent(orphan);
			});
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class EditMocParamsModal extends Modal {
	private params: MocParams;
	private onSave: (params: MocParams) => void;

	constructor(app: App, params: MocParams, onSave: (params: MocParams) => void) {
		super(app);
		this.params = { ...params };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Edit MOC parameters" });

		new Setting(contentEl)
			.setName("Mode")
			.addDropdown((dd) =>
				dd
					.addOptions({
						list: "List",
						embedded: "Embedded",
						folder: "Folder",
						tag: "Tag",
					})
					.setValue(this.params.mode)
					.onChange((v) => { this.params.mode = v as MocMode; })
			);

		new Setting(contentEl)
			.setName("Depth")
			.setDesc("0 = unlimited")
			.addText((text) =>
				text
					.setValue(String(this.params.depth))
					.onChange((v) => { this.params.depth = parseInt(v) || 0; })
			);

		new Setting(contentEl)
			.setName("Ignore block")
			.addToggle((toggle) =>
				toggle
					.setValue(this.params.ignoreBlock)
					.onChange((v) => { this.params.ignoreBlock = v; })
			);

		new Setting(contentEl)
			.setName("Sort")
			.addDropdown((dd) =>
				dd
					.addOptions({
						"": "(default)",
						priority: "Priority",
						alphabetical: "Alphabetical",
						created: "Created date",
						modified: "Modified date",
						custom: "Custom field",
					})
					.setValue(this.params.sort ?? "")
					.onChange((v) => { this.params.sort = v ? v as SortBy : undefined; })
			);

		new Setting(contentEl)
			.setName("Include tag")
			.addText((text) =>
				text
					.setValue(this.params.include ?? "")
					.onChange((v) => { this.params.include = v || undefined; })
			);

		new Setting(contentEl)
			.setName("Exclude tag")
			.addText((text) =>
				text
					.setValue(this.params.exclude ?? "")
					.onChange((v) => { this.params.exclude = v || undefined; })
			);

		new Setting(contentEl)
			.setName("Folder path")
			.setDesc("For folder mode")
			.addText((text) =>
				text
					.setValue(this.params.folderPath ?? "")
					.onChange((v) => { this.params.folderPath = v || undefined; })
			);

		new Setting(contentEl)
			.setName("Tag filter")
			.setDesc("For tag mode")
			.addText((text) =>
				text
					.setValue(this.params.tagFilter ?? "")
					.onChange((v) => { this.params.tagFilter = v || undefined; })
			);

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Save").setCta().onClick(() => {
				this.close();
				this.onSave(this.params);
			})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class TextInputModal extends Modal {
	private title: string;
	private placeholder: string;
	private onSubmit: (value: string) => void;

	constructor(
		app: App,
		title: string,
		placeholder: string,
		onSubmit: (value: string) => void
	) {
		super(app);
		this.title = title;
		this.placeholder = placeholder;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });

		let inputValue = "";
		new Setting(contentEl).addText((text) => {
			text.setPlaceholder(this.placeholder).onChange((value) => {
				inputValue = value;
			});
			setTimeout(() => text.inputEl.focus(), 50);
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.close();
					this.onSubmit(inputValue);
				}
			});
		});

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Insert").setCta().onClick(() => {
				this.close();
				this.onSubmit(inputValue);
			})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export interface BatchCreateResult {
	names: string[];
	isMoc: boolean;
}

export class BatchCreateModal extends Modal {
	private onSubmit: (result: BatchCreateResult) => void;

	constructor(app: App, onSubmit: (result: BatchCreateResult) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Batch create child notes" });
		contentEl.createEl("p", {
			text: "Enter one note name per line.",
			cls: "setting-item-description",
		});

		let rawText = "";
		let isMoc = false;

		const textarea = contentEl.createEl("textarea", {
			attr: { rows: "10", placeholder: "Note 1\nNote 2\nNote 3" },
		});
		textarea.style.width = "100%";
		textarea.style.marginBottom = "8px";
		textarea.style.padding = "8px";
		textarea.style.fontFamily = "inherit";
		textarea.style.fontSize = "0.9em";
		textarea.style.border = "1px solid var(--background-modifier-border)";
		textarea.style.borderRadius = "4px";
		textarea.style.background = "var(--background-primary)";
		textarea.style.color = "var(--text-normal)";
		textarea.addEventListener("input", () => {
			rawText = textarea.value;
		});
		setTimeout(() => textarea.focus(), 50);

		new Setting(contentEl)
			.setName("Create as MOC")
			.setDesc("Add MOC tag to all created notes")
			.addToggle((toggle) => {
				toggle.setValue(false).onChange((value) => {
					isMoc = value;
				});
			});

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Create all").setCta().onClick(() => {
				const names = rawText
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s.length > 0);
				if (names.length === 0) return;
				this.close();
				this.onSubmit({ names, isMoc });
			})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
