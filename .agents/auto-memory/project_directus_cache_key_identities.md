---
name: project_directus_cache_key_identities
description: "a cached response has TWO permanent identities — cacheKey (the digest, every table's join key) and redisKey (what Redis is keyed by); neither is legacy, they differ only under CACHE_KEY_HASH_ENABLED=false, and confusing them reads as a cold cache"
metadata:
  type: project
---

`getCacheKey(req)` returns **both**, and since 2026-08-13 they are named for what they are
(`{ redisKey, cacheKey }`, was `{ key, hash }`):

```ts
const digest = hash(info);                       // object-hash sha1, 40 chars
const redisKey = env['CACHE_KEY_HASH_ENABLED'] === false
    ? JSON.stringify(info, sortNestedKeys)       // readable, unbounded (~200 chars)
    : digest;
return { redisKey, cacheKey: digest };
```

| | `cacheKey` (listing `key`) | `redisKey` (listing `redisKey`) |
|---|---|---|
| column | `varchar(255)`, **PK** of `directus_cache_descriptors` | `text`, unindexed, `defaultTo('')` |
| joined on by | `cache_events`, `cache_anomalies`, `scoped_cache_entry_tags` | nothing |
| used for | stats identity | the actual Redis GET/DEL |

**Neither is legacy and neither subsumes the other.** Under `CACHE_KEY_HASH_ENABLED=false` they
hold *different* values simultaneously. The split is permanent by design — migration
`20260716A`'s docblock: the identity column is `varchar(255)` and a readable key can overflow
it, so the digest stayed the identity and the real Redis key moved to a `text` column beside it.
Only `redis_key = ''` (rows predating `20260716A`, and anomaly locators) ages out.

**Which one an API takes:** `/utils/cache/entry` and `evictCacheEntry` take the **redisKey**
(jean's call — they read Redis by it, and inspect+evict stay in one key space). The MCP
`read_cache_entry` argument is `redisKey` for the same reason. Anything joining telemetry needs
the `cacheKey`, so `readCacheDescriptorForRedisKey` resolves one to the other: PK arm first
(right on any hashing install, and it dodges the `''` rows), `redis_key` scan only as fallback.

**Why:** a wrong key here fails SILENTLY — `exists: false`, indistinguishable from a cold
cache — and only on a non-default install, so it survives every test written on defaults.
Related: [[feedback_disambiguate_colliding_names]], [[feedback_tabulate_two_similar_things]],
[[project_directus_cache_key_ignores_unknown_params]].
