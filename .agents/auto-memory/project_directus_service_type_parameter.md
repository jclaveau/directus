---
name: project_directus_service_type_parameter
description: ItemsService is already generic and six services pass a type argument — the fifteen that do not are exactly where the read-result casts live (issue #431)
metadata:
  type: project
---

`api/src/services/items.ts:93`:

```ts
export class ItemsService<Item extends AnyItem = AnyItem, Collection extends string = string>
implements AbstractService<Item> {
```

and `AbstractService<T>` declares `readOne(...): Promise<WithMeta<T>>`.

Six services already pass a type: `FilesService extends ItemsService<File>`, plus
`<OperationRaw>`, `<FlowRaw>`, `<Notification>`, `<Policy>`, `<Webhook>`. Fifteen do
not — Shares, Versions, Permissions, Users, Settings, Roles… — and those are exactly
the services behind the 9 `as X` casts on read results. Every domain type they would
need already exists in `@directus/types`.

Measured against `tsc -p api` (clean 0-error baseline, ~23s):

- `VersionsService extends ItemsService<ContentVersion>` + cast removed → **3 errors,
  all in that file**: one unused import and two `TS7053` where an *aggregate* query
  reads `count` off a row typed as the collection. Aggregates break "row type =
  collection type".
- `SharesService extends ItemsService<Share>` + cast removed → **one error**, the
  field projection: `Share['user_created']` is `string | User` where the requested
  `user_created.id`/`.role` make it `{ id, role }`.

**Why:** this is the root of every read-result cast, and #431 records it. The SDK
already computes the projection half — `ApplyQueryFields` in `sdk/src/types/output.ts:9`.

**How to apply:** rung 1 (type argument per service) is independently landable, one
service at a time. Rung 2 needs `<const F extends readonly string[]>` inference on
`fields` and a separate return type for the aggregate path. [[project_directus_read_meta_rider]]
