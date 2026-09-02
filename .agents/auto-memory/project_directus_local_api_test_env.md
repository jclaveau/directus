---
name: project_directus_local_api_test_env
description: api/src/app.test.ts cannot pass locally without a built @directus/app, and the app build dies under the Bash tool — CI is that file's only arbiter
metadata:
  type: project
---

`app.test.ts` serves the admin app, so it needs
`api/node_modules/@directus/app/dist/index.html`. Without it every case fails with
`Cannot find module …/@directus/app/dist/index.html` — 14 failures that look like a code
fault and are not.

Building it locally is not straightforward: `pnpm build` reaches `app build` and dies with
`Exit status 129` (SIGHUP), and it did so again when relaunched under
`setsid nohup … &`. The api and packages build fine; only the Vue app is affected.

**How to apply:**
- Treat `app.test.ts` failures as environmental **only after reading the failure text**.
  `Cannot find module …/dist/index.html` is the known one; anything else — especially
  `<name> is not a function` — is real and CI will red on it
  ([[feedback_mock_factory_must_export_new_imports]]).
- Baseline before blaming a change: revert your files, re-run the same set, and diff the
  failure lists. On this branch the baseline was a steady 16 failures across
  `app.test.ts`, `get-address` and `stall`.
- Skip `app.test.ts` in local loops and let CI cover it; run the files you touched.

Related: [[feedback_local_vitest_env_constrained]], [[reference_vitest_v4_memory_and_flags]].
