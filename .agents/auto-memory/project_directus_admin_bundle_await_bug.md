---
name: project_directus_admin_bundle_await_bug
description: Blank admin (`await is a reserved identifier`) from fork #673's `import(await readAppChunkUrl())` — Vite wraps it in a non-async preload arrow; build passes, only a browser fails; fixed in PR #732 with admin-smoke.yml + build-time chunk parse
metadata:
  author: Jean Claveau
  type: project
---

`await import(/* @vite-ignore */ await readAppChunkUrl())` in `app/src/extensions.ts` (#673, d686c838d1) builds to `Nt(()=>import(await cet()))`: `await` inside a non-async arrow → `SyntaxError: Unexpected reserved word`, whole admin blank. Fix: `const appChunkUrl = await readAppChunkUrl()` first, then `import(appChunkUrl)`.

**Why:** `vite build` never parses the code it emits; fork check.yml passed, acceptance.yml only fires on cache-page/acceptance changes, a consumer's e2e never opens `/admin`. A consumer's dev admin broke (2026-11-05), its prod stayed untouched. jean: "ensure the admin is built correctly and can be opened".

**How to apply:**
- Guards live in PR #732: `app/scripts/check-bundle-syntax.mjs` (vm.SourceTextModule over `dist/assets`, appended to app `build`) + `admin-smoke.yml` (opens `/admin/login`, signs in, fails on any `pageerror`). Red seen on unfixed code in 851 ms.
- Any new dynamic-import trick in the app: run the check, don't trust `pnpm build` green.
- Playwright pin: [[reference_playwright_no_chromium_ubuntu_26]].
- A consumer pinned to a `-dist` commit before #732 must re-pin its dist after #732, else its admin ships blank.
