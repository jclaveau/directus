import { oneLine } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import { decideAccess } from './decide-access.js';

describe('decideAccess', () => {
	test.each(['active', 'trialing', 'past_due'])('keeps access when %s', (status) => {
		expect(decideAccess(
			{ status, cancelAtPeriodEnd: false, currentPeriodEnd: null },
			new Date('2026-11-05T00:00:00Z'),
		))
			.toBe('keep');
	});

	test.each(['unpaid', 'suspended', 'expired'])(oneLine`
		revokes access when %s
	`, (status) => {
		expect(decideAccess(
			{
				status,
				cancelAtPeriodEnd: true,
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			},
			new Date('2026-11-05T00:00:00Z'),
		))
			.toBe('revoke');
	});

	test('keeps a canceled subscription until its paid period ends', () => {
		expect(decideAccess(
			{
				status: 'canceled',
				cancelAtPeriodEnd: true,
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			},
			new Date('2026-11-05T00:00:00Z'),
		))
			.toBe('keep');
	});

	test('revokes a canceled subscription once its paid period ended', () => {
		expect(decideAccess(
			{
				status: 'canceled',
				cancelAtPeriodEnd: true,
				currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
			},
			new Date('2026-11-05T00:00:00Z'),
		))
			.toBe('revoke');
	});

	test('revokes a canceled subscription without a period end', () => {
		expect(decideAccess(
			{ status: 'canceled', cancelAtPeriodEnd: true, currentPeriodEnd: null },
			new Date('2026-11-05T00:00:00Z'),
		))
			.toBe('revoke');
	});

	test('revokes a subscription canceled immediately', () => {
		expect(decideAccess(
			{
				status: 'canceled',
				cancelAtPeriodEnd: false,
				currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
			},
			new Date('2026-11-05T00:00:00Z'),
		))
			.toBe('revoke');
	});

	test('refuses a status without an access rule', () => {
		expect(() => {
			decideAccess(
				{ status: 'incomplete', cancelAtPeriodEnd: false, currentPeriodEnd: null },
				new Date('2026-11-05T00:00:00Z'),
			);
		})
			.toThrow(new Error(
				'Subscription status "incomplete" has no access rule yet',
			));
	});
});
