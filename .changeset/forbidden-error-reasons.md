---
'@directus/api': patch
---

Give a large set of `ForbiddenError`s a human-readable `reason`, so `403` responses say _why_ access was denied instead of the generic "You don't have permission to access this." Covers guards across the `collections`, `fields`, `relations` and `users` services (auth, token-type, public-registration, TFA), the `schema` service, `server health`, `getItemPermissions`, share `invite`, `ItemsService.readOne` not-found, primary-key validation, import/export, O2M payload resolution, and the `extensions` / `metrics` / `permissions` / `policies` / `roles` / `users` controllers. Uses the existing `ForbiddenError({ reason })` field — status stays `403`, no behavioural change beyond the message text.
