# app — Vue dashboard component quirks

Full hooks for this area. The routing keys live in `../MEMORY.md`.

- [v-select's root has no layout box](../project_directus_vselect_no_layout_box.md) — the `v-menu` root+activator are 0×0: CSS auto-margins do nothing and Playwright can't click/scroll it; wrap siblings in spans to lay out, click `button.inline-display`
- [private-view sidebarWidth prop](../reference_directus_private_view_sidebar_width_prop.md) — CSS-var-driven page-configurable drawer width, leaves overlay breakpoints untouched, local-var shadowing trap, named slots don't render under isCustomElement in tests
- [ApexCharts tooltip quirks](../reference_directus_apexcharts_tooltip_quirks.md) — updateOptions() rebuilds tooltip mid-hover; marker dot is an oversized glyph, replace with a real shape
