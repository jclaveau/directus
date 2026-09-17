/**
 * The machine actors that impersonate users, seeded by `20260917B-add-bots`.
 * Each is a `directus_users` row under the `Bots` role with one policy of its
 * own, so what a job may do (and which pool it uses) is a policy, not an env.
 * Bots never log in (`password` null) and are never impersonated.
 */
export const BOTS_ROLE = '01a100fe-a928-419c-bd92-9813eaac4209';

export const CACHE_AUDIT_BOT = {
	user: '60ae1046-adc0-4390-9470-69820b41d068',
	policy: 'f9534b70-294d-4091-8d2d-d105ce79d0e2',
	access: '5f4d63d7-e5fe-4a6d-b181-39bd31e4bc10',
} as const;
