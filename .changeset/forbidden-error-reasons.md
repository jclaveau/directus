---
'@directus/api': patch
---

Give several `ForbiddenError`s a human-readable `reason`, so the 403 response says _why_ access was denied instead of the generic "You don't have permission to access this." Covers the admin-only schema operations (`snapshot`, `apply`, `diff`) and the authentication-required `server health`, `getItemPermissions` and share `invite` guards. Uses the existing `ForbiddenError({ reason })` field — status stays `403`, no behavioural change beyond the message text.
