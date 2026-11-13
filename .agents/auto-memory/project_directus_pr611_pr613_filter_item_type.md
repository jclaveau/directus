---
name: project_directus_pr611_pr613_filter_item_type
description: PR #611/#613 (issues #609/#612) — register.filter<Item> on items.create/update/delete takes the ITEM type; CreateEntries/UpdateEntries exported, DeleteKey = PrimaryKey; settled points, TS limits, consumer migration
metadata:
  author: Jean Claveau
  type: project
---

`register.filter<Row>('<col>.items.create|update|delete', …)` takes the ITEM type; the overload wraps it. #611 (merged `2ab8b84bab`) did create/update, #613 did delete (open at handoff, merge pending green CI).

- create → `CreateEntries<Row> | null`, update → `UpdateEntries<Row> | null`, delete → `PrimaryKey[] | null`. Outer `| null` kept (earlier filter cancelled the mutation). Handlers may return `void` (runtime `emitFilter` ignores undefined).
- `CreateEntries<EntryItem = any>` / `UpdateEntries` exported from `@directus/types` WITHOUT the outer null: consumers need the name for their helper params. `UpdateEntries`, not `UpdateGroups` (`UpdateGroup` already means `{data, keys}`).
- **`DeleteKey = PrimaryKey`, never read the item's `id`** (jean: "uuids are not numbers"). Also REST `DELETE /items/x/5` hands the hook `["5"]` (validateKeys doesn't cast) and PG bigint PKs arrive as strings, so `number[]` would lie. The delete overload keeps an unused `_DeletedItem` param only so `filter<Row>` lands on it, not on the catch-all.
- Catch-all `(event: string)` overload refuses item events when the event name is inferable (`EventName extends ItemsReadEvent|ItemsMutationEvent ? never`).

**Settled, don't re-raise:** (#3) `filter<Row, Out>` two type args, (#4) event widened to `string`, (#6) old `filter<CreateEntries<X>>` still compiles double-wrapped — TS has no partial type-arg inference, so documented in code + PR, not fixable. Option "ItemKey<I> for update keys too" parked, not started.

**Why:** deep review found a no-return handler regression and a vacuous `@ts-expect-error` test (passed on base too, delete such tests).
**How to apply:** a consumer migrates its hooks to `filter<X>` (item type) and re-resolves its `-dist` pin in its lockfile; see [[project_directus_pr387_update_groups]].
