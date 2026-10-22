---
name: project_pr753_pre_node_env_wrapper
description: Planner PR #753 — shell wrapper resolving NODE_OPTIONS/ROLLDOWN_WORKER_THREADS from the same env chain as everything else, since those two are read before readEnv's JS resolution can apply; design + three real bugs the PR-environment container deploy caught that local/unit tests couldn't
metadata:
  type: project
---

`NODE_OPTIONS` (node itself) and `ROLLDOWN_WORKER_THREADS` (rolldown's Rust addon) are
both read **before** any JS runs / at native-addon load — `readEnv`'s resolution can't
reach them, so precedence has to be re-established one layer out, in the shell.

**Shape:** `packages/js-utils/src/env/pre-node-env.js` (pure `preNodeExports` + shell
quoting) + `pre-node-env.cli.mjs` (resolves the chain via `readEnv`, prints `export K=V`
lines) + `with-node-env.sh` (evals the exports, `exec "$@"`). Shipped as a `bin` from
`js-utils` so both `apps/directus` entrypoints (`railway_start_api.sh`,
`directus:init`) call `./node_modules/.bin/with-node-env --env-dir ./env [--profile X]
-- <cmd>`. The set of pre-node keys is itself an env var,
`PRE_NODE_ENV_VARS="NODE_OPTIONS,ROLLDOWN_WORKER_THREADS"` — self-consistent, since
`readEnv` prefers `process.env` for any key a file declares, so the list obeys the same
Railway-override precedence as its own members.

**Moved from `apps/directus/scripts/` into `packages/js-utils/src/env/`** mid-PR:
the precedence rule lives in `readEnv`, and a printer re-implementing "prefer
process.env" in a different package silently drifts from it if dotenvx's behaviour ever
changes — same bug class the PR exists to end, one layer up.

**Three real bugs, all caught by the Railway PR-environment container deploy, none by
local tests or code review alone:**
1. `eval` on `JSON.stringify`-quoted values allows shell injection —
   `` `id -u` `` executes inside double quotes under eval. Fixed with single-quote
   escaping (`'` -> `'\''`), mutation-tested.
2. `exec "$@"` with zero arguments is a silent no-op that exits 0 — an entrypoint that
   lost its payload would look like a clean boot. Now refuses with exit 1.
3. **The big one:** a `bin` shim is a symlink, so `BASH_SOURCE[0]` inside
   `with-node-env.sh` resolved to `node_modules/.bin`, not the real script location —
   the CLI script sitting beside it wasn't found there
   (`Cannot find module '.../node_modules/.bin/pre-node-env.cli.mjs'`). Fixed by
   resolving the real path before locating the sibling. This one would have passed every
   local test and died only on deploy.
4. (Separate, caught via prod log inspection of the PR environment, not a code bug per
   se) **a platform `NODE_OPTIONS` Railway variable silently shadows the file value** —
   same precedence rule as everything else, but several environments (Api dev/PR envs,
   Backend prod) already had a stale `NODE_OPTIONS` set, so merging without deleting them
   first would have *removed* flags those environments currently have, not added any.
   Rollout requires deleting the stale Railway variables in the right order relative to
   merge.

**General lesson:** none of the three code bugs were reachable by unit tests asserting
against the repo's own env chain (that assertion was "weaker than claimed" until
rewritten to build a fixture chain) — a wrapper/entrypoint script needs to actually run
inside the deployed image shape (bin shim, container fs layout) to catch this class of
failure. The PR-environment auto-deploy (Railway deploys both Api and Backend for open
PRs against this repo) is what surfaced #3 and #4; grep/lint/local exec could not.

**Dead end investigated and dropped:** `--experimental-require-module` (kept for
Directus's `createRequire()(path)` loading of the planner's ESM `directus.config.js`) is
unnecessary — that capability shipped unflagged in Node 22.12, and the repo's `engines`
floor is already `>=22.12.0`. Verified with a 3-arm test (no flag / with flag /
`--no-experimental-require-module`) rather than reasoned from version numbers. Removed
from `NODE_OPTIONS`, along with a code-style correction — see
[[feedback_no_legacy_comments]].

**`--profile INIT` (bigger heap for one-shot migrate/schema-sync passes) became mostly
moot** once [[project_directus_worker_heap_cap_incident]] forced dropping the
steady-state heap cap entirely — init and steady-state converged on the same flags. The
profile mechanism is still sound and still buys init `ROLLDOWN_WORKER_THREADS=1` (today
completely absent on Backend), left in place pending jean's call on whether to keep it.

**Status at session end:** PR #753 built and deep-reviewed, but **blocked from merge** —
it still carries `NODE_OPTIONS` with the old-space heap cap in its env-chain form, which
must be stripped before merge or it reintroduces the outage by a different route (same
warning as [[project_directus_worker_heap_cap_incident]]).
