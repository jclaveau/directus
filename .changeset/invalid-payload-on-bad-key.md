---
'@directus/api': patch
---

A malformed primary key on a by-key item operation — a non-uuid value for a `uuid` primary key, or a non-integer for an `integer` primary key — now raises `InvalidPayloadError` (400) instead of `ForbiddenError` (403). The key shape is validated before any access check, so a malformed key is a bad request, not an authorization failure.
