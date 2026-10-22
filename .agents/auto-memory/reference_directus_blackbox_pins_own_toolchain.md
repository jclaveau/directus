---
name: reference_directus_blackbox_pins_own_toolchain
description: tests/blackbox pins its own toolchain (CI resolved vitest 4.1.11 on 2026-10-01; the file once said 1.6.1), not the api's catalog vitest — assuming the newer API costs a full 8-shard CI run
metadata:
  type: reference
---

**UPDATE 2026-10-01: STALE PIN.** CI now resolves **vitest 4.1.11** for blackbox (seen in
the run log); the `1.6.1` below is what the file used to say. Check the lockfile / run log
before trusting either number, and `expect.poll` may be available now (unverified).
No vitest 4 in a worktree's shared node_modules → local typecheck/reporter work needs a real install.

`tests/blackbox/package.json` pinned **`vitest: "1.6.1"`** literally. Every other package
takes `vitest: "catalog:"` (3.x). So a blackbox spec does **not** have the api suite's
matchers and helpers.

Cost me a full 8-shard run on PR #452: `await expect.poll(() => log, { timeout }).toMatch(…)`
threw `TypeError: expect.poll is not a function` — `expect.poll` landed in vitest 2.1.

**How to apply:** before using any vitest API in `tests/blackbox`, check the pin, or copy the
shape from a neighbouring spec. The established bb idiom for waiting on a condition is an
explicit loop, not a poll matcher:

```ts
const held = /holding job \\?"cache-stats\\?"/;
let waited = 0;

while (!held.test(logs[vendor]!) && waited < 20_000) {
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    waited += 250;
}

expect(logs[vendor]).toMatch(held);
```

Log capture itself has precedent — `redis-outage-survival.test.ts`,
`cache-purge-recovery.test.ts` and `flows/schedule-hook.test.ts` all push
`instance.stdout?.on('data', …)` chunks into an array.

Also remember blackbox runs at **`LOG_LEVEL: 'error'`** (`tests/blackbox/common/config.ts`),
so a spec asserting on a `warn` or `info` line must raise it on its own spawned instance.

See [[feedback_directus_bb_tests_in_ci]], [[project_directus_blackbox_spawn_own_instance]].
