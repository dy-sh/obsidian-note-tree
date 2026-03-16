import { TFile } from "obsidian";

// Legacy MOC types (kept for backward-compat marker parsing)
export const LegacyMocType: Record<string, string> = {
	LIST: "LIST",
	LIST_IGNORE_BLOCK: "LIST_IGNORE_BLOCK",
	LIST_1: "LIST_1",
	LIST_1_IGNORE_BLOCK: "LIST_1_IGNORE_BLOCK",
	LIST_2: "LIST_2",
	LIST_2_IGNORE_BLOCK: "LIST_2_IGNORE_BLOCK",
	LIST_3: "LIST_3",
	LIST_3_IGNORE_BLOCK: "LIST_3_IGNORE_BLOCK",
	EMBEDDED: "EMBEDDED",
} as const;

export type MocMode = "list" | "embedded" | "folder" | "tag";
export type SortBy = "priority" | "alphabetical" | "created" | "modified" | "custom";

export interface MocParams {
	mode: MocMode;
	depth: number; // 0 = unlimited
	ignoreBlock: boolean;
	sort?: SortBy;
	customSortField?: string;
	include?: string; // include only notes with this tag
	exclude?: string; // exclude notes with this tag
	folderPath?: string; // for folder mode
	tagFilter?: string; // for tag mode
}

export interface MocGeneratorSettings {
	upProperties: string[];
	mocTag: string;
	mocBlockTag: string;
	embIgnoreTag: string;
	defaultDepth: number;
	defaultIgnoreBlock: boolean;
	defaultSort: SortBy;
	customSortField: string;
	autoUpdateOnSave: boolean;
	autoUpdateDebounceMs: number;
	newNoteTemplate: string;
	newNoteDefaultPriority: number;
	autoRevealInTree: boolean;
	autoDetectParent: boolean;
	autoAssignParent: boolean;
	recentModifiedHours: number;
}

export const DEFAULT_NEW_NOTE_TEMPLATE = `---
date created: {{date}}
date modified: {{date}}
aliases: [{{aliases}}]
{{tags_line}}
priority: {{priority}}
---
{{up_line}}

# {{heading}}

`;

export const DEFAULT_SETTINGS: MocGeneratorSettings = {
	upProperties: ["up"],
	mocTag: "moc",
	mocBlockTag: "moc-block",
	embIgnoreTag: "moc-emb-ignore",
	defaultDepth: 0,
	defaultIgnoreBlock: false,
	defaultSort: "priority",
	customSortField: "",
	autoUpdateOnSave: false,
	autoUpdateDebounceMs: 2000,
	newNoteTemplate: DEFAULT_NEW_NOTE_TEMPLATE,
	newNoteDefaultPriority: 100,
	autoRevealInTree: false,
	autoDetectParent: false,
	autoAssignParent: false,
	recentModifiedHours: 24,
};

export interface NoteInfo {
	file: TFile;
	priority: number;
}
