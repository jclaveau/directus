---
name: project_directus_pr350_accepted_exceptions
description: "PR #350 system MCP endpoint — MERGED 2026-08-13; decisions settled across five review rounds, do NOT re-raise them when reading /system-mcp or the cache purge-coverage code"
metadata:
  type: project
---

PR #350 (`v11.10.1-feat/diagnostics-mcp`) shipped `/system-mcp`: a read-only MCP
endpoint over the Streamable HTTP transport, revision 2025-06-18. **MERGED into
`v11.10.1-hhh-dev` on 2026-08-13** (`84a05034c2`), 80/80 green, patch 98.82%.
Five review rounds happened. **These are closed — a clean session must not
re-flag them:**

- **`MCP_PROTOCOL_VERSION`, `SUPPORTED_MCP_PROTOCOL_VERSIONS`, `JsonRpcId`,
  `JsonRpcResponse` stay unprefixed** while everything else carries the
  `systemMcp` radical: they name foreign specs ([[feedback_name_vocabulary_one_radical]]).
- **`2025-03-26` is deliberately unsupported**, though the transport says to
  assume it when no version header arrives — that revision mandates batching and
  this server answers a single message. A header-less request is served as
  current. Documented at `handle-request.ts`.
- **`response()` and `handlerFor()` survive as test helpers** (40 lines of
  recording res mock; router-stack digging) after every other helper and const
  fixture was inlined ([[feedback_inline_helpers_in_tests]]). The blackbox
  `post`/`call`/`callTool` wrappers were flagged to jean and left — **open, not
  settled**.
- **Auth is the plain admin credential** — session or a Directus static token on
  an admin user. Its blast radius (no expiry, not hashed, whole API) is real and
  is filed as issue #352 "Multiple scoped API tokens per user, each with its own
  TTL", not a blocker for this PR.
- **`api/src/system-mcp/index.ts` reports 0% coverage** — barrel re-export
  artefact ([[reference_codecov_patch_coverage]]), the module is otherwise 100%.
- **Rate limiting is Directus's own** (`rateLimiterGlobal`/`rateLimiter` mount
  ahead of every router); no MCP-specific limiter.


## Second review round (2026-08-13) — all ten findings fixed, do NOT re-raise

Deep review of the full diff produced 10 findings; every one is landed on
`v11.10.1-feat/diagnostics-mcp` (`de6a2aea82`, `f8fdf9bd3b`). Closed:

- **`?buckets=five` answered 500** — `Number()` → NaN → `new Date(NaN)` → Invalid Date in the
  query. The guard now lives once in `UtilsService.getCacheTimeseries`, which BOTH the REST
  route and the MCP tool already call; REST gets 400, MCP `-32602`, neither restates the rule.
- Dead barrel exports (`systemMcpTools`, `MCP_PROTOCOL_VERSION`) removed; `'405'` moved out of
  `post.responses` into the description (OAS cannot attach a response to an undeclared method);
  `processes.yaml` stopped promising both report halves; `buckets` schema declares
  `minimum`/`maximum`; env stub + `config.ts` say a browser needs `SYSTEM_MCP_ALLOWED_ORIGINS`
  **and** `CORS_ORIGIN`; tool failures now run `extractDatabaseError` so a pool timeout is named.
- **`x-enabled-by` supersedes the old "env-gated routes still appear, document a 404" rule** —
  see [[project_directus_oas_publishing]], already corrected there.
- **`purgesSinceFilled` shipped** — the staleness answer that dropping `value` gave up, joined
  from the #353 purge tables and bounded by the entry's own `last_filled`. Empty vs null is a
  deliberate distinction (nothing covered it / no fill to measure from).
- **The entry read takes the REDIS key** — jean's call, over the digest. See
  [[project_directus_cache_key_identities]]; `cacheKey` is NOT legacy and both survive.

**Known-noisy locally, not this PR's fault:** `specifications.test.ts > omits a path whose
x-enabled-by env flag is off`, `get-address.test.ts`, `stall.test.ts` all fail on the untouched
baseline in this worktree ([[project_directus_worktree_shared_node_modules]]).

### CI took three iterations to green (2026-08-13) — both failures were real

`ab97e6c353` is **80/80 green**, `codecov/patch` **99.72%** (target 95). Getting there:

1. **`toContain('key')` vs `redisKey`** — a blackbox assertion that had been only incidentally
   true; the capital K broke it. Now asserts the full argument name
   ([[feedback_assert_identifiers_by_full_name]]).
2. **`codecov/patch` 93.02%** — NOT a partial-upload artefact, it settled there. 44 of 46 misses
   were `listPurgesCoveringEntry` + `readCacheDescriptorForRedisKey`, whose only proof was the
   blackbox block in `cache.test.ts` — a file that **spawns its own Directus instances**, so its
   coverage is never line-counted ([[reference_codecov_patch_coverage]]).

**Do NOT re-raise "these unit tests duplicate the blackbox".** They deliberately assert what the
integration path structurally cannot reach: the `redis_key` fallback (needs
`CACHE_KEY_HASH_ENABLED=false`), the newest-first merge ACROSS the two purge reaches, the `''`→null
tag mapping, and the empty-key guard. `readCacheTombstone` had no unit test at all before this.

**Still expected to read as uncovered, by design:** `api/src/system-mcp/index.ts` barrel re-export
lines, and the `/utils/cache*` route handlers in `controllers/utils.ts` (blackbox covers those —
they show as local unit misses only).

## Fifth round (2026-08-13) — five findings fixed in `fc03aa774b`, then merged

A last deep review before merge. All five landed with regression tests (each
verified red with its fix reverted). Do NOT re-raise:

- **`last_filled` is nullable and a NULL one means never filled** — an anomaly
  locator. `readCacheDescriptorForRedisKey` returns null on it, so `filledAt` and
  `purgesSinceFilled` are both null. `new Date(null)` is the epoch, which had it
  reporting a 1970 fill; the anomaly listing hands out exactly that key, so it
  was two tool calls away. Every other reader draws the same line with
  `whereNotNull('d.last_filled')`.
- **`listPurgesCoveringEntry` dedupes by `purge_id` in JS, not in SQL** —
  `DISTINCT` cannot do it because `pt.scoped_cache_tag` is in the tuple and a
  purge that dropped several tags leaves one row per tag. `orderBy` on the tag
  is there to make *which* tag survives deterministic; don't remove it.
- **The namespace reach reads `directus_cache_purges` directly, with no join** —
  by design, not an oversight: a namespace clear names neither tag nor
  collection, so there is nothing to join to, and it covered every entry anyway.
- **`listCacheEntries.purges` deliberately EXCLUDES namespace clears** while
  `purgesSinceFilled` includes them. Different questions: the column attributes a
  purge to the scope it named; the entry read answers what happened to this
  entry. Adding namespace to the column also breaks the blackbox's
  `expect(untouched.purges).toBe(0)`.
- **`window` and `buckets` are read in `UtilsService`, never in the route or the
  tool** — both surfaces hand them over raw so they cannot drift. Out-of-range
  buckets are refused, not clamped, and the bounds come from
  `CACHE_TIMESERIES_MIN_BUCKETS`/`_MAX_BUCKETS`.
- **`?window=yesterday` is a 400 over REST now**, where it used to fall back to
  24h silently. Disclosed in the PR body and merged as-is — jean's call, settled.
- **The blackbox `post`/`call`/`callTool` wrappers stay**, and the unit tests that
  restate blackbox cases stay. Both were raised as open questions in the PR body
  and merged without action.
