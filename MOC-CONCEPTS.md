# MOC Concepts & Principles

This document explains the Maps of Content (MOC) methodology as implemented by the Note Tree plugin.

## What is a MOC?

A **Map of Content** is a note that serves as an index — a curated list of links to related notes organized into a hierarchy. Unlike folders, MOCs are flexible: a single note can appear in multiple MOCs, and MOCs can nest inside other MOCs to form a multi-level knowledge structure.

MOCs solve the "where does this note go?" problem. Instead of forcing notes into a rigid folder tree, you link each note upward to one or more parent MOCs. The plugin then auto-generates the downward-facing index.

## The Two-Direction Navigation

The core idea of Note Tree is **bidirectional navigation**:

- **Down** — every MOC auto-generates a list of its children, so you can drill into any topic
- **Up** — every child note has an `up:: [[Parent]]` link, so you can always navigate back

This means you're never lost. From any note in your vault, you can go up to see the broader context, or down to explore details. The entire vault becomes a navigable tree.

## Core Principles

### 1. Bottom-up linking

Every child note declares its parent via an **up-property** (default: `up`). The plugin reads these declarations and builds the tree from the bottom up.

```
Child Note  →  up:: [[Parent MOC]]  →  Parent MOC contains list of children
```

This is the inverse of manually maintaining a list of links in each MOC. You never edit the MOC list by hand — the plugin generates it.

### 2. Tag-based identification

A note becomes a MOC when it carries a specific tag (default: `#moc`). The plugin uses this tag to:
- Know which files to update during "Update All MOCs"
- Show child counts in the status bar
- Prioritize MOC files in the parent picker
- Show "Reorder children" in the context menu

### 3. Priority-based ordering

Each note can have a `priority` frontmatter field (numeric). Lower values appear first. Notes without a priority sort to the end. Among notes with equal priority, alphabetical order is used as a tiebreaker.

You don't need to manage priority numbers manually — the **Reorder MOC children** command lets you drag-and-drop notes into the desired order and automatically renumbers priorities (10, 20, 30...).

### 4. One MOC per category

Every category or sub-category in your knowledge base should be **its own MOC file**. A MOC doesn't just list leaf notes — it lists sub-MOCs too, each of which manages its own children. This creates a tree of MOC files, where each MOC is responsible for one level of the hierarchy.

For example, say you're organizing programming knowledge:

```
Home (MOC)
├── Programming (MOC)        ← up:: [[Home]]
│   ├── Languages (MOC)      ← up:: [[Programming]]
│   │   ├── Python           ← up:: [[Languages]]
│   │   └── Rust             ← up:: [[Languages]]
│   └── Tools (MOC)          ← up:: [[Programming]]
│       └── Git              ← up:: [[Tools]]
└── Music (MOC)              ← up:: [[Home]]
    └── Guitar               ← up:: [[Music]]
```

Here, **Programming**, **Languages**, **Tools**, and **Music** are all separate MOC files (tagged `#moc`), each generating its own child list. The **Home** MOC only lists its direct children (Programming, Music) — it doesn't need to know about Python or Git.

### 5. Recursive traversal across MOCs

When a parent MOC generates its list, the plugin can optionally recurse into child MOCs to show a deeper preview:

```
- [[Languages]]
    - [[Python]]
    - [[Rust]]
- [[Tools]]
    - [[Git]]
```

This is controlled by the `depth` parameter. With `depth=1`, a MOC only shows its direct children. With `depth=0` (unlimited), it shows the full subtree. You can also tag a sub-MOC with `#moc-block` to stop a parent from recursing into it — the sub-MOC still generates its own list, but the parent stops at that boundary.

## Note Format

### Child note (regular note)

```yaml
---
date created: 2026-03-16
date modified: 2026-03-16
aliases: []
tags: []
priority: 20
---
up:: [[Programming]]

# Programming - Python

Note content here...
```

Key fields:
- **`up`** — inline dataview field linking to the parent. Can also be in frontmatter as `up: "[[Parent]]"`.
- **`priority`** — numeric sort order among siblings. Managed automatically via the reorder modal.
- **`aliases`** — alternative names for the note.

### MOC note

A MOC looks like any other note but has the `moc` tag and contains a generated marker block:

```yaml
---
tags: [moc]
priority: 10
---
up:: [[Knowledge]]

# Knowledge - Programming
```

Below the content, the plugin inserts:

```markdown
%% START MOC list [[Programming]] %%

- [[Languages]]
    - [[Python]]
    - [[Rust]]
- [[Tools]]
    - [[Git]]

%% END MOC %%
```

The marker comments (`%% START MOC ... %%` / `%% END MOC %%`) tell the plugin where to regenerate content. Everything outside the markers is untouched.

### Standalone note (no parent)

Notes can also be created without a parent:

```yaml
---
date created: 2026-03-16
date modified: 2026-03-16
aliases: []
tags: []
priority: 10
---

# My Standalone Note

Content here...
```

No `up::` line, simpler heading. Useful for top-level entry points or notes that don't belong to any hierarchy yet.

## MOC Modes

| Mode | Marker | Behavior |
|------|--------|----------|
| **list** | `list` | Nested bullet list of child notes via parent-property links. Respects `moc-block` tag to stop recursion. |
| **embedded** | `embedded` | Headings with embedded note content (`![[note]]`). Skips notes tagged `moc-emb-ignore`. |
| **folder** | `folder path=Some/Folder` | Lists all markdown files in a folder (recursively). |
| **tag** | `tag tag=#sometag` | Lists all notes carrying a specific tag. |

### Marker parameters

The marker format supports inline parameters:

```
%% START MOC list depth=2 sort=alphabetical include=python exclude=draft [[Programming]] %%
```

| Parameter | Example | Description |
|-----------|---------|-------------|
| `depth=N` | `depth=2` | Limit recursion depth (0 = unlimited) |
| `ignore-block` | — | Ignore `moc-block` tag |
| `sort=X` | `sort=alphabetical` | Sort order: `priority`, `alphabetical`, `created`, `modified`, `custom` |
| `include=tag` | `include=python` | Only include notes with this tag |
| `exclude=tag` | `exclude=draft` | Exclude notes with this tag |
| `path=X` | `path=Notes/Topics` | Folder path (folder mode) |
| `tag=X` | `tag=#topic` | Tag filter (tag mode) |

## Creating New Notes

Always use the **"Create new note"** command to add notes to your vault. Creating notes manually means you have to set up the `up` link, `priority`, tags, and file location by hand — and if you forget any of these, the note won't appear in the tree. The command does all of this automatically:

1. **Parent picker** — shows all vault files (MOCs first, then others). The plugin auto-detects context:
   - If the current file is a MOC → pre-selects it
   - If the current file has an `up` link to a MOC → pre-selects that MOC
   - You can also choose "(No parent)" for standalone notes

2. **Note details** — enter name and aliases. Priority is assigned automatically (`max sibling priority + 10`).

3. **Create as MOC** — optional toggle that adds the `moc` tag, turning the new note into a sub-category.

The note is created in the same folder as the parent (or the current file's folder if no parent), gets the correct `up` link and priority, applies your note template, and opens automatically — ready to write.

## Reordering Children

The **"Reorder MOC children"** command opens a visual modal that shows:

- **Root group** — direct children of the current MOC
- **Sub-category groups** — children of each sub-MOC, shown as separate sections

You can:
- **Drag and drop** items within a group to reorder them
- **Drag items between groups** to move a note from one sub-category to another (this updates the `up` link automatically)
- **Use Up/Down buttons** or **Alt+Arrow keys** as alternatives to drag

On save, the plugin automatically renumbers `priority` values (10, 20, 30...) and updates all affected MOC files.

## Template Variables

The new note template supports these variables:

| Variable | Description |
|----------|-------------|
| `{{date}}` | Today's date (YYYY-MM-DD) |
| `{{name}}` | Note name |
| `{{parent}}` | Parent note basename (empty if no parent) |
| `{{aliases}}` | Comma-separated aliases |
| `{{priority}}` | Numeric priority |
| `{{up_line}}` | Full `up:: [[Parent]]` line, or empty string if no parent |
| `{{heading}}` | `Parent - Name` if parent exists, otherwise just `Name` |
| `{{tags_line}}` | `tags: [moc]` if "Create as MOC" is on, otherwise `tags: []` |

## Relationship to Folders

MOCs and folders serve complementary purposes:

- **Folders** = physical file organization on disk
- **MOCs** = logical knowledge organization via links

A note in `Notes/Programming/Python.md` can have `up:: [[Languages]]` where `Languages.md` lives in a completely different folder. The plugin doesn't care about folder structure — it follows links.

That said, the "Create new note" command places new files in the parent's folder by default, so physical and logical organization can stay aligned if you prefer.

## Best Practices

- **One primary parent** — while notes can have multiple `up` links, keeping one primary parent per note makes the hierarchy cleaner.
- **Use the reorder modal** — don't edit `priority` numbers by hand. The "Reorder MOC children" command handles numbering automatically.
- **Top-level MOC** — create a single root MOC (e.g., "Home" or "Index") that links to your major topic MOCs. This gives you one entry point to your entire knowledge base.
- **Block recursion wisely** — tag sub-MOCs with `#moc-block` if you don't want a parent MOC to show their entire subtree. The sub-MOC's own list will still show its children.
- **Keep MOCs curated** — the auto-generated list is a starting point. Add context, commentary, or section headings outside the marker block — the plugin won't touch that content.
