---
name: reference_directus_private_view_sidebar_width_prop
description: private-view.vue's sidebar width is hardcoded at 3 CSS sites; a sidebarWidth prop + CSS var makes it page-configurable without touching the 960/1260 overlay breakpoints, but shadows an existing local var and named slots don't render in tests without a stub
metadata:
  author: Jean Claveau
  type: reference
---

`app/src/views/private/private-view.vue`'s open-state sidebar width was
hardcoded `280px` at exactly three sites: `#sidebar { inline-size }`,
`.flex-container { inline-size }`, `&.is-open { flex-basis }`. Made
page-configurable (PR #467, [[project_directus_pr467_autoscale_config_surface]])
with a `sidebarWidth?: number` prop (default 280) written onto the root as
`:style="{ '--sidebar-width': ... }'"`, and all three sites switched to
`var(--sidebar-width)`.

**Deliberately left untouched**: the 60px collapsed peek and the
`960px`/`1260px` media-query breakpoints that decide whether the sidebar
overlays the content or the layout shrinks around it (`position: fixed` below
1260px, `relative` above). A wider open width does not change when it starts
overlaying — below 1260px a 720px drawer overlays exactly as a 280px one did.
Making that decision track the configured width would mean computing the mode
in JS instead of a media query — bigger change, not done.

**Trap**: the component already had a same-named local
`const { width: sidebarWidth } = useElementSize(sidebarEl)` — adding the prop
under the same name silently shadows it in the template. Renamed the local to
`openSidebarWidth` before wiring the prop.

**Test-harness gap this exposed**: `isCustomElement` (in the vitest/VTU config)
treats `private-view` as a custom element, so **none of its named slots
render** in a mount — `wrapper.find('auto-refresh')` inside `#sidebar` comes
back empty, same for anything moved into `#actions:prepend`. No stub was
written to fix this in-session (worked around by driving
`(wrapper.vm as any).load()` directly instead of a DOM-triggered refresh); a
`PrivateView` stub component rendering `<slot name="..." />` for each named
slot, registered in the test's global stubs, is the actual fix if a test ever
needs to assert on rendered slot content rather than call through the VM.

Related: [[project_directus_worktree_shared_node_modules]] (why the app suite
has to run copied into the main tree, not the worktree, for this component's
tests).
