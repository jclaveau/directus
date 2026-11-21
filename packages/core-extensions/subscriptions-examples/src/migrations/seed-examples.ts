import { defineMigration } from '@directus/extensions-sdk/scalabus';
import { randomUUID } from 'node:crypto';

export const EXAMPLES_MEMBER_POLICY = 'Examples member';

export const EXAMPLES_TESTER_ROLE = 'Examples tester';

export const EXAMPLES_TESTER_EMAIL = 'tester@example.com';

/**
 * The argon2id hash of `tester`, the published password of a preview user:
 * hashed once rather than at each run, so the bundle needs no native
 * dependency of its own.
 */
const TESTER_PASSWORD_HASH = '$argon2id$v=19$m=65536,p=4,t=3'
	+ '$iUI/jN2lJ1phMSz3m3DcKg$4zrok2Vsc7CllyO6CYAN+ZYUpjyz25bSmsbD+sjdLFM';

export const EXAMPLES_PLANS = [
	{
		code: 'basic',
		name: 'Basic',
		amount: 10,
		currency: 'EUR',
		interval: '{"months":1}',
		beneficiaries_max: 1,
	},
	{
		code: 'team',
		name: 'Team',
		amount: 25,
		currency: 'EUR',
		interval: '{"months":1}',
		beneficiaries_max: 3,
	},
	{
		code: 'yearly',
		name: 'Yearly',
		amount: 100,
		currency: 'EUR',
		interval: '{"months":12}',
		beneficiaries_max: 1,
	},
];

const PLAN_FIELDS = 'code,name,amount,currency,interval,beneficiaries_max';

/**
 * The plans, the policy they grant and the user who tries them in the module.
 * The tester removes a seat through `/items`, which reads the rows it deletes
 * and the user it names first.
 */
export const seedExamples = defineMigration('20261121A-seed-examples', {
	async up(knex) {
		const memberPolicy = randomUUID();
		const testerPolicy = randomUUID();
		const testerRole = randomUUID();

		await knex('directus_policies').insert([
			{
				id: memberPolicy,
				name: EXAMPLES_MEMBER_POLICY,
				icon: 'card_membership',
				description: 'Granted by the sample plans of the examples',
				app_access: true,
				admin_access: false,
				enforce_tfa: false,
			},
			{
				id: testerPolicy,
				name: EXAMPLES_TESTER_ROLE,
				icon: 'science',
				description: 'Opens the examples module and manages its seats',
				app_access: true,
				admin_access: false,
				enforce_tfa: false,
			},
		]);

		await knex('directus_roles').insert({
			id: testerRole,
			name: EXAMPLES_TESTER_ROLE,
			icon: 'science',
		});

		await knex('directus_access').insert({
			id: randomUUID(),
			role: testerRole,
			policy: testerPolicy,
		});

		await knex('directus_users').insert({
			id: randomUUID(),
			email: EXAMPLES_TESTER_EMAIL,
			password: TESTER_PASSWORD_HASH,
			role: testerRole,
			status: 'active',
			provider: 'default',
		});

		await knex('directus_permissions').insert([
			{
				policy: memberPolicy,
				collection: 'subscription_plans',
				action: 'read',
				fields: PLAN_FIELDS,
			},
			{
				policy: testerPolicy,
				collection: 'subscription_plans',
				action: 'read',
				fields: PLAN_FIELDS,
			},
			{
				policy: testerPolicy,
				collection: 'directus_users',
				action: 'read',
				fields: 'id,email',
			},
			{
				policy: testerPolicy,
				collection: 'subscription_beneficiaries',
				action: 'read',
				fields: 'id,subscription,user',
			},
			{
				policy: testerPolicy,
				collection: 'subscription_beneficiaries',
				action: 'delete',
				fields: '*',
			},
		]);

		await knex('subscription_plans').insert(
			EXAMPLES_PLANS.map((examplesPlan) => {
				return { ...examplesPlan, policy: memberPolicy, status: 'active' };
			}),
		);
	},

	async down(knex) {
		const seededPolicies = await knex('directus_policies')
			.whereIn('name', [EXAMPLES_MEMBER_POLICY, EXAMPLES_TESTER_ROLE])
			.pluck('id');

		await knex('subscription_plans')
			.whereIn('code', EXAMPLES_PLANS.map((examplesPlan) => examplesPlan.code))
			.delete();

		await knex('directus_permissions')
			.whereIn('policy', seededPolicies)
			.delete();

		await knex('directus_access')
			.whereIn('policy', seededPolicies)
			.delete();

		await knex('directus_users')
			.where('email', EXAMPLES_TESTER_EMAIL)
			.delete();

		await knex('directus_roles')
			.where('name', EXAMPLES_TESTER_ROLE)
			.delete();

		await knex('directus_policies')
			.whereIn('id', seededPolicies)
			.delete();
	},
});
