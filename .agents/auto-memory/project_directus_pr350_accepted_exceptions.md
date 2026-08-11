---
name: project_directus_pr350_accepted_exceptions
description: "PR #350 system MCP endpoint — decisions already settled across four review rounds; do NOT re-raise them in a fresh review"
metadata:
  type: project
---

PR #350 (`v11.10.1-feat/diagnostics-mcp`, stacked on #349) ships `/system-mcp`: a
read-only MCP endpoint over the Streamable HTTP transport, revision 2025-06-18.
Four review rounds happened. **These are closed — a clean session must not
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

**Still worth checking in a future review:** REST `/utils/cache/timeseries` takes
`Number(req.query['buckets'])` with no finite check — the MCP side now refuses it
with `-32602`, the REST twin still lets NaN through to an Invalid Date.
