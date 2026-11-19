---
name: reference_directus_withcache_no_inflight_dedupe
description: withCache does not share an in-flight read, so a blackbox statement count for two concurrent same-key reads is 3-or-4 flaky (#746 PR 1, role-share-access.feature request 4)
metadata:
  author: Jean Claveau
  type: reference
---

`withCache` (`with-cache.ts:20`) only serves a value once the first read has finished. Two same-key reads started together (e.g. `Promise.all` in `get-permissions-for-share.ts:50`, sender and share in the same role, same `fetchRawPermissions` key) query twice or once depending on timing.

**Why:** #747 shard 8 failed twice on `- "select": 3` / `+ "select": 4` for `directus_permissions`, request 4 of the share scenario. A rerun does not fix it.

**How to apply:** never pin a statement count on a request whose reads can overlap on one cache key; drop the row or give each reader its own key. Fix at source (share the running read) is its own issue, not in a test-only PR. Ruling on A/B/C was pending at handoff. See [[project_directus_issue746_multi_role]].
