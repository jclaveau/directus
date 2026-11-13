---
name: reference_directus_gherkin_yaml_cells
description: A blackbox table cell can hold YAML, because the fork's multiline notation dedents a cell as a block
metadata:
  type: reference
---

A multiline table cell in the fork's jest-cucumber keeps its inner indentation:
`foldCellFragments` (`tests/blackbox/node_modules/jest-cucumber/dist/src/multiline-table-cells.js`)
drops trailing spaces, drops blank fragments at either end, then removes the
*shared* indentation of the block. So the indentation a reader sees in the
`.feature` is the indentation the parser reads — which is what makes YAML, whose
indentation is semantic, usable in a cell at all.

Measured on `cache-composite-tag.feature` (three cells side by side: `query`,
`response`, `fingerprints`):

| cell notation | lines | widest line |
| --- | --- | --- |
| JSON, one value per line | 1068 | 87 |
| YAML | 742 | 83 |
| JSON, scalar lists inline | 759 | 127 |
| YAML, scalar lists inline | 539 | 102 |

Inlining a scalar list (`viewFields: [id, method, owner]`) shortens every cell
and *widens* every line: columns sit side by side, so a line costs the sum of
the three. Width is the binding constraint, so values stay one per line.

Two YAML traps in this shape: `*` is an alias sigil, so `fields=*` must be
written `- "*"`; and `yes`/`no`/`on`/`off` are plain strings under js-yaml 4
(YAML 1.2 core) but would be booleans under a 1.1 parser.

**Why:** the format question ("can a cell be YAML?") looks like it turns on
Gherkin, which trims cells — it turns on the fork's own folder, which does not.

**How to apply:** author a cell in whatever notation reads best and parse it with
`load as loadYaml` from `js-yaml` (already a `tests/blackbox` devDependency);
measure the whole file's widest line, never one cell, before choosing.

**Row markers:** `|+` goes at the end of a BODY row's first line, NEVER on the
header — a marked header throws "a table header cannot be marked" at load, and
the suite that never loads makes the shard's completion barrier time out every
later file (600 s "Hook timed out"), so one bad marker reads as ~10 red files.
Once any row carries `|+`, EVERY logical row must open with it (an unmarked line
is a continuation of the row above). Hit on #534 (2026-09-26).

Related: [[project_directus_issue531_composite_tags]],
[[reference_directus_filter_eq_shorthand]].
