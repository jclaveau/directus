---
name: project_directus_bb_teardown_own_instance
description: Blackbox collections created through a spawned instance must be torn down through it — the main instance never learns them, DeleteFieldIfPresent swallows its 403, and new test files reshuffle shards until the latent failure shows
metadata:
  author: Jean Claveau
  type: project
---

A spawned instance with its own Redis publishes `schemaChanged` there; the main bb
instance (no Redis, `CACHE_SCHEMA` on) never hears it. A teardown sent to the main
instance then gets 403 on `DELETE /fields/...`, `DeleteFieldIfPresent` reads it as
"already gone", and a self-relation collection DELETE answers 500
`relation "<c>" does not exist` ([[project_directus_blackbox_delete_semantics]]).

**Why:** #769 shard 7, `cache-on-delete-rules`, fixed in 8de428700f. It passed only
while another file in its shard wrote schema through the main instance. Adding bb
files reshuffled the shards and it failed on every rerun.

**How to apply:**
- `afterFeature(vendor, instanceUrl)` (`spawned-write-steps.ts`) runs before the
  instance stops; delete through `instanceUrl` and expect 204. `beforeFeature`
  pre-cleans through the main instance keep the same blind spot.
- A teardown failure after adding bb files, passing on base, → suspect the shard mix.
- vitest prints the FAIL block at shard end: time the suite by its
  `❯ <file> (N tests)` line, not by where the FAIL appears.
- A `<key>` filled by a server started in `beforeFeature` binds too early (became a
  random uuid): pass it through `ScenarioKeys.knownKeys`.
