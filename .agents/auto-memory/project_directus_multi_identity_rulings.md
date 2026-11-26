---
name: project_directus_multi_identity_rulings
description: Multi-identity design round (several emails / SSO providers per account) — jean's rulings 2026-11-26; table sketch, linking, S3 placement
metadata:
  type: project
---

Design round 2026-11-25/26 (no code yet, no go). Sketch: `directus_user_identities`
(user FK ON DELETE CASCADE, kind email|<provider>, value, verified, auth_data moved
from users, unique(kind, lower(value))); `directus_sessions.identity` FK so refresh /
logout call the provider that opened the session.

- **Linking = B (jean 2026-11-26):** an SSO login whose identity no account holds,
  carrying an email an account already has, is refused (403, as today via the email
  unique check). The same SSO login made from a logged-in session adds the identity
  to that account. Never auto-link by email match (pre-account takeover).
- **S3 unverified new email = A, in the multi-identity PR (jean 2026-11-26):** a known
  user's unverified new email from the provider lands as an identity `verified: false`;
  #749 will NOT merge before multi-identity.
- **Open:** drop `directus_users.email` / `password` so identities are the only source
  (jean's proposal) vs keep `email` as code-written copy of the primary identity.
  Old email after change (keep as removable identity) unruled. Branch order vs #749
  (S3 commit `c30265aea6` lives on #749) unruled.

**Why:** today one provider per user (`authentication.ts:142`), one email, one auth_data.
**How to apply:** do not re-raise linking or S3 placement; see [[project_directus_pr749_c_rulings]].
