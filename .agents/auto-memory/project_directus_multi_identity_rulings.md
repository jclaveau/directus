---
name: project_directus_multi_identity_rulings
description: Multi-identity design round (several emails / SSO providers per account) — jean's rulings 2026-11-26/27; table sketch, linking, S3, points 1-4, email dropped for primary_identity (8 E), user_info + scope on SSO rows (11 C), S3 = F conflicts view
metadata:
  type: project
---

Design round 2026-11-25/27, closed. Build go (jean 2026-11-27: "go, open the pr and
/pr-autoreview it once done"): #772 exists as a draft, so update its body, mark it
ready, autoreview once CI is green; merge stays a separate ask. Sketch: `directus_user_identities`
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
- **6 refinement + 10 (jean 2026-11-27):** 6: an SSO identity's `value` is not
  self-readable (parity with today's hidden `external_identifier`); email values are.
  10 = A: password reset is refused (403) on an account with no password; a first
  password is set only from a logged-in session, so offboarding at the IdP keeps
  locking an SSO-created account out.
- **Point 11 = C (jean 2026-11-27):** an SSO identity row gets `user_info` (jsonb,
  EVERY claim of the driver's `userInfo`, overwritten on each login, no key list: keys
  differ per driver, SAML sends URIs, oauth2 has no standard) and `scope` (the scope
  the token response says was GRANTED, fallback the configured `AUTH_<P>_SCOPE`; `~`
  for ldap/saml). What is stored = what the consumer's scope/IdP config asks; naming
  it on a consent page is the consumer's job, not core's. Never in `user_info`:
  accessToken/idToken (refresh token stays in hidden `auth_data`). Flow logs redact it
  like `value`; check in build that the sync write creates no `directus_revisions` row.
  Why (jean): `scope` is stored so a later, wider scope can be told apart per identity;
  the provider-side consent screen is not the consumer's GDPR consent.
- **S3 x 9 A = F (jean 2026-11-27, design round closed):** provider sends a known
  user's new email another account holds (verified or not). The SSO login always
  passes (a refusal lets a squatter lock an SSO user out). No email identity added,
  nothing moved or merged (E notifications and C move dropped); the new email lands
  in the SSO row's `user_info` (11 C); warn log. Postgres view
  `directus_user_identity_conflicts` joins `lower(user_info->>'email')` to `email`
  rows of another user, with an index on that expression (`TODO(#610)` other DBs);
  the operator reconciles by hand. No conflict = the email identity is added (S3 A).
- **#477 (jean 2026-11-27):** handled in #768, which merges before #772.
- **Rebase gotcha:** hhh-dev blackbox tests starting an ldap / oauth2 / openid instance
  that can't tell a verified email fail the boot on this branch: add
  `AUTH_<P>_REQUIRE_VERIFIED_EMAIL=false` to them (`f05aade969`).
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
- **#772 /pr-autoreview done 2026-11-27, not merged** (head `ad30fcea43`, CI green,
  100% of added lines reviewed). Results, 30 choice blocks + one recommendation each:
  https://github.com/jclaveau/directus/pull/772#issuecomment-7227424338 . Fixed as
  ruling-backed (11 C): M12 Flow log redacts nested `primary_identity` value/auth_data/
  user_info; M13 token claims dropped from `user_info` at any depth (was choice 28).
  Awaiting jean, none ruled yet: (1) now / A / B on choices 1-27, 29-30; (2) go on the
  held coarse module/route renames; (3) keep `utils/user-name.ts` literal `'email'`
  (recommended) vs importing `EMAIL_IDENTITY_KIND`.
- **#772 autoreview choices, jean 2026-11-28 (no build go yet):** 21 A (a linked
  provider never rewrites the role); 12 A as long as it keeps today's Directus login
  (email stands in as the SSO value); 8 A (one transaction); 27 = now (an auth.create
  filter's rewrite is the consumer's job); 16 A (reset_url checked first); 22 A
  (`prompt=login` on a link); 3 A (SAML link refused) + oos issue #777 (signed
  RelayState, conflicts view misses SAML claim); 25 A (auth.update on a link); 19 A
  as the minimum (case-only rewrite stays verified), lowercasing asked; 20 = invites
  oos, issue #778, rewritten in another PR. Asked back, not ruled: 15 (unique index?),
  24 (kind by driver), 1 (+ no reconciliation outside a logged-in link?), 18
  (`email` still writable?), 10 (why ada reads bob's identities), 23 (why nullable).
  Later: 2, 4-7, 9, 11, 13, 14, 17, 26, 29, 30, renames, user-name.ts literal.
- **Round 2, jean 2026-11-28:** 19 = A (kept as typed, matched by lower(value)).
  18 = A on update: `email` is never PATCHable on users, only an identity's value is;
  on create asked (18 B). 23: a user with no identity is a bug (overturns 4 A's
  token-only account); create refusal + migration failure asked. Asked back: 15
  (jean proposes a `primary` flag on identities with unique(user) where primary,
  vs composite FK NOT NULL), 24 (jean: kind `email` misleading, `password`?; `local`
  is Directus's own password store, not posix), 1 (jean: add an identity only from a
  logged-in session; overturns S3 A; an IdP sending an unverified address squats it
  today, sso-identity.ts:363), 7 (refuse provider/external_identifier like email).
- **Round 3, jean 2026-11-28:** 15 = A (users service refuses a primary_identity
  of another account) + an account with no primary takes "the first" identity
  = the oldest by a new `date_created` column (default now(); jean 15 B, uuids
  being random); also picks the replacement of a removed primary (point 9). 24 = B: the local drivers' kind is
  renamed `password` (value = the address), for every local driver whatever its
  name ("password is not an SSO driver"). 18 = B: `email` refused on users create
  too, identities nested. 23 = A, message "A user needs an identity"; legacy users
  with no email nor SSO id fail the migration. 7 B (refuse provider/
  external_identifier) not answered. 1: "even if unverified, it should trigger a
  duplicate" read as asked (conflicts view vs register refused).
- **Dropped by that review (reviewer's call, not jean's):** `verifyPassword` skipping
  an unconfigured provider (ends in `InvalidCredentialsError`); misleading log text on
  concurrent email syncs; concurrent first logins of one subject → 403 (predates #772).

**Why:** today one provider per user (`authentication.ts:142`), one email, one auth_data.
**How to apply:** do not re-raise linking or S3 placement; see [[project_directus_pr749_c_rulings]].
