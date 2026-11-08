---
name: project_directus_pr698_autoreview_state
description: PR #698 (createBusboy, multipart part-end) autoreview state 2026-11-08 — open double-next findings, JSON-import hang already fixed by #695, rebase plan; #695 merged
metadata:
  author: Jean Claveau
  type: project
---

#695 MERGED 2026-11-08 as f26d8cb95b (autoreview 100%, no defects). Open choice left: `updateByQuery` key read ignores caller `emitEvents` (same fix A as `deleteByQuery`?) — needs a new PR if yes.

#698 (`v11.10.1-fix/multipart-part-end`, `createBusboy` util): reviewer found the new `close` -> `busboy.destroy()` makes a route answer `next()` twice after an abort (files.ts :124/:135, schema.ts :98-101, utils.ts :157/:163). Choice family: one error-to-next gate per request vs log level. Also: abort after an early 400 may never fire req `close` (Node 22); `schema.test.ts`/`utils.test.ts` pin the double answer via `toHaveBeenCalledWith` (assert the full call list).

UPDATE 2026-11-08: jean said go; #698 rebased on f26d8cb95b, now single commit 3be196d956 (102e31df09 dropped, the 2 JSON bullets removed from the PR body BEFORE the push). CI re-running; still to do: post results comment (finding 1 = "already fixed by #695 48cec134d2", marker head 3be196d956) and report autoreviewed percent. `updateByQuery` fix A explained to jean, awaiting his go.

**Why:** #698 branched before #695's 48cec134d2, which already fixes the JSON import hang (`finished(stream)` rejects like CSV). My 102e31df09 duplicates it, so #698 conflicts with hhh-dev.
**How to apply:** rebase #698 on hhh-dev, drop 102e31df09 (keep its test only if it adds a case), force-push with lease, then post the results comment marking that finding "already fixed by #695". Keep public text neutral, no crash recipe (the create-busboy docblock says "ends the process": flag to jean). Upstream warning stays parked. Pre-existing: files.test.ts sync tests never await their callback (report-only). `singular-write-flows` blackbox flake hit again: rerun failed.
Lesson: fetch the base and check whether a finding is already fixed there before writing the fix.

UPDATE 2026-11-08 (later): jean ruled finding 2 = A ("3 => A"), then "/pr-autoreview 698; if no choice remains and CI green, merge" (per-PR merge ask, still read the percent first). Fix pushed as 8db8fe3e9f: `answerOnce` util in files.ts/utils.ts/schema.ts, tests red without it, green with it (42/42). PR body PATCHed BEFORE the push. 3be196d956 CI finished green.
Test-review points to verify before posting (subagent, 6 yellow, none verified yet): files.test.ts mocks `../services` but files.ts imports `../services/files.js` (mock inert, real FilesService runs); fixed `setTimeout(50)` waits in files/utils/schema tests (await the second error's source instead); schema.test.ts title contradicts its assertion; create-busboy test 1 cannot fail without the noop file-error listener (assert no uncaughtException); `request.complete === false` guard has no complete:true counter-test (mutation survives).
Lesson: pins by timer (`setTimeout`) on an async rejection pass vacuously when the second error is late; wait on the causal event.

UPDATE 2026-11-08 (run 2, head 13c43b9e3d): the 4 test points fixed (mock `../services/files.js`, causal waits on the mocked reader's rejection, schema retitle, `complete: true` test), each red without its fix. Refuted: the noop part error listener IS pinned (without it vitest reports 2 unhandled errors and exits 1). New choice, predates: success answered before the parser closes (files.ts `tryDone` when savedFiles == fileCount, utils import `res.status(200).end()` per part, schema `/apply` first file) → a later part failure is dropped (files/schema) or sent after headers (import). Options A wait for `close` (recommended) / B keep + log. Predating reports: import cut after a complete part = 400 while it commits; import with no file part never answers. NOT merged: choice open.
