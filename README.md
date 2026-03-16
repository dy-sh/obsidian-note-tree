# Note Tree

An [Obsidian](https://obsidian.md) plugin that turns your vault into a structured hierarchy of interconnected notes. Every note knows its place in the tree — navigate **down** through auto-generated MOC (Map of Content) lists and **back up** via `up` links.

## The Idea

Most note-taking ends up as a flat pile of files. Folders help, but they're rigid — a note can only live in one folder, and there's no way to navigate between related notes.

**Note Tree** solves this by giving every note two things:
- An **Up link** (`up:: [[Parent]]`) — points to the parent note, so you can always navigate back
- A **MOC list** — auto-generated index of children, so you can navigate deeper

This creates a navigable tree structure across your entire vault. You move **down** by clicking links in a MOC, and **back up** by following the `up` link. Sub-categories are just notes tagged `#moc` that have their own children — the tree grows naturally as you add notes.

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

Each MOC auto-generates its own child list. You never maintain these lists by hand.

## Features

### Core
- **Structured hierarchy** — every note links to its parent via `up`, forming a navigable tree
- **Auto-generated MOC** — child lists are built automatically by traversing `up` links
- **Create notes in context** — new notes are placed under the right parent with the correct `up` link
- **Multiple MOC modes** — list (nested bullets), embedded (full note content), folder-based, tag-based
- **Recursive traversal** — MOC can show children, grandchildren, and deeper, with configurable depth
- **In-place updates** — MOC content regenerates inside marker comments without touching your own text
- **Flexible sorting** — by priority, alphabetical, created/modified date, or custom field
- **Filtering** — include/exclude notes by tags
- **Auto-update** — MOCs update automatically when notes are created, deleted, renamed, or modified
- **Edit MOC parameters** — visual editor for marker parameters (mode, depth, sort, filters)

### Navigation
- **Go to parent / Go to root** — instant navigation up the hierarchy
- **Sibling navigation** — jump to the next or previous sibling note within the same parent
- **Breadcrumb status bar** — clickable path showing your position in the tree (root > ... > parent > current)
- **Breadcrumb in reading mode** — breadcrumb trail rendered above note content

### Tree Sidebar
- **Collapsible tree view** — your entire note hierarchy in a sidebar panel
- **Search/filter** — type to filter nodes by name, with ancestor paths preserved
- **Collapse/Expand all** — toolbar buttons to collapse or expand the entire tree at once
- **Child count badges** — each parent node shows the number of direct children
- **Multi-parent indicator** — notes appearing under multiple parents show a `+N` badge with tooltip
- **Recently modified indicator** — blue dot on notes modified within a configurable time window (default 24h)
- **Stale MOC indicator** — warning icon on MOCs whose generated content is out of date
- **File path tooltip** — hover any node to see its full vault path
- **Keyboard navigation** — arrow keys to move, Enter to open, `n` to create child, F2 to rename
- **Inline rename** — double-click a node label or press F2 to rename the file in place
- **Drag-and-drop reparenting** — drag a node onto another to change its parent
- **Drag-and-drop reordering** — drag a node above or below a sibling to reorder (adjusts priority)
- **Context menu** — right-click for actions: open in new tab, create child, add existing child, update MOC, batch create, promote/demote MOC
- **Auto-reveal** — optionally highlights the active file in the tree when you switch notes
- **Dashboard/stats** — collapsible stats section at the top showing total notes, MOCs, orphans, stale MOCs, max depth, and largest MOC

### Note Management
- **Quick-create child** — single-input command that auto-resolves the parent from context and uses all defaults
- **Batch create children** — create multiple child notes at once from a list of names
- **Move note to parent** — reassign a note to a different parent with automatic MOC updates
- **Promote to MOC** — add the MOC tag and generate an initial child list for any note
- **Demote from MOC** — remove the MOC tag and all marker blocks from a note
- **Orphan detection** — find notes that aren't connected to the tree, with bulk-assign support
- **Visual reorder** — drag-and-drop modal to reorder children and move notes between sub-categories
- **Auto-assign parent** — optionally auto-assign a detected parent to new notes (not just suggest)
- **Copy branch as flat list** — copy an entire subtree as a flat bullet list to clipboard

## Commands

| Command | Description |
|---------|-------------|
| **Insert MOC** | Pick MOC mode and insert a generated list at cursor |
| **Create MOC for current note** | Append a MOC list to the end of the current file |
| **Update MOC** | Regenerate MOC markers in the current file |
| **Update All MOCs** | Regenerate all MOC files in the vault |
| **Create new note** | Create a child note under a selected parent with the right `up` link |
| **Quick-create child note** | Create a child note with a single name input — auto-resolves parent from context |
| **Batch create children** | Create multiple child notes at once from a multi-line list |
| **Reorder MOC children** | Open a visual modal to reorder children and move them between sub-categories |
| **Go to parent** | Navigate to the parent note (shows picker if multiple parents) |
| **Go to root** | Navigate to the topmost ancestor in the hierarchy |
| **Go to next sibling** | Navigate to the next sibling within the same parent |
| **Go to previous sibling** | Navigate to the previous sibling within the same parent |
| **Move note to parent** | Reassign the current note to a different parent, updating `up` link and both MOCs |
| **Promote to MOC** | Add the MOC tag and generate a child list for the current note |
| **Demote from MOC** | Remove the MOC tag and all marker blocks from the current note |
| **Find orphan notes** | List all notes without an `up` link (excluding MOC roots), with option to assign parents |
| **Edit MOC parameters** | Visual editor for the MOC marker block under the cursor |
| **Copy branch as flat list** | Copy the entire subtree of the current note as a flat bullet list |
| **Toggle Note Tree sidebar** | Show/hide the tree view panel in the left sidebar |
| **Reveal active file in tree** | Expand ancestors and scroll to the active file in the tree sidebar |

## Quick Start

1. **Create a root MOC** — open any note, run "Create MOC for current note", pick "List"
2. **Create child notes** — run **"Create new note"** command, select the root as parent. The note gets an `up:: [[Root]]` link and a `priority` automatically
3. **Navigate** — the root MOC shows all children. Click a child to go deeper. Click the `up` link to go back
4. **Add sub-categories** — when creating a note, toggle "Create as MOC". It becomes a sub-category with its own children
5. **Reorder** — run "Reorder MOC children" to visually drag-and-drop notes into the desired order

> **Tip:** Use the **"Quick-create child note"** command for the fastest workflow — it auto-detects the parent from context (active MOC or parent of the active note) and only asks for a name. For bulk operations, use **"Batch create children"** to create many notes at once.

## Maintaining the Note Hierarchy Manually

While the plugin automates most tasks, understanding the underlying structure helps you troubleshoot issues or set up notes without the plugin commands.

### Frontmatter properties

Every note in the tree uses these frontmatter fields:

```yaml
---
date created: 2026-03-16
date modified: 2026-03-16
aliases: [Alt Name]
tags: []
priority: 20
---
up:: [[Parent Note]]
```

| Property | Required | Description |
|----------|----------|-------------|
| `up` | For child notes | Parent link. Can be in frontmatter (`up: "[[Parent]]"`) or as an inline Dataview field (`up:: [[Parent]]`). Without this, the note is disconnected from the tree. |
| `priority` | No | Numeric sort order among siblings. Lower values appear first. Notes without priority sort to the end alphabetically. Managed automatically by the reorder command (10, 20, 30...). |
| `tags` | For MOC notes | Add the MOC tag (default: `moc`) to mark a note as a sub-category that can have its own children. E.g. `tags: [moc]`. |

### Making a note a MOC

To turn any note into a MOC (a category node that generates a child list):

1. Add the `moc` tag: `tags: [moc]`
2. Run "Create MOC for current note" or "Update MOC" to generate the marker block

Or use the **"Promote to MOC"** command which does both steps at once. To reverse it, use **"Demote from MOC"** to remove the tag and all marker blocks.

You can also manually insert a marker block:

```markdown
%% START MOC list [[Note Name]] %%

%% END MOC %%
```

The plugin will fill in the child list on the next update.

### Connecting a note to a parent

Add an `up` link to point to the parent:

- **Inline field** (recommended): `up:: [[Parent Name]]` — place on its own line, outside frontmatter
- **Frontmatter**: `up: "[[Parent Name]]"` — inside the YAML block

After adding the link, run "Update MOC" on the parent to refresh its child list (or enable auto-update).

### Moving a note to a different parent

To manually change a note's parent:

1. Edit the `up:: [[Old Parent]]` line to `up:: [[New Parent]]`
2. Run "Update MOC" on both the old parent (to remove the note) and new parent (to add it)

Or use the **"Move note to parent"** command which does all of this automatically.

### Priority and ordering

Children within a MOC are sorted by `priority` (ascending), with alphabetical as tiebreaker. To control order manually:

- Set `priority: 10` on the first child, `priority: 20` on the second, etc.
- Leave gaps (10, 20, 30...) so you can insert notes later without renumbering everything

The **"Reorder MOC children"** command manages this automatically via drag-and-drop. You can also drag nodes above/below siblings directly in the tree sidebar to adjust priority.

### Controlling recursion

By default, a MOC shows its full subtree (all children, grandchildren, etc.). To limit this:

- Set `depth=N` in the marker parameters (e.g. `depth=1` for direct children only)
- Tag sub-MOCs with `#moc-block` to stop the parent from recursing into them — the sub-MOC still generates its own child list

### Special tags

| Tag | Default | Purpose |
|-----|---------|---------|
| `#moc` | `moc` | Marks a note as a MOC (category node). Required for auto-update, status bar, and child list generation. |
| `#moc-block` | `moc-block` | Stops parent MOC from recursing into this note's subtree (unless `ignore-block` is set). |
| `#moc-emb-ignore` | `moc-emb-ignore` | Excludes a note from embedded mode MOC lists. |

All tag names are configurable in settings.

## How It Works

Each note declares its parent via the `up` property:

```yaml
---
priority: 20
---
up:: [[Parent Note]]
```

The plugin reads all `up` links in the vault and builds a parent → children index. When you create or update a MOC, it generates a markdown list wrapped in markers:

```markdown
%% START MOC list [[Parent Note]] %%

- [[Child A]]
	- [[Grandchild A1]]
	- [[Grandchild A2]]
- [[Child B]]

%% END MOC %%
```

Everything outside the markers is untouched — add your own text, headings, or commentary freely.

### Automatic updates

The plugin reacts to vault changes in real time:

- **Create** — when you create a note via the plugin command, the parent MOC updates immediately. With auto-assign enabled, notes created outside the plugin also get a parent assigned automatically.
- **Delete** — when a note is deleted, its parent MOCs are updated to remove the dead link
- **Rename** — when a note is renamed, parent MOCs regenerate with the new name. You can also rename directly in the tree sidebar with F2 or double-click.
- **Modify** — when auto-update is enabled, editing a note triggers a targeted update of its parent MOCs (not the entire vault)

## MOC Modes

| Mode | Description |
|------|-------------|
| **list** | Nested bullet list via parent links. Configurable depth. |
| **embedded** | Headings with embedded note content (`![[note]]`) |
| **folder** | List all notes in a specific folder |
| **tag** | List all notes with a specific tag |

### Marker Parameters

```
%% START MOC list depth=2 sort=alphabetical include=python exclude=draft [[Note]] %%
```

| Parameter | Description |
|-----------|-------------|
| `depth=N` | Limit recursion depth (0 = unlimited) |
| `ignore-block` | Ignore `moc-block` tag |
| `sort=X` | `priority`, `alphabetical`, `created`, `modified`, `custom` |
| `include=tag` | Only include notes with this tag |
| `exclude=tag` | Exclude notes with this tag |
| `path=X` | Folder path (folder mode) |
| `tag=X` | Tag filter (tag mode) |

You can edit these parameters manually in the marker comment, or use the **"Edit MOC parameters"** command for a visual editor.

## Navigation

### Breadcrumb status bar

The status bar shows a clickable breadcrumb trail of your position in the hierarchy:

```
Home > Programming > Languages > Python
```

Click any segment to navigate directly to that ancestor note.

### Tree sidebar

The **Note Tree sidebar** shows your entire note hierarchy as a collapsible tree. Root MOCs (notes with `#moc` tag and no `up` link) form the top level.

- **Search** — filter nodes by typing in the search box
- **Expand/Collapse all** — use the toolbar buttons to expand or collapse the entire tree
- **Navigate** — click a label to open the note, click the chevron to expand/collapse
- **Keyboard** — arrow keys to move between nodes, Enter to open, `n` to create a child under a MOC, F2 to rename inline
- **Drag-and-drop** — drag onto a node to reparent, drag above/below a sibling to reorder
- **Context menu** — right-click for: open in new tab, create child, add existing child, update MOC, batch create children, promote/demote MOC
- **Visual indicators** — child count badges, multi-parent `+N` badges, blue dots for recently modified, warning icons for stale MOCs
- **Stats dashboard** — click "Stats" at the top to see total notes, MOCs, orphans, stale MOCs, max depth, and largest MOC (with clickable actions)

Toggle it via the "Toggle Note Tree sidebar" command or the tree icon in the ribbon.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Parent properties | `up` | Comma-separated list of properties used for parent links |
| MOC tag | `moc` | Tag that marks notes as MOC (sub-category) nodes |
| MOC block tag | `moc-block` | Tag that stops recursion at a boundary |
| Embed ignore tag | `moc-emb-ignore` | Tag that excludes notes from embedded mode |
| Default depth | 0 | Default recursion depth (0 = unlimited) |
| Default sort | priority | Default sort order for MOC entries |
| Auto-update on save | off | Automatically update parent MOCs on file changes |
| Auto-detect parent | off | Suggest a parent for new notes created outside the plugin |
| Auto-assign parent | off | Automatically assign the detected parent (not just suggest) |
| Auto-reveal active file | off | Highlight the active file in the tree sidebar on switch |
| Recently modified threshold | 24h | Notes modified within this window show a blue dot in the tree |
| New note template | (customizable) | Template with variables: `{{date}}`, `{{name}}`, `{{parent}}`, `{{priority}}`, `{{up_line}}`, `{{heading}}`, `{{tags_line}}`, `{{aliases}}` |

## Installation

### Build from source

The compiled `main.js` is not included in the repository — you need to build it from TypeScript sources:

```bash
cd your-vault/.obsidian/plugins/note-tree
npm install
npm run build
```

This compiles `src/*.ts` into `main.js`. After building, enable the plugin in Obsidian settings → Community plugins.

For development with auto-rebuild on changes:

```bash
npm run dev
```
