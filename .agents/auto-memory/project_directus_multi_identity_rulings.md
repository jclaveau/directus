---
name: project_directus_multi_identity_rulings
description: Multi-identity design round (several emails / SSO providers per account) — jean's rulings 2026-11-26/27; table sketch, linking, S3, points 1-4, email dropped for primary_identity (8 E)
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
- **Columns (superseded 2026-11-27 by point 8 = E below):** `password` stays on
  `directus_users`. The earlier "`email` stays as a code-written copy" ruling is void.
  Password norm (web): one per account (Microsoft, Google, Apple, GitHub, Keycloak,
  Supabase); per-email only in Auth0 linked db identities.
- **Old email after a provider-side change (jean 2026-11-27, agreed):** when the provider
  sends a new verified email, the old email stays a verified identity the user can
  remove, shipped only together with a remove endpoint.
- **Points 1-4 (jean 2026-11-27):** 1 = every migrated email identity is
  `verified: false` (Directus keeps no verified flag, only `status: unverified` for a
  pending registration; the consumer has never verified one). 2 = B was ruled, then
  overturned by 9 = A below. 3 = A refined: the password login takes the account's primary
  identity whatever its verified flag, plus any verified email identity. 4 = A:
  removing an identity ends the sessions it opened (`directus_sessions.identity` FK
  ON DELETE CASCADE); the account's last identity can't be removed (400); an account
  may hold zero identities (token-only user).
- **Point 8 = E (jean 2026-11-27):** `directus_users.email` is DROPPED.
  `directus_users.primary_identity` (nullable M2O → `directus_user_identities.id`) is
  the only source; it may point at an SSO identity (providers sending no email:
  GitHub private, Apple after 1st login, openid without `email` scope, LDAP without
  `mail`, opaque SAML NameID). Single-column FK, so `@directus/schema` and
  `directus_relations` model it as a plain M2O (no composite-FK probe needed).
  Request params keep the key `email` (`POST /auth/login`, invite, password
  request/reset, SDK `LocalLoginPayload`): the api resolves it through identities
  (kind email, `lower(value)`). Rejected: C (email as composite FK `(id, email)`),
  D (rename `primary_email`), F (email kept as a trigger-derived read-only copy).
  Why E is affordable: the fork has one consumer, auditable (its code + its
  permissions/presets/Flows rows reading `email`); upstream merges are bounded to
  BSL v11.x. Blast radius in-repo (grep 2026-11-27): ~39 api, ~29 app, 8 sdk, 15
  packages files, 89 test files. The consumer's audit + PR ride the fork bump that
  brings #772.
- **Point 9 = A (jean 2026-11-27, overturns 2 B):** the unique index on
  `(kind, lower(value))` covers every row, verified or not: one address = one
  account, as `users.email` unique guaranteed before 8 E. A second account sending
  an address already held, even unverified, gets 400 `RECORD_NOT_UNIQUE` on
  `directus_user_identities.value`. No claim/takeover flow in the product: whoever
  wants an address held unverified by another account asks the operator by email,
  and an admin moves or removes the identity. Point 7 (verifying an email another
  account holds) dissolves: no two accounts can hold it.
- **Point 5 = A (jean 2026-11-27):** `provider`, `external_identifier` and
  `auth_data` move to `directus_user_identities` (SSO row: kind = provider name,
  value = external_identifier, auth_data) and are dropped from `directus_users`.
  Password login = password set + an email identity: the one-provider lock ends.
- **Point 6 = A (jean 2026-11-27):** a user reads their own identity rows, never
  `auth_data`; no create/update/delete through `/items` (adding = verification flow
  or linking B from a session, removing = the remove endpoint); admins full. jean
  asked to carry over EVERY single-provider guard. Audit 2026-11-27 (code read):
  login checks `status active` + `provider === providerName` + stall + login-attempt
  limiter + TFA (`authentication.ts:142`); non-admin can't write `provider` /
  `external_identifier`, writing either nulls `auth_data` (`users.ts:289-306`);
  self-read app-access excludes provider/external_identifier/auth_data; Flow log
  operations redact `payload.external_identifier`/`auth_data` (`flows.ts:733`);
  `auth_data` hidden in the app; `provider` choices filled from the configured
  providers (`get-field-system-rows.ts:9`); refresh/logout pick the driver from
  `user.provider` (→ `directus_sessions.identity`); SSO lookups by
  lower(external_identifier) with no provider filter (→ per kind). Gaps found:
  password reset never checks the provider (`users.ts:663`), harmless today, opens
  a password login on an SSO-created account once 5 A lands (point 10, asked);
  the SSO identity's value is not self-readable today (6 refinement, asked).
- **Open, asked 2026-11-27:** S3 x 9 A (provider sends a known user's new email
  another account holds): jean leans "A + add the identity"; adding collides with 9 A,
  proposed C = move it only when the holder's row is unverified. 10 (reset on a
  passwordless account). 6 refinement (hide SSO identity values from self-read).
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
