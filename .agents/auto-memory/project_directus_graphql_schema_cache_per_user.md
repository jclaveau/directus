---
name: project_directus_graphql_schema_cache_per_user
description: The GraphQL schema cache is keyed per USER, so N users of one role cost N full schemas — measured 3.6 MB each, capacity 100
metadata:
  author: Jean Claveau
  type: project
---

`api/src/services/graphql/schema/index.ts` builds its cache key as
`${scope}_${type}_${accountability.role}_${accountability.user}` and stores it in an
`LRUMap` of `GRAPHQL_SCHEMA_CACHE_CAPACITY ?? 100` entries
(`api/src/services/graphql/schema-cache.ts`).

Measured on a consumer-shaped schema: one admin schema costs 7.9 MB, and **eight
users sharing one identical role added 29.0 MB — 3.6 MB per user** of byte-identical
schema. Re-keying on `admin` + the role list instead took the same eight users to
**+5.5 MB**. At the default capacity the worst case is ~370 MB per worker.

The correct key is the resolved **policy set**, not the role: a policy can be attached
to a user directly (`directus_access.user`), so a role-only key would be wrong for
those users. `fetchPolicies` is already `withCache`d, so resolving it before the lookup
is cheap. Permission *filters* may contain `$CURRENT_USER`, but those affect values,
not the schema's shape, so they do not belong in this key.

**Not currently a production cost for the prod consumer** — it does not use GraphQL,
so this is a latent fork-wide bug rather than a live win. Fix it for the fork, do not
sell it as consumer RAM.

See [[project_directus_worker_ram_shape]].
