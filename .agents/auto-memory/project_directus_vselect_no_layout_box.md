---
name: project_directus_vselect_no_layout_box
description: a Directus v-select's root is a zero-size v-menu — it can't be clicked, scrolled to, or pushed with an auto margin; wrap siblings in real spans to lay them out and click button.inline-display to drive it
metadata:
  type: project
---

`<v-select class="x" inline />` renders `div.v-menu.v-select.x > div.v-menu-activator >
button.inline-display`. **The root and the activator both measure 0×0** — only the
inner button has a box. Consequences:

- **CSS on the root can't lay it out.** `margin-inline-start: auto` on the select to
  push it right does nothing (computed `auto`, no box to move). Wrap each side of the
  toolbar in a real `<span>` and use `justify-content: space-between` on the row — the
  spans are the flex items that actually lay out.
- **Playwright can't click or scroll it.** `.click()` → *"Element is not visible"*;
  `.scrollIntoViewIfNeeded()` → 30s timeout. Scroll a containing row instead, and
  click `.<class> button.inline-display`.
- Fixed `inline-size` on the root still works for the dropdown's own width.

**Why:** cost several rounds on the cache page — first a CSS rule that silently did
nothing, then two Playwright selector attempts. The DOM shape is invisible from the
template.

**How to apply:** when a v-select won't move or won't click, probe it before guessing:
`[...el.children].map(c => [c.className, c.getBoundingClientRect().width])`. Related:
[[feedback_flex_fixed_width_is_a_basis]], [[project_directus_cache_admin_page]].
