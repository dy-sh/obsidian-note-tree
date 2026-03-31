import {
	App,
	Editor,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import { MocGeneratorSettings, DEFAULT_SETTINGS, MocParams, DEFAULT_NEW_NOTE_TEMPLATE } from "./types";
import { MocEngine } from "./moc-engine";
import { MocModeSuggestModal, ParentNoteSuggestModal, CreateNoteModal, NewNoteInfo, ReorderModal, ReorderGroupData, OrphanListModal, EditMocParamsModal, FileSuggestModal, TextInputModal, BatchCreateModal } from "./modal";
import { NoteTreeView, NOTE_TREE_VIEW_TYPE, TreeViewHost } from "./tree-view";

export default class MocGeneratorPlugin extends Plugin implements TreeViewHost {
	settings: MocGeneratorSettings = DEFAULT_SETTINGS;
	engine: MocEngine = null as any;
	private statusBarEl: HTMLElement | null = null;
	private autoUpdateTimer: ReturnType<typeof setTimeout> | null = null;
	private isUpdating = false;
	private autoUpdateRef: ReturnType<typeof this.registerEvent> | null = null;

	async onload() {
		await this.loadSettings();
		this.engine = new MocEngine(this.app, this.settings);

		// Cache invalidation on metadata change
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.engine.invalidateCache();
			})
		);

		// Auto-update on save
		this.setupAutoUpdate();

		// Insert MOC at cursor (requires editor)
		this.addCommand({
			id: "insert-moc",
			name: "Insert MOC",
			editorCallback: (editor: Editor) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No active file");
					return;
				}

				new MocModeSuggestModal(
					this.app,
					this.settings.defaultDepth,
					this.settings.defaultIgnoreBlock,
					async (params: MocParams) => {
						const text = await this.engine.insertMoc(file, params);
						editor.replaceSelection(text);
						new Notice("MOC inserted");
					}
				).open();
			},
		});

		// One-click "Create MOC for current note" (appends to end)
		this.addCommand({
			id: "create-moc",
			name: "Create MOC for current note",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No active file");
					return;
				}

				new MocModeSuggestModal(
					this.app,
					this.settings.defaultDepth,
					this.settings.defaultIgnoreBlock,
					async (params: MocParams) => {
						const mocText = await this.engine.insertMoc(
							file,
							params
						);
						let content = await this.app.vault.read(file);
						content = content.trimEnd() + "\n\n" + mocText;
						await this.app.vault.modify(file, content);
						new Notice("MOC created in " + file.basename);
					}
				).open();
			},
		});

		this.addCommand({
			id: "update-moc",
			name: "Update MOC",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No active file");
					return;
				}

				const success = await this.engine.updateMoc(file);
				if (success) {
					this.invalidateTreeFingerprint();
					new Notice("MOC updated in " + file.basename);
				} else {
					new Notice("No MOC markers found in " + file.basename);
				}
			},
		});

		this.addCommand({
			id: "update-all-mocs",
			name: "Update All MOCs",
			callback: async () => {
				new Notice("Updating MOCs...", 5000);
				const count = await this.engine.updateAllMocs();
				this.invalidateTreeFingerprint();
				new Notice("MOC updated in " + count + " files", 5000);
			},
		});

		// Create new note under a MOC parent
		this.addCommand({
			id: "create-new-note",
			name: "Create new note",
			callback: () => {
				this.createNewNoteFlow();
			},
		});

		// #1: Quick-create child note (no modal)
		this.addCommand({
			id: "quick-create-child",
			name: "Quick-create child note",
			callback: () => {
				this.quickCreateChildFlow();
			},
		});

		// Reorder MOC children
		this.addCommand({
			id: "reorder-moc-children",
			name: "Reorder MOC children",
			callback: () => {
				this.reorderMocChildrenFlow();
			},
		});

		// Go to parent
		this.addCommand({
			id: "go-to-parent",
			name: "Go to parent",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				const parents = await this.engine.getParentFiles(file);
				if (parents.length === 0) {
					new Notice("No parent found");
				} else if (parents.length === 1) {
					await this.app.workspace.getLeaf(false).openFile(parents[0]);
				} else {
					new FileSuggestModal(this.app, parents, "Select parent", async (f) => {
						await this.app.workspace.getLeaf(false).openFile(f);
					}).open();
				}
			},
		});

		// Go to root
		this.addCommand({
			id: "go-to-root",
			name: "Go to root",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				const chain = await this.engine.getAncestorChain(file);
				if (chain.length === 0) {
					new Notice("This is already a root note");
				} else {
					const root = chain[chain.length - 1];
					await this.app.workspace.getLeaf(false).openFile(root);
				}
			},
		});

		// #8: Sibling navigation commands
		this.addCommand({
			id: "go-to-next-sibling",
			name: "Go to next sibling",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				const { next } = await this.engine.getSiblings(file);
				if (next) {
					await this.app.workspace.getLeaf(false).openFile(next);
				} else {
					new Notice("No next sibling");
				}
			},
		});

		this.addCommand({
			id: "go-to-prev-sibling",
			name: "Go to previous sibling",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				const { prev } = await this.engine.getSiblings(file);
				if (prev) {
					await this.app.workspace.getLeaf(false).openFile(prev);
				} else {
					new Notice("No previous sibling");
				}
			},
		});

		// Move note to parent
		this.addCommand({
			id: "move-note-to-parent",
			name: "Move note to parent",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }

				const allFiles = this.app.vault.getMarkdownFiles();
				const mocFiles = allFiles.filter((f) => this.engine.checkTagExist(f, this.settings.mocTag));
				const otherFiles = allFiles.filter((f) => !this.engine.checkTagExist(f, this.settings.mocTag));
				mocFiles.sort((a, b) => a.basename.localeCompare(b.basename));
				otherFiles.sort((a, b) => a.basename.localeCompare(b.basename));

				new ParentNoteSuggestModal(this.app, mocFiles, otherFiles, null, async (newParent) => {
					if (!newParent) { new Notice("No parent selected"); return; }

					const oldParents = await this.engine.getParentFiles(file);
					const upProp = this.settings.upProperties[0] || "up";

					if (oldParents.length > 0) {
						await this.engine.updateNoteParent(file, oldParents[0], newParent);
					} else {
						// No existing parent — add up property
						await this.app.fileManager.processFrontMatter(file, (fm: any) => {
							fm[upProp] = `[[${newParent.basename}]]`;
						});
					}

					this.engine.invalidateCache();

					// Update old parent MOCs
					for (const oldP of oldParents) {
						if (this.engine.checkTagExist(oldP, this.settings.mocTag)) {
							await this.engine.updateMoc(oldP);
						}
					}
					// Update new parent MOC
					if (this.engine.checkTagExist(newParent, this.settings.mocTag)) {
						await this.engine.updateMoc(newParent);
					}

					new Notice(`Moved to ${newParent.basename}`);
				}).open();
			},
		});

		// Find orphans (with bulk assign support)
		this.addCommand({
			id: "find-orphans",
			name: "Find orphan notes",
			callback: async () => {
				new Notice("Scanning for orphans...");
				const orphans = await this.engine.findOrphans();
				new OrphanListModal(
					this.app,
					orphans,
					(orphan) => this.assignParentToOrphan(orphan),
					(selected) => this.bulkAssignParent(selected)
				).open();
			},
		});

		// Edit MOC params
		this.addCommand({
			id: "edit-moc-params",
			name: "Edit MOC parameters",
			editorCallback: async (editor: Editor) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }

				const content = await this.app.vault.read(file);
				const cursor = editor.getCursor();
				const offset = editor.posToOffset(cursor);

				const regex = /%% START MOC (.+?) \[\[(.*?)\]\] %%\n([\s\S]*?)\n%% END MOC %%/g;
				let foundMatch: RegExpExecArray | null = null;
				let match: RegExpExecArray | null;
				while ((match = regex.exec(content)) !== null) {
					if (offset >= match.index && offset <= match.index + match[0].length) {
						foundMatch = match;
						break;
					}
				}

				if (!foundMatch) {
					new Notice("Place cursor inside a MOC marker block");
					return;
				}

				const rawParams = foundMatch[1];
				const noteName = foundMatch[2];
				const params = this.engine.parseMarkerParams(rawParams);

				new EditMocParamsModal(this.app, params, async (newParams) => {
					await this.engine.updateMoc(file);
					// Re-read and replace the marker with new params
					let text = await this.app.vault.read(file);
					const oldMarkerRegex = new RegExp(
						`%% START MOC .+? \\[\\[${noteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\] %%`,
					);
					const serialized = (this.engine as any).serializeMarkerParams
						? this.serializeParams(newParams)
						: "";
					text = text.replace(oldMarkerRegex, `%% START MOC ${serialized} [[${noteName}]] %%`);
					await this.app.vault.modify(file, text);
					await this.engine.updateMoc(file);
					new Notice("MOC parameters updated");
				}).open();
			},
		});

		// Toggle tree view
		this.addCommand({
			id: "toggle-tree-view",
			name: "Toggle Note Tree sidebar",
			callback: () => {
				this.toggleTreeView();
			},
		});

		// Reveal active file in tree
		this.addCommand({
			id: "reveal-in-tree",
			name: "Reveal active file in tree",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				const leaves = this.app.workspace.getLeavesOfType(NOTE_TREE_VIEW_TYPE);
				if (leaves.length === 0) {
					await this.toggleTreeView();
				}
				const treeLeaves = this.app.workspace.getLeavesOfType(NOTE_TREE_VIEW_TYPE);
				if (treeLeaves.length > 0) {
					const view = treeLeaves[0].view as NoteTreeView;
					await view.revealFile(file);
				}
			},
		});

		// Flatten branch — copy subtree as flat list
		this.addCommand({
			id: "flatten-branch",
			name: "Copy branch as flat list",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				const descendants = await this.engine.getDescendantsFlat(file);
				if (descendants.length === 0) {
					new Notice("No descendants found");
					return;
				}
				const lines = descendants.map((f) => `- [[${f.basename}]]`);
				await navigator.clipboard.writeText(lines.join("\n"));
				new Notice(`Copied ${lines.length} links to clipboard`);
			},
		});

		// #7: Promote to MOC
		this.addCommand({
			id: "promote-to-moc",
			name: "Promote to MOC",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				await this.promoteToMoc(file);
			},
		});

		// #7: Demote from MOC
		this.addCommand({
			id: "demote-from-moc",
			name: "Demote from MOC",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) { new Notice("No active file"); return; }
				await this.demoteFromMoc(file);
			},
		});

		// #10: Batch create children
		this.addCommand({
			id: "batch-create-children",
			name: "Batch create children",
			callback: () => {
				this.batchCreateChildrenFlow();
			},
		});

		// Context menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item) => {
						item.setTitle("Create MOC")
							.setIcon("list-tree")
							.onClick(() => {
								new MocModeSuggestModal(
									this.app,
									this.settings.defaultDepth,
									this.settings.defaultIgnoreBlock,
									async (params: MocParams) => {
										const mocText =
											await this.engine.insertMoc(
												file,
												params
											);
										let content =
											await this.app.vault.read(file);
										content =
											content.trimEnd() +
											"\n\n" +
											mocText;
										await this.app.vault.modify(
											file,
											content
										);
										new Notice(
											"MOC created in " + file.basename
										);
									}
								).open();
							});
					});

					if (this.engine.checkTagExist(file, this.settings.mocTag)) {
						menu.addItem((item) => {
							item.setTitle("Reorder children")
								.setIcon("arrow-up-down")
								.onClick(() => {
									this.openReorderModal(file);
								});
						});
					}
				}
			})
		);

		// Tree view registration — pass plugin as TreeViewHost
		this.registerView(
			NOTE_TREE_VIEW_TYPE,
			(leaf) => new NoteTreeView(leaf, this)
		);
		this.addRibbonIcon("network", "Note Tree", () => {
			this.toggleTreeView();
		});

		// Auto-update on delete
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!(file instanceof TFile)) return;
				const parents = this.engine.getParentsFromCache(file.path);
				this.engine.invalidateCache();
				for (const parent of parents) {
					if (this.engine.checkTagExist(parent, this.settings.mocTag)) {
						this.engine.updateMoc(parent);
					}
				}
			})
		);

		// Auto-update on rename
		this.registerEvent(
			this.app.vault.on("rename", async (file) => {
				if (!(file instanceof TFile)) return;
				this.engine.invalidateCache();
				const parents = await this.engine.getParentFiles(file);
				for (const parent of parents) {
					if (this.engine.checkTagExist(parent, this.settings.mocTag)) {
						await this.engine.updateMoc(parent);
					}
				}
			})
		);

		// Ribbon icon
		this.addRibbonIcon("list-tree", "Create MOC", () => {
			const file = this.app.workspace.getActiveFile();
			if (!file) {
				new Notice("No active file");
				return;
			}

			new MocModeSuggestModal(
				this.app,
				this.settings.defaultDepth,
				this.settings.defaultIgnoreBlock,
				async (params: MocParams) => {
					const mocText = await this.engine.insertMoc(file, params);
					let content = await this.app.vault.read(file);
					content = content.trimEnd() + "\n\n" + mocText;
					await this.app.vault.modify(file, content);
					new Notice("MOC created in " + file.basename);
				}
			).open();
		});

		// Status bar
		this.statusBarEl = this.addStatusBarItem();
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.updateStatusBar();
			})
		);

		// #2: Auto-detect/auto-assign parent for new notes created outside the plugin
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (!this.settings.autoDetectParent && !this.settings.autoAssignParent) return;
				if (!(file instanceof TFile)) return;
				if (file.extension !== "md") return;
				// Delay to let metadata settle
				setTimeout(async () => {
					const parents = await this.engine.getParentFiles(file);
					if (parents.length > 0) return; // already has a parent
					const likelyParent = await this.engine.findLikelyParent(file);
					if (!likelyParent) return;

					if (this.settings.autoAssignParent) {
						// Actually assign the parent
						const upProp = this.settings.upProperties[0] || "up";
						await this.app.fileManager.processFrontMatter(file, (fm: any) => {
							fm[upProp] = `[[${likelyParent.basename}]]`;
						});
						this.engine.invalidateCache();
						if (this.engine.checkTagExist(likelyParent, this.settings.mocTag)) {
							await this.engine.updateMoc(likelyParent);
						}
						new Notice(
							`Auto-assigned parent: ${likelyParent.basename}`,
							5000
						);
					} else {
						// Just suggest
						new Notice(
							`Suggested parent for "${file.basename}": ${likelyParent.basename}. Use "Move note to parent" to assign.`
						);
					}
				}, 2000);
			})
		);

		// Breadcrumb in reading mode
		this.registerMarkdownPostProcessor(async (el, ctx) => {
			const parent = el.parentElement;
			if (!parent || parent.querySelector(".moc-reading-breadcrumb")) return;

			const f = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
			if (!(f instanceof TFile)) return;

			const chain = await this.engine.getAncestorChain(f);
			if (chain.length === 0) return;

			// Double-check after async
			if (parent.querySelector(".moc-reading-breadcrumb")) return;

			const breadcrumb = createDiv({ cls: "moc-reading-breadcrumb" });
			const reversed = [...chain].reverse();
			for (let i = 0; i < reversed.length; i++) {
				if (i > 0) {
					breadcrumb.createSpan({ cls: "moc-breadcrumb-separator", text: " > " });
				}
				const seg = breadcrumb.createSpan({
					cls: "moc-breadcrumb-segment",
					text: reversed[i].basename,
				});
				const target = reversed[i];
				seg.addEventListener("click", () => {
					this.app.workspace.getLeaf(false).openFile(target);
				});
			}
			breadcrumb.createSpan({ cls: "moc-breadcrumb-separator", text: " > " });
			breadcrumb.createSpan({
				cls: "moc-breadcrumb-segment",
				text: f.basename,
			});

			parent.insertBefore(breadcrumb, parent.firstChild);
		});

		this.addSettingTab(new MocGeneratorSettingTab(this.app, this));
	}

	onunload() {
		if (this.autoUpdateTimer) {
			clearTimeout(this.autoUpdateTimer);
		}
	}

	private async updateStatusBar(): Promise<void> {
		if (!this.statusBarEl) return;
		this.statusBarEl.empty();
		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const chain = await this.engine.getAncestorChain(file);
		if (chain.length === 0) {
			const count = this.engine.getChildCount(file);
			if (count !== null && count > 0) {
				const stale = await this.engine.isMocStale(file);
				this.statusBarEl.textContent = `MOC: ${count} children${stale ? " (outdated)" : ""}`;
			}
			return;
		}

		const breadcrumb = this.statusBarEl.createSpan({ cls: "moc-breadcrumb" });
		const reversed = [...chain].reverse();
		for (let i = 0; i < reversed.length; i++) {
			if (i > 0) {
				breadcrumb.createSpan({ cls: "moc-breadcrumb-separator", text: " > " });
			}
			const seg = breadcrumb.createSpan({
				cls: "moc-breadcrumb-segment",
				text: reversed[i].basename,
			});
			const targetFile = reversed[i];
			seg.addEventListener("click", () => {
				this.app.workspace.getLeaf(false).openFile(targetFile);
			});
		}
		breadcrumb.createSpan({ cls: "moc-breadcrumb-separator", text: " > " });
		breadcrumb.createSpan({
			cls: "moc-breadcrumb-segment",
			text: file.basename,
		});
	}

	private async createNewNoteFlow(): Promise<void> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const mocFiles: TFile[] = [];
		const otherFiles: TFile[] = [];

		for (const f of allFiles) {
			if (this.engine.checkTagExist(f, this.settings.mocTag)) {
				mocFiles.push(f);
			} else {
				otherFiles.push(f);
			}
		}

		mocFiles.sort((a, b) => a.basename.localeCompare(b.basename));
		otherFiles.sort((a, b) => a.basename.localeCompare(b.basename));

		// Auto-detect parent from context
		let preselected: TFile | null = null;
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			if (this.engine.checkTagExist(activeFile, this.settings.mocTag)) {
				preselected = activeFile;
			} else {
				const parentMocs = await this.engine.getParentMocs(activeFile);
				if (parentMocs.length > 0) {
					preselected = parentMocs[0];
				}
			}
		}

		new ParentNoteSuggestModal(
			this.app,
			mocFiles,
			otherFiles,
			preselected,
			async (parentFile: TFile | null) => {
				// Compute default priority from siblings
				let defaultPriority = this.settings.newNoteDefaultPriority;
				if (parentFile) {
					const maxPriority = await this.engine.getMaxChildPriority(parentFile);
					defaultPriority = maxPriority > 0 ? maxPriority + 10 : 10;
				}

				new CreateNoteModal(
					this.app,
					defaultPriority,
					async (info: NewNoteInfo) => {
						if (!info.name.trim()) {
							new Notice("Note name cannot be empty");
							return;
						}

						const parentDir = parentFile
							? (parentFile.parent?.path ?? "")
							: (activeFile?.parent?.path ?? "");
						const filePath = parentDir
							? `${parentDir}/${info.name}.md`
							: `${info.name}.md`;

						if (this.app.vault.getAbstractFileByPath(filePath)) {
							new Notice("File already exists: " + filePath);
							return;
						}

						const newFile = await this.createNoteFromTemplate(info.name, parentFile, info.isMoc, info.priority, info.aliases);
						if (!newFile) return;

						await this.app.workspace.getLeaf(false).openFile(newFile);

						// Auto-update parent MOC
						if (parentFile && this.engine.checkTagExist(parentFile, this.settings.mocTag)) {
							this.engine.invalidateCache();
							await this.engine.updateMoc(parentFile);
						}

						new Notice("Created: " + info.name);
					}
				).open();
			}
		).open();
	}

	// #1: Quick-create child note (no modal)
	private async quickCreateChildFlow(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) { new Notice("No active file"); return; }

		let parentFile: TFile | null = null;
		if (this.engine.checkTagExist(activeFile, this.settings.mocTag)) {
			parentFile = activeFile;
		} else {
			const parentMocs = await this.engine.getParentMocs(activeFile);
			if (parentMocs.length > 0) {
				parentFile = parentMocs[0];
			}
		}

		if (!parentFile) {
			new Notice("No parent MOC found. Open a MOC or a note with a parent MOC.");
			return;
		}

		const finalParent = parentFile;
		new TextInputModal(
			this.app,
			"Quick create child note",
			"Note name",
			async (name) => {
				if (!name.trim()) {
					new Notice("Note name cannot be empty");
					return;
				}

				const maxPriority = await this.engine.getMaxChildPriority(finalParent);
				const priority = maxPriority > 0 ? maxPriority + 10 : 10;

				const newFile = await this.createNoteFromTemplate(name, finalParent, false, priority, "");
				if (!newFile) return;

				await this.app.workspace.getLeaf(false).openFile(newFile);

				if (this.engine.checkTagExist(finalParent, this.settings.mocTag)) {
					this.engine.invalidateCache();
					await this.engine.updateMoc(finalParent);
				}

				new Notice("Created: " + name);
			}
		).open();
	}

	// #10: Batch create children flow (from command palette)
	private async batchCreateChildrenFlow(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) { new Notice("No active file"); return; }

		let parentFile: TFile | null = null;
		if (this.engine.checkTagExist(activeFile, this.settings.mocTag)) {
			parentFile = activeFile;
		} else {
			const parentMocs = await this.engine.getParentMocs(activeFile);
			if (parentMocs.length > 0) {
				parentFile = parentMocs[0];
			}
		}

		if (!parentFile) {
			new Notice("No parent MOC found");
			return;
		}

		this.batchCreateChildren(parentFile);
	}

	// Shared helper to create a note from template
	private async createNoteFromTemplate(
		name: string,
		parentFile: TFile | null,
		isMoc: boolean,
		priority: number,
		aliases: string
	): Promise<TFile | null> {
		const parentDir = parentFile
			? (parentFile.parent?.path ?? "")
			: (this.app.workspace.getActiveFile()?.parent?.path ?? "");
		const filePath = parentDir
			? `${parentDir}/${name}.md`
			: `${name}.md`;

		if (this.app.vault.getAbstractFileByPath(filePath)) {
			new Notice("File already exists: " + filePath);
			return null;
		}

		const today = new Date().toISOString().slice(0, 10);
		const upLine = parentFile
			? `up:: [[${parentFile.basename}]]`
			: "";
		const heading = parentFile
			? `${parentFile.basename} - ${name}`
			: name;
		const tagsLine = isMoc
			? `tags: [${this.settings.mocTag}]`
			: `tags: []`;

		const content = this.settings.newNoteTemplate
			.replace(/\{\{date\}\}/g, today)
			.replace(/\{\{parent\}\}/g, parentFile?.basename ?? "")
			.replace(/\{\{name\}\}/g, name)
			.replace(/\{\{aliases\}\}/g, aliases)
			.replace(/\{\{priority\}\}/g, String(priority))
			.replace(/\{\{up_line\}\}/g, upLine)
			.replace(/\{\{heading\}\}/g, heading)
			.replace(/\{\{tags_line\}\}/g, tagsLine);

		return await this.app.vault.create(filePath, content);
	}

	private async reorderMocChildrenFlow(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active file");
			return;
		}

		if (this.engine.checkTagExist(activeFile, this.settings.mocTag)) {
			await this.openReorderModal(activeFile);
		} else {
			const parentMocs = await this.engine.getParentMocs(activeFile);
			if (parentMocs.length === 0) {
				new Notice("No parent MOC found");
				return;
			}
			if (parentMocs.length === 1) {
				await this.openReorderModal(parentMocs[0]);
			} else {
				// Let user pick which parent MOC
				new ParentNoteSuggestModal(
					this.app,
					parentMocs,
					[],
					null,
					async (file: TFile | null) => {
						if (file) await this.openReorderModal(file);
					}
				).open();
			}
		}
	}

	private async openReorderModal(mocFile: TFile): Promise<void> {
		const tree = await this.engine.getChildrenTree(mocFile);

		// Build original parent map for diffing moves
		const originalParentMap = new Map<string, TFile>();
		for (const g of tree) {
			for (const child of g.children) {
				originalParentMap.set(child.file.path, g.parent);
			}
		}

		const groupsData: ReorderGroupData[] = tree.map((g) => ({
			parent: g.parent,
			label: g.parent.basename,
			items: [...g.children],
		}));

		if (groupsData.every((g) => g.items.length === 0)) {
			new Notice("No children found for " + mocFile.basename);
			return;
		}

		new ReorderModal(this.app, groupsData, async (resultGroups: ReorderGroupData[]) => {
			// 1. Renumber priorities in each group
			for (const group of resultGroups) {
				const items = group.items.map((item, i) => ({
					file: item.file,
					newPriority: (i + 1) * 10,
				}));
				await this.engine.renumberPriorities(items);
			}

			// 2. Update parents for items that moved between groups
			for (const group of resultGroups) {
				for (const item of group.items) {
					const originalParent = originalParentMap.get(item.file.path);
					if (originalParent && originalParent.path !== group.parent.path) {
						await this.engine.updateNoteParent(
							item.file,
							originalParent,
							group.parent
						);
					}
				}
			}

			// 3. Update affected MOCs
			const affectedMocs = new Set<string>();
			affectedMocs.add(mocFile.path);
			for (const group of resultGroups) {
				affectedMocs.add(group.parent.path);
			}
			for (const mocPath of affectedMocs) {
				const f = this.app.vault.getAbstractFileByPath(mocPath);
				if (f instanceof TFile) {
					await this.engine.updateMoc(f);
				}
			}

			new Notice("Reordered children");
		}).open();
	}

	// Smart auto-update
	private setupAutoUpdate(): void {
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!this.settings.autoUpdateOnSave) return;
				if (this.isUpdating) return;
				if (!(file instanceof TFile)) return;
				if (this.autoUpdateTimer) clearTimeout(this.autoUpdateTimer);
				this.autoUpdateTimer = setTimeout(async () => {
					this.isUpdating = true;
					try {
						this.engine.invalidateCache();
						// If the modified file is a MOC, update it
						if (this.engine.checkTagExist(file, this.settings.mocTag)) {
							if (!this.engine.isAutoUpdateDisabled(file)) {
								await this.engine.updateMoc(file);
							}
						}
						// Update parent MOCs of the modified file
						const parents = await this.engine.getParentFiles(file);
						for (const parent of parents) {
							if (this.engine.checkTagExist(parent, this.settings.mocTag)) {
								if (!this.engine.isAutoUpdateDisabled(parent)) {
									await this.engine.updateMoc(parent);
								}
							}
						}
					this.invalidateTreeFingerprint();
					} finally {
						this.isUpdating = false;
					}
				}, this.settings.autoUpdateDebounceMs);
			})
		);
	}

	private async toggleTreeView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(NOTE_TREE_VIEW_TYPE);
		if (existing.length > 0) {
			existing[0].detach();
		} else {
			const leaf = this.app.workspace.getLeftLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: NOTE_TREE_VIEW_TYPE, active: true });
				this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	// TreeViewHost: create child note under a parent
	createChildNote(parentFile: TFile): void {
		const computeAndCreate = async () => {
			let defaultPriority = this.settings.newNoteDefaultPriority;
			const maxPriority = await this.engine.getMaxChildPriority(parentFile);
			defaultPriority = maxPriority > 0 ? maxPriority + 10 : 10;

			new CreateNoteModal(
				this.app,
				defaultPriority,
				async (info: NewNoteInfo) => {
					if (!info.name.trim()) {
						new Notice("Note name cannot be empty");
						return;
					}

					const newFile = await this.createNoteFromTemplate(
						info.name, parentFile, info.isMoc, info.priority, info.aliases
					);
					if (!newFile) return;

					await this.app.workspace.getLeaf(false).openFile(newFile);

					if (this.engine.checkTagExist(parentFile, this.settings.mocTag)) {
						this.engine.invalidateCache();
						await this.engine.updateMoc(parentFile);
					}

					new Notice("Created: " + info.name);
				}
			).open();
		};
		computeAndCreate();
	}

	// TreeViewHost: add existing note as child
	addExistingChildToParent(parentFile: TFile): void {
		const allFiles = this.app.vault.getMarkdownFiles()
			.filter((f) => f.path !== parentFile.path)
			.sort((a, b) => a.basename.localeCompare(b.basename));

		new FileSuggestModal(this.app, allFiles, "Select note to add as child", async (file) => {
			const upProp = this.settings.upProperties[0] || "up";
			const existingParents = await this.engine.getParentFiles(file);

			if (existingParents.length > 0) {
				// Replace first parent
				await this.engine.updateNoteParent(file, existingParents[0], parentFile);
			} else {
				await this.app.fileManager.processFrontMatter(file, (fm: any) => {
					fm[upProp] = `[[${parentFile.basename}]]`;
				});
			}

			this.engine.invalidateCache();
			if (this.engine.checkTagExist(parentFile, this.settings.mocTag)) {
				await this.engine.updateMoc(parentFile);
			}
			new Notice(`Added ${file.basename} under ${parentFile.basename}`);
		}).open();
	}

	/** Tell the tree view to rebuild on the next debounced cycle. */
	private invalidateTreeFingerprint(): void {
		const leaves = this.app.workspace.getLeavesOfType(NOTE_TREE_VIEW_TYPE);
		if (leaves.length > 0) {
			(leaves[0].view as NoteTreeView).invalidateFingerprint();
		}
	}

	// #4: TreeViewHost: update MOC
	async updateMoc(file: TFile): Promise<void> {
		await this.engine.updateMoc(file);
		this.invalidateTreeFingerprint();
		new Notice("MOC updated: " + file.basename);
	}

	// #7: TreeViewHost: promote to MOC
	async promoteToMoc(file: TFile): Promise<void> {
		await this.engine.addMocTag(file);
		await this.engine.updateMoc(file);
		this.engine.invalidateCache();
		this.invalidateTreeFingerprint();
		new Notice("Promoted to MOC: " + file.basename);
	}

	// #7: TreeViewHost: demote from MOC
	async demoteFromMoc(file: TFile): Promise<void> {
		await this.engine.removeMocTag(file);
		await this.engine.removeMocMarkers(file);
		this.engine.invalidateCache();
		this.invalidateTreeFingerprint();
		new Notice("Demoted from MOC: " + file.basename);
	}

	// #10: TreeViewHost: batch create children
	batchCreateChildren(parentFile: TFile): void {
		new BatchCreateModal(this.app, async (result) => {
			let created = 0;
			const maxPriority = await this.engine.getMaxChildPriority(parentFile);
			let priority = maxPriority > 0 ? maxPriority + 10 : 10;

			for (const name of result.names) {
				const newFile = await this.createNoteFromTemplate(
					name, parentFile, result.isMoc, priority, ""
				);
				if (newFile) {
					created++;
					priority += 10;
				}
			}

			if (created > 0) {
				this.engine.invalidateCache();
				if (this.engine.checkTagExist(parentFile, this.settings.mocTag)) {
					await this.engine.updateMoc(parentFile);
				}
			}

			new Notice(`Created ${created} notes under ${parentFile.basename}`);
		}).open();
	}

	// Bulk assign parent to multiple orphans
	private async bulkAssignParent(orphans: TFile[]): Promise<void> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const mocFiles = allFiles.filter((f) => this.engine.checkTagExist(f, this.settings.mocTag));
		const otherFiles = allFiles.filter((f) => !this.engine.checkTagExist(f, this.settings.mocTag));
		mocFiles.sort((a, b) => a.basename.localeCompare(b.basename));
		otherFiles.sort((a, b) => a.basename.localeCompare(b.basename));

		new ParentNoteSuggestModal(this.app, mocFiles, otherFiles, null, async (newParent) => {
			if (!newParent) return;
			const upProp = this.settings.upProperties[0] || "up";

			for (const orphan of orphans) {
				await this.app.fileManager.processFrontMatter(orphan, (fm: any) => {
					fm[upProp] = `[[${newParent.basename}]]`;
				});
			}

			this.engine.invalidateCache();
			if (this.engine.checkTagExist(newParent, this.settings.mocTag)) {
				await this.engine.updateMoc(newParent);
			}
			new Notice(`Assigned ${orphans.length} notes to ${newParent.basename}`);
		}).open();
	}

	private async assignParentToOrphan(orphan: TFile): Promise<void> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const mocFiles = allFiles.filter((f) => this.engine.checkTagExist(f, this.settings.mocTag));
		const otherFiles = allFiles.filter((f) => !this.engine.checkTagExist(f, this.settings.mocTag));
		mocFiles.sort((a, b) => a.basename.localeCompare(b.basename));
		otherFiles.sort((a, b) => a.basename.localeCompare(b.basename));

		new ParentNoteSuggestModal(this.app, mocFiles, otherFiles, null, async (newParent) => {
			if (!newParent) return;
			const upProp = this.settings.upProperties[0] || "up";
			await this.app.fileManager.processFrontMatter(orphan, (fm: any) => {
				fm[upProp] = `[[${newParent.basename}]]`;
			});
			this.engine.invalidateCache();
			if (this.engine.checkTagExist(newParent, this.settings.mocTag)) {
				await this.engine.updateMoc(newParent);
			}
			new Notice(`Assigned ${orphan.basename} to ${newParent.basename}`);
		}).open();
	}

	private serializeParams(params: MocParams): string {
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

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// Backward compat: migrate upProperty → upProperties
		if (data?.upProperty && !data?.upProperties) {
			this.settings.upProperties = [data.upProperty];
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.engine = new MocEngine(this.app, this.settings);
	}
}

class MocGeneratorSettingTab extends PluginSettingTab {
	plugin: MocGeneratorPlugin;

	constructor(app: App, plugin: MocGeneratorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "MOC Generator Settings" });

		// Multiple parent properties
		new Setting(containerEl)
			.setName("Parent properties")
			.setDesc(
				"Comma-separated list of frontmatter/inline properties used for parent links (e.g. up, parent, category)"
			)
			.addText((text) =>
				text
					.setPlaceholder("up")
					.setValue(this.plugin.settings.upProperties.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.upProperties = value
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("MOC tag")
			.setDesc("Tag that marks files as MOCs")
			.addText((text) =>
				text
					.setPlaceholder("moc")
					.setValue(this.plugin.settings.mocTag)
					.onChange(async (value) => {
						this.plugin.settings.mocTag = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("MOC block tag")
			.setDesc(
				"Tag that stops recursion in list mode (when ignore-block is off)"
			)
			.addText((text) =>
				text
					.setPlaceholder("moc-block")
					.setValue(this.plugin.settings.mocBlockTag)
					.onChange(async (value) => {
						this.plugin.settings.mocBlockTag = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Embed ignore tag")
			.setDesc("Tag that excludes notes from embedded mode")
			.addText((text) =>
				text
					.setPlaceholder("moc-emb-ignore")
					.setValue(this.plugin.settings.embIgnoreTag)
					.onChange(async (value) => {
						this.plugin.settings.embIgnoreTag = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Defaults" });

		new Setting(containerEl)
			.setName("Default depth")
			.setDesc("Default recursion depth for new MOCs (0 = unlimited)")
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.defaultDepth))
					.onChange(async (value) => {
						this.plugin.settings.defaultDepth =
							parseInt(value) || 0;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default ignore block")
			.setDesc(
				"Ignore moc-block tag by default when creating new MOCs"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultIgnoreBlock)
					.onChange(async (value) => {
						this.plugin.settings.defaultIgnoreBlock = value;
						await this.plugin.saveSettings();
					})
			);

		// Custom sorting
		new Setting(containerEl)
			.setName("Default sort")
			.setDesc("Default sorting for MOC entries")
			.addDropdown((dd) =>
				dd
					.addOptions({
						priority: "Priority \u2192 Alphabetical",
						alphabetical: "Alphabetical",
						created: "Created date",
						modified: "Modified date",
						custom: "Custom frontmatter field",
					})
					.setValue(this.plugin.settings.defaultSort)
					.onChange(async (value: string) => {
						this.plugin.settings.defaultSort = value as any;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Custom sort field")
			.setDesc(
				"Frontmatter field name for custom sorting (when sort = custom)"
			)
			.addText((text) =>
				text
					.setPlaceholder("order")
					.setValue(this.plugin.settings.customSortField)
					.onChange(async (value) => {
						this.plugin.settings.customSortField = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "New Note" });

		new Setting(containerEl)
			.setName("Default priority")
			.setDesc("Default priority value for new notes")
			.addText((text) =>
				text
					.setPlaceholder("100")
					.setValue(String(this.plugin.settings.newNoteDefaultPriority))
					.onChange(async (value) => {
						this.plugin.settings.newNoteDefaultPriority =
							parseInt(value) || 100;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("New note template")
			.setDesc(
				"Template for new notes. Variables: {{date}}, {{parent}}, {{name}}, {{aliases}}, {{priority}}, {{up_line}}, {{heading}}, {{tags_line}}"
			)
			.addTextArea((text) => {
				text.setPlaceholder("Template...")
					.setValue(this.plugin.settings.newNoteTemplate)
					.onChange(async (value) => {
						this.plugin.settings.newNoteTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 12;
				text.inputEl.cols = 50;
			});

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Reset template to default").onClick(async () => {
				this.plugin.settings.newNoteTemplate = DEFAULT_NEW_NOTE_TEMPLATE;
				await this.plugin.saveSettings();
				this.display();
			})
		);

		containerEl.createEl("h3", { text: "Automation" });

		// Auto-update on save
		new Setting(containerEl)
			.setName("Auto-update on save")
			.setDesc(
				"Automatically update MOCs when files are modified (with debouncing). Respects per-note moc-auto-update: false in frontmatter."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoUpdateOnSave)
					.onChange(async (value) => {
						this.plugin.settings.autoUpdateOnSave = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-update debounce (ms)")
			.setDesc("Delay before auto-update triggers after a file change")
			.addText((text) =>
				text
					.setPlaceholder("2000")
					.setValue(String(this.plugin.settings.autoUpdateDebounceMs))
					.onChange(async (value) => {
						this.plugin.settings.autoUpdateDebounceMs = parseInt(value) || 2000;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-detect parent for new notes")
			.setDesc("Suggest a parent based on folder or links when a note is created outside the plugin")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoDetectParent)
					.onChange(async (value) => {
						this.plugin.settings.autoDetectParent = value;
						await this.plugin.saveSettings();
					})
			);

		// #2: Auto-assign parent setting
		new Setting(containerEl)
			.setName("Auto-assign parent for new notes")
			.setDesc("Automatically assign the detected parent (not just suggest). Overrides auto-detect when enabled.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAssignParent)
					.onChange(async (value) => {
						this.plugin.settings.autoAssignParent = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Tree View" });

		new Setting(containerEl)
			.setName("Auto-reveal active file")
			.setDesc("Automatically reveal and highlight the active file in the tree sidebar")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoRevealInTree)
					.onChange(async (value) => {
						this.plugin.settings.autoRevealInTree = value;
						await this.plugin.saveSettings();
					})
			);

		// #9: Recently modified indicator hours
		new Setting(containerEl)
			.setName("Recently modified threshold (hours)")
			.setDesc("Notes modified within this many hours show a blue dot in the tree")
			.addText((text) =>
				text
					.setPlaceholder("24")
					.setValue(String(this.plugin.settings.recentModifiedHours))
					.onChange(async (value) => {
						this.plugin.settings.recentModifiedHours = parseInt(value) || 24;
						await this.plugin.saveSettings();
					})
			);
	}
}
