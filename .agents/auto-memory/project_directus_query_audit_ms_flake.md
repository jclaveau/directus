---
name: project_directus_query_audit_ms_flake
description: Unit Tests (api) intermittent — a query-audit.test.ts X-Query-Audit header reads "ms":1 where the test expects "ms":0; seen once (#772, 277229abba), passed on later heads, cause not diagnosed
metadata:
  author: Jean Claveau
  type: project
---

On 2026-11-27 the api unit run at 277229abba (PR #772) failed in a `query-audit.test.ts`: the header showed `ms:1`, the test expects `ms:0`. The PR had not touched it, and later heads passed. Three files have that name (`api/src/{database,middleware,websocket}/`); which one failed was not recorded.

**Why:** a known intermittent is not read as a regression of the diff in hand.

**How to apply:** on a second sighting, record the file and test name, then follow [[feedback_directus_flakes_get_dedicated_pr]].
