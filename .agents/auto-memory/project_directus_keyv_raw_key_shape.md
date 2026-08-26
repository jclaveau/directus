---
name: project_directus_keyv_raw_key_shape
description: a response-cache entry's RAW redis key is namespaced twice (`<ns>_response::<ns>_response:<hash>`) — never rebuild it by hand, ask Keyv (has/hasMany)
metadata:
  type: project
---

The raw Redis key for a cached response is **doubly prefixed**. Measured on prod:

```
descriptors.redis_key  = df29b5f9…                       (the bare hash)
actual redis key       = scalabus_response::scalabus_response:df29b5f9…
```

keyv 5 prefixes `${namespace}:${key}` (`_getKeyPrefix`) and `@keyv/redis` 5 prefixes
again in `createKeyPrefix`, and the response cache's namespace is
`${CACHE_NAMESPACE}_response` (`getKeyvInstance(store, ttl, '_response')`).

**Why it matters:** anything testing whether an entry is still cached must go
through Keyv — `cache.has(key)` / `cache.hasMany(keys)` — never a hand-built string.
`hasMany` is one round-trip of `EXISTS` in a MULTI and transfers no values, which is
what makes it usable on a slate of thousands (the descriptor reaper's orphan rule).
A rebuilt prefix that drifts on a library bump would answer "gone" for every key and
silently reap the whole dimension.

**How to check it live:** see [[project_directus_prod_db_access]] —
`railway run -s Redis -- sh -c 'redis-cli -u "$REDIS_URL" exists "<candidate>"'`
against a hash freshly read from `directus_cache_stats_descriptors`.
