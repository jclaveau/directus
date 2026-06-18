---
'@directus/types': minor
'@directus/api': minor
---

Let a filter hook cancel a create, update or delete by returning `null`, gated by a new `allowFilterCancel` mutation option.

- When a `*.items.create` / `*.items.update` / `*.items.delete` filter returns `null` and the caller passed `{ allowFilterCancel: true }`, the service skips the mutation. `createOne` resolves to `null`; the batch variants keep the cancelled slots as `null` so the result stays index-aligned with the input (`createMany` returns a `null` per cancelled item, `updateMany`/`deleteMany` return a `null` per key on a batch cancel) — `(PrimaryKey | null)[]` under the opt-in overload. Without the opt-in, a `null` return throws `InvalidPayloadError`, so the default signatures (and all existing callers) are unchanged.
- The public endpoints opt in, so an extension hook can cancel a create/update/delete for any user collection through REST, GraphQL and WebSocket. A cancelled single create responds with `{ data: null }`; a cancelled update reads back the unchanged item; a cancelled delete leaves the item in place.

Builds on the `FilterHandler<TIn, TOut>` output type. Internal/system mutations keep the strict default. Upsert-create cancellation is out of scope.
