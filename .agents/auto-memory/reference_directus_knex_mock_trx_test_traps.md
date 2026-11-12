---
name: reference_directus_knex_mock_trx_test_traps
description: knex-mock-client trx tests go vacuous — tracker.history.transactions is a live array, microtask ordering hides "before answering" checks, vi.waitFor hides late runs
metadata:
  author: Jean Claveau
  type: reference
---

- `tracker.history.transactions` is mutated in place (Tracker.js:92): pushing the reference and asserting later always reads `'committed'`. Assert INSIDE the task or push `transactions[0].state` (a copy).
- A "runs before the caller resumes" test passes on old code if the task is synchronous: the drain's `.then` lands before the opener's await (`trx._promise` resolves microtasks later). Make the task await a deferred, log `'task ended'` vs `'refresh'` order, assert the order.
- Drop-tests ("tasks dropped on rollback") pass on old code (queue returned false); wrap the call in `expect(queueAfterCommit(...)).toBe(true)` to pin "queued, then dropped".
- Prefer plain `expect` over `vi.waitFor` when the drain is microtask-chained; waitFor hides a regression that runs the task late.
- Red evidence with CI-only tests: push a throwaway branch (separate worktree) with tests but not the fix, wait for the unit job to show the new tests red, then push the fix to the PR.

**Why:** PR #641 review caught 3 vacuous tests. **How to apply:** any trx/after-commit test; mutation-check it.
