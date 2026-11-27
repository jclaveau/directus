---
name: project_directus_multi_identity_rulings
description: Multi-identity design round (several emails / SSO providers per account) — jean's rulings 2026-11-26; table sketch, linking, S3 placement
metadata:
  type: project
---

Design round 2026-11-25/26 (no identity code written yet; PR open + autoreview asked
2026-11-26). Sketch: `directus_user_identities`
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
- **Columns stay (jean "2 => fine", 2026-11-26):** `password` stays on `directus_users`;
  `email` stays as a code-written copy of the primary identity (a PATCH may only pick
  one of the user's own verified email identities). Rejected: jean's own first idea of
  dropping both so identities are the only source — breaks `$CURRENT_USER.email`,
  presets, Flows, SDK/GraphQL, app forms, extensions. Password norm (web): one per
  account (Microsoft, Google, Apple, GitHub, Keycloak, Supabase); per-email only in
  Auth0 linked db identities.
- **Old email after a provider-side change (jean 2026-11-27, agreed):** when the provider
  sends a new verified email, the old email stays a verified identity the user can
  remove, shipped only together with a remove endpoint.
- **Points 2-4 (jean 2026-11-27):** 2 = B: an unverified email identity blocks no
  one; the unique index on `(kind, lower(value))` covers verified rows only. 3 = A: the
  password login takes any verified email identity of the account. 4 = A: removing an
  identity ends the sessions it opened (`directus_sessions.identity` FK ON DELETE
  CASCADE); the account's last identity can't be removed (400). Point 1 (migrated
  emails verified or not) asked back: Directus keeps no verified flag, only
  `status: unverified` for a pending registration.
- **Focus (jean 2026-11-27):** stay on #772 until it merges; do not raise the #749
  rebase or other PRs meanwhile.
- **Today, from code (not run):** a password user's SSO login with the same email is a
  403 `InvalidProviderError` via the email unique check, NOT a second account;
  `external_identifier` is unique across providers and looked up without a provider
  filter in all four SSO drivers.
- **S3 moved (jean go 2026-11-26):** #749's `c30265aea6` + `5092d8ae9b` cherry-picked
  onto `multi-identity` (hhh-dev base) as `4254b43afb` + `0e24fe4728`, driver tests cut
  to the verified-email cases. #749 untouched; it rebases after multi-identity merges.
- **#772 autoreview finding 1 = A (jean 2026-11-26):** when the identifier IS the email
  (oauth2 without IDENTIFIER_KEY, openid without the identifier claim), an unverified
  email is refused (401 InvalidCredentialsError) before `fetchUserId`, also for a known
  user. Finding 2 (boolean env read only off process.env, `_FILE` "true\n" = false):
  jean asks for it in the env layer (`createEnv`/`cast`).
- **Finding 2 placement = own PR (jean "go", 2026-11-26):** branch
  `v11.10.1-feat/env-strict-boolean` off hhh-dev, worktree `env-strict-boolean`; every
  boolean-typed key refuses anything but true/false/1/0 from any source, `_FILE` values
  trimmed unless string-typed; not part of #772 (draft PR of `multi-identity`); PR body
  planned with `Related: #772`. Same subject as issue #477 (wide `toBoolean` fix,
  [[project_directus_shared_settings_source_of_truth]]); jean was not recorded asking
  for a link to it.
- **#773 MERGED 2026-11-27 (`e1f5f44c92`), case ruled A:** a boolean-typed value is
  trimmed + lowercased from every layer (`TRUE`, `" true\n"` read true), `yes`/`on`/`""`/
  `null` refused. #772 rebased on it; its `validateBooleanEnv` call in `auth.ts`
  dropped (`b5618c6381`): TYPE_MAP's `AUTH_.+_REQUIRE_VERIFIED_EMAIL` covers it.

**Why:** today one provider per user (`authentication.ts:142`), one email, one auth_data.
**How to apply:** do not re-raise linking or S3 placement; see [[project_directus_pr749_c_rulings]].
