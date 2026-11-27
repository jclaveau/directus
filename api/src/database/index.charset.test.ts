import { expect, test, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@directus/env', () => {
	return {
		useEnv: () => {
			return {
				DB_DATABASE: 'directus',
				DB_EXCLUDE_TABLES: ['spatial_ref_sys'],
			};
		},
	};
});

vi.mock('knex', () => {
	const tables = [
		{ name: 'articles', collation: 'latin1_swedish_ci' },
		{ name: 'spatial_ref_sys', collation: 'latin1_swedish_ci' },
	];

	const database = Object.assign(
		() => {
			return { select: () => ({ where: async () => tables }) };
		},
		{
			client: { constructor: { name: 'Client_MySQL2' } },
			on: vi.fn(function (this: unknown) {
				return this;
			}),
			raw: vi.fn(),
			select: () => {
				return { first: async () => ({ collation: 'utf8mb4_unicode_ci' }) };
			},
		},
	);

	return { default: { default: () => database } };
});

vi.mock('./helpers/index.js', () => {
	return {
		getHelpers: () => {
			return {
				schema: { getColumnsWithInvalidCollation: async () => [] },
			};
		},
	};
});

vi.mock('../utils/transaction.js', () => ({ trackTransactionsOf: vi.fn() }));
vi.mock('../metrics/index.js', () => ({ useMetrics: () => undefined }));

vi.mock('../logger/index.js', () => {
	return { useLogger: () => ({ warn, error: vi.fn(), info: vi.fn() }) };
});

import { constructDatabase } from './index.js';

test('the collation check skips the tables DB_EXCLUDE_TABLES names', async () => {
	constructDatabase({ client: 'mysql' });

	await vi.waitFor(() => {
		expect(warn).toHaveBeenCalled();
	});

	expect(warn).toHaveBeenCalledWith([
		"Some tables and columns do not match your database's default collation",
		' (utf8mb4_unicode_ci):\n\t\t- Table "articles": "latin1_swedish_ci"\n',
	].join(''));
});
