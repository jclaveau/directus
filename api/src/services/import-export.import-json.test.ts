import type { AbstractServiceOptions } from '@directus/types';
import { Readable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';

const upsertOne = vi.fn().mockResolvedValue(1);

vi.mock('../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../emitter.js', () => ({ default: { emitAction: vi.fn() } }));

vi.mock('../utils/transaction.js', () => ({
	transaction: vi.fn(async (_knex: unknown, cb: (trx: unknown) => unknown) => cb({})),
}));

vi.mock('../utils/get-service.js', () => ({ getService: vi.fn(() => ({ upsertOne })) }));

import emitter from '../emitter.js';
import { ImportService } from './import-export.js';

// Contract test for the stream-json bump: importJSON must still parse a JSON array
// stream and upsert each element in order. The v3 upgrade changed both the subpath
// (StreamArray.js -> stream-array.js) and the API (withParser() returns a Flushable,
// so the Duplex withParserAsStream() is required). This pins the parse+upsert
// behaviour so it stays identical before and after the dependency update.
describe('ImportService.importJSON (stream-json contract)', () => {
	test('parses a JSON array stream and upserts each row in order', async () => {
		upsertOne.mockClear();

		const service = new ImportService({
			knex: {},
			schema: {},
			accountability: null,
		} as unknown as AbstractServiceOptions);

		const rows = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
		const stream = Readable.from(JSON.stringify(rows));

		await service.importJSON('test', stream);

		expect(upsertOne).toHaveBeenCalledTimes(3);
		expect(upsertOne).toHaveBeenNthCalledWith(1, { name: 'a' }, expect.anything());
		expect(upsertOne).toHaveBeenNthCalledWith(2, { name: 'b' }, expect.anything());
		expect(upsertOne).toHaveBeenNthCalledWith(3, { name: 'c' }, expect.anything());
	});
});

describe.each([
	'importJSON',
	'importCSV',
] as const)('ImportService.%s', (importMethod) => {
	const importBodies = {
		importJSON: JSON.stringify([{ name: 'a' }, { name: 'b' }]),
		importCSV: 'name\na\nb\n',
	};

	test('fires the action of every row once the import committed', async () => {
		vi.mocked(emitter.emitAction).mockClear();
		upsertOne.mockReset();

		upsertOne.mockImplementation(async (_row, opts) => {
			opts.bypassEmitAction({ event: 'test.items.create', meta: {}, context: {} });

			// a row outlasts the end of the stream, where `drain` is registered
			await new Promise((resolve) => setTimeout(resolve, 50));

			return 1;
		});

		const service = new ImportService({
			knex: {},
			schema: {},
			accountability: null,
		} as unknown as AbstractServiceOptions);

		await service[importMethod]('test', Readable.from(importBodies[importMethod]));

		expect(emitter.emitAction).toHaveBeenCalledTimes(2);
	});

	test('fires no action when a later row rolls the import back', async () => {
		vi.mocked(emitter.emitAction).mockClear();
		upsertOne.mockReset();

		upsertOne
			.mockImplementationOnce(async (_row, opts) => {
				opts.bypassEmitAction({ event: 'test.items.create', meta: {}, context: {} });

				return 1;
			})
			.mockImplementationOnce(async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));

				throw new Error('row refused');
			});

		const service = new ImportService({
			knex: {},
			schema: {},
			accountability: null,
		} as unknown as AbstractServiceOptions);

		await expect(
			service[importMethod]('test', Readable.from(importBodies[importMethod])),
		).rejects.toEqual(new Error('row refused'));

		// the queue reports drained after the failed row
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(emitter.emitAction).not.toHaveBeenCalled();
	});
});
