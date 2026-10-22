---
name: reference_directus_vdialog_focus_trap_tests
description: Mounting a real v-dialog in an app unit test fails the job with an unhandled focus-trap rejection even though every test passes; mock @vueuse/integrations/useFocusTrap
metadata:
  author: Jean Claveau
  type: reference
---

`app/src/components/v-dialog.vue` calls `useFocusTrap(overlayEl)` and watches
`internalActive` to activate and deactivate it. jsdom reports nothing as
tabbable, so focus-trap refuses the hand-back:

```
Error: Your focus-trap must have at least one container with at least one
tabbable node in it at all times
  ❯ updateTabbableNodes focus-trap/index.js:465
  ❯ finishUnpause … ❯ Object.deactivate
  ❯ immediate src/components/v-dialog.vue:94
```

It is an **unhandled rejection**, not a failing assertion: vitest prints
`Test Files 143 passed` and still exits non-zero under `Unhandled Errors`. A
`beforeEach` that resets `document.body.innerHTML` (to rebuild
`#dialog-outlet`) makes it certain — the previous test's teleported dialog is
torn out from under a component that then deactivates its trap.

Fix in the test file, not the component:

```ts
vi.mock('@vueuse/integrations/useFocusTrap', () => {
	return {
		useFocusTrap: () => ({ activate: vi.fn(), deactivate: vi.fn() }),
	};
});
```

`v-menu.vue` uses the same composable, so any test mounting a real menu or
dialog wants it. First hit: `autoscale-panel.vue.test.ts` in
[[project_directus_pr467_autoscale_config_surface]] — the first app test in the
repo to mount a real `v-dialog`.
