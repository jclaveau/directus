---
name: reference_directus_system_mcp_wiring
description: How to wire the fork's system-mcp onto a live service and register it as an MCP server in a Claude Code session
metadata:
  author: Jean Claveau
  type: reference
---

Two independent halves, both required before `list_processes`/`list_cache_entries`/etc.
are callable — done once against a consumer's dev API service:

**Server side:**
1. `SYSTEM_MCP_ENABLED=true` on the target service (the router only mounts behind this
   gate — an unmounted route answers **404**, a mounted-but-refusing one answers **403**;
   that distinction is the fast way to tell "not enabled" from "wrong creds").
2. `SYSTEM_MCP_TOOLS=processes,cache` (or whichever subset) — both `boolean`/`array` are
   in `TYPE_MAP`, so a comma-separated env string casts correctly; an unset or
   non-array value yields **zero** tools even with the endpoint mounted.
3. Redeploy (a Railway variable change usually triggers one automatically, but doesn't
   register a GitHub deployment — poll the route's 404→405 flip, not the deployments
   API, to know it landed).
4. The endpoint authenticates like any Directus route: a **static token** on an admin
   user (`Authorization: Bearer <token>`), not a 15-minute session token. Setting one
   via the admin UI (Settings → Users → the user → Token field) avoids writing directly
   to `directus_users` — the sandbox classifier will (correctly) block an `UPDATE
   directus_users SET token = ...` from an agent.

**Client side (this repo's session):**
```
claude mcp add --transport http --scope local scalabus-dev \
  <https://service-host>/system-mcp -H "Authorization: Bearer <token>"
```
`--scope local` writes to `~/.claude.json`, not a repo-committed `.mcp.json` — the
token never touches version control. **A newly added MCP server's tools are not in the
session's registry until the session restarts** — same rule as hooks
([[feedback_hooks_require_session_restart]]). `claude mcp list` reporting "✔ Connected"
only proves the transport works, not that the tools are callable yet; `ToolSearch`
finding nothing for the tool names is the tell that a restart is still owed.

**Cost gotcha, since fixed:** with `PROCESSES_REPORT_DETAILS="stats,env"` set service-wide,
every `list_processes` call returns each process's full resolved environment — one call
measured **98 KB**, blowing the tool-result size limit and needing a file+jq workaround.
[[project_directus_pr448_details_narrowing_bug]] added a per-call `details` parameter
(`{ details: ["stats"] }`) that narrows the response without narrowing what the service
exposes to everyone else — prefer that over setting `PROCESSES_REPORT_DETAILS=stats`
service-wide, which would permanently take the env comparison away from every caller.

**Why:** confirmed end-to-end on a consumer's dev host — `mcp__scalabus-dev__list_processes`
returned dev's real (pre-#447-dist) process tree only after both halves were done and the
session restarted.

**How to apply:** revoke a token with `UPDATE directus_users SET token = NULL WHERE
email = '<user>';` when done — it's a long-lived admin credential.
