import type { SchemaOverview } from '@directus/types';
import { oneLine } from '@directus/utils';
import { describe, expect, test, vi } from 'vitest';

const { readByQuery } = vi.hoisted(() => ({ readByQuery: vi.fn() }));

vi.mock('@directus/env', () => {
	return {
		useEnv: () => {
			return { EXPORT_BATCH_SIZE: 100, STORAGE_LOCATIONS: ['local'] };
		},
	};
});

vi.mock('../database/index.js', () => ({ default: vi.fn() }));

vi.mock('../logger/index.js', () => {
	return { useLogger: () => ({ error: vi.fn() }) };
});

vi.mock('../utils/transaction.js', () => {
	return {
		transaction: vi.fn(async (_knex: unknown, cb: (trx: unknown) => unknown) => {
			return cb({});
		}),
		queueAfterCommit: vi.fn(() => false),
	};
});

vi.mock('../utils/get-service.js', () => {
	return { getService: vi.fn(() => ({ readByQuery })) };
});

vi.mock('./files.js', () => {
	return {
		FilesService: vi.fn(() => ({ uploadOne: vi.fn(async () => 1) })),
	};
});

import { ExportService } from './import-export.js';

describe('ExportService.exportToFile batch limit', () => {
	test(oneLine`
		a limit of 30 under an EXPORT_BATCH_SIZE of 100 reads one page of 30
	`, async () => {
		readByQuery
			.mockResolvedValueOnce([{ count: 50 }])
			.mockResolvedValueOnce([{ id: 1 }]);

		await new ExportService({
			knex: {} as any,
			accountability: null,
			schema: {
				collections: { articles: { primary: 'id' } },
				relations: [],
			} as unknown as SchemaOverview,
		}).exportToFile('articles', { limit: 30 }, 'json');

		expect(readByQuery).toHaveBeenCalledTimes(2);

		expect(readByQuery).toHaveBeenLastCalledWith({
			limit: 30,
			offset: 0,
			sort: ['id'],
		});
	});
});
