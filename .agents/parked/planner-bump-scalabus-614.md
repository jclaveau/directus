# Parked: planner bump PR description — Scalabus #614 changes

Paste into the description of the next planner PR that bumps the fork past
jclaveau/directus#614 (nested-writes test net, head 4b00d4298d). jean ruled
2026-11-01 that both points are on purpose; the planner adapts, the fork doesn't.

```markdown
## Scalabus #614: what this bump changes for the planner

### Deploy can be held by two migrations (on purpose)

- The translations migration and the `filename_disk` migration (`20261017A`)
  refuse while duplicate rows exist.
- A refused migration keeps `/server/health` at 503, so Railway does not switch
  over and the old deploy keeps serving.
- Before deploying: count the duplicates on prod (SELECT only) and clean them
  in the domain first.

### REST contract changes (on purpose)

- An admin gets **404** on a missing key, so a retried DELETE now throws.
- An admin batch DELETE naming a missing key answers **404 and deletes
  nothing**; a pre-clean by keys must delete by filter instead.
- Array POSTs to the system collections (`directus_*`) are now validated.
- An update or create naming one existing o2m child for several rows lets the
  **last row win**, as before; `refuseChildJoiningSeveralRows: true` (service
  option, never set by REST) refuses it with a 400, for an existing m2m junction
  row too (#658).

### To check in the planner

- [ ] grep the planner for DELETE by keys that may target already-deleted rows
- [ ] grep for batch DELETE used as a pre-clean
- [ ] grep for array POSTs to `directus_*` collections
- [ ] prod duplicate counts for the two migrations are 0
```
