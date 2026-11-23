import { describe, expect, test } from 'vitest';
import {
	composePlanLine,
	composeSeatLine,
	composeSubscriptionLines,
	formatInterval,
	isLiveSubscription,
	normalizeCustomAmount,
} from './compose-module-lines.js';

describe('formatInterval', () => {
	test.each([
		['{"months":1}', 'month'],
		['{"months":12}', 'year'],
		['{"months":3}', '3 months'],
		['{"days":1}', 'day'],
		['{"days":14}', '14 days'],
		['{"months":1,"days":2}', '1 months 2 days'],
	])('reads %s as %s', (planInterval, intervalText) => {
		expect(formatInterval(planInterval)).toBe(intervalText);
	});

	test('reads an interval the API already parsed', () => {
		expect(formatInterval({ months: 12 })).toBe('year');
	});
});

describe('composePlanLine', () => {
	test('shows a plan at its price, a decimal the database sent as a number', () => {
		expect(composePlanLine({
			code: 'yearly',
			name: 'Yearly',
			amount: 100,
			currency: 'EUR',
			interval: '{"months":12}',
			beneficiaries_max: 1,
		})).toBe('Yearly 100.00 EUR / year');
	});
});

describe('normalizeCustomAmount', () => {
	test.each([
		['12', '12.00'],
		['12.5', '12.50'],
		['12,5', '12.50'],
		['12.', '12.00'],
		['14.90', '14.90'],
		[' 30 ', '30.00'],
		['12.505', '12.505'],
		['1,000.00', '1,000.00'],
		['-5', '-5'],
		['twelve', 'twelve'],
	])('sends %j as %j', (amountText, checkoutAmount) => {
		expect(normalizeCustomAmount(amountText)).toBe(checkoutAmount);
	});
});

describe('composeSeatLine', () => {
	test.each([
		[1, 1, 'Beneficiaries: 1 of 1 seat'],
		[2, 3, 'Beneficiaries: 2 of 3 seats'],
		[4, null, 'Beneficiaries: 4'],
	])('counts %s of %s', (seatCount, seatMax, seatLine) => {
		expect(composeSeatLine(seatCount, seatMax)).toBe(seatLine);
	});
});

describe('isLiveSubscription', () => {
	test.each([
		['pending', true],
		['active', true],
		['past_due', true],
		['canceled', false],
		['expired', false],
	])('takes a %s subscription as live: %s', (subscriptionStatus, isLive) => {
		expect(isLiveSubscription({
			id: 1,
			plan: { code: 'basic', name: 'Basic' },
			provider: 'mollie',
			status: subscriptionStatus,
			current_period_end: null,
			cancel_at_period_end: false,
			roles: ['beneficiary'],
		})).toBe(isLive);
	});
});

describe('composeSubscriptionLines', () => {
	test('shows a manager its price, renewal and seats', () => {
		expect(composeSubscriptionLines(
			{
				id: 7,
				plan: { code: 'team', name: 'Team' },
				provider: 'stripe',
				status: 'active',
				current_period_end: '2099-02-01T00:00:00.000Z',
				cancel_at_period_end: false,
				roles: ['manager', 'beneficiary'],
				amount: '30.00',
				currency: 'EUR',
				beneficiaries: ['tester@example.com'],
			},
			{
				code: 'team',
				name: 'Team',
				amount: '25.00',
				currency: 'EUR',
				interval: '{"months":1}',
				beneficiaries_max: 3,
			},
		)).toEqual([
			'Team · active',
			'30.00 EUR / month',
			'Renews on 2099-02-01',
			'Beneficiaries: 1 of 3 seats',
		]);
	});

	test('says when a subscription cancelled at period end ends', () => {
		expect(composeSubscriptionLines(
			{
				id: 8,
				plan: { code: 'basic', name: 'Basic' },
				provider: 'stripe',
				status: 'active',
				current_period_end: '2099-02-01T00:00:00.000Z',
				cancel_at_period_end: true,
				roles: ['manager', 'beneficiary'],
				amount: '10.00',
				currency: 'EUR',
				beneficiaries: ['tester@example.com'],
			},
			{
				code: 'basic',
				name: 'Basic',
				amount: '10.00',
				currency: 'EUR',
				interval: '{"months":1}',
				beneficiaries_max: 1,
			},
		)).toEqual([
			'Basic · active',
			'10.00 EUR / month',
			'Ends on 2099-02-01',
			'Beneficiaries: 1 of 1 seat',
		]);
	});

	test('shows a beneficiary neither the price nor the seats', () => {
		expect(composeSubscriptionLines(
			{
				id: 9,
				plan: { code: 'team', name: 'Team' },
				provider: 'mollie',
				status: 'active',
				current_period_end: '2099-02-01T00:00:00.000Z',
				cancel_at_period_end: false,
				roles: ['beneficiary'],
			},
			{
				code: 'team',
				name: 'Team',
				amount: '25.00',
				currency: 'EUR',
				interval: '{"months":1}',
				beneficiaries_max: 3,
			},
		)).toEqual(['Team · active', 'Renews on 2099-02-01']);
	});

	test('shows a pending checkout without a period end', () => {
		expect(composeSubscriptionLines(
			{
				id: 10,
				plan: { code: 'basic', name: 'Basic' },
				provider: 'mollie',
				status: 'pending',
				current_period_end: null,
				cancel_at_period_end: false,
				roles: ['manager', 'beneficiary'],
				amount: '10.00',
				currency: 'EUR',
				beneficiaries: ['tester@example.com'],
			},
			undefined,
		)).toEqual(['Basic · pending', 'Beneficiaries: 1']);
	});
});
