import type { Knex } from 'knex';
import { describe, expect, test, vi } from 'vitest';
import { AutoIncrementHelperDefault } from './dialects/default.js';
import { AutoIncrementHelperPostgres } from './dialects/postgres.js';

describe('AutoSequenceHelper (default)', () => {
	test('leaves the sequence alone', async () => {
		const raw = vi.fn();
		const helper = new AutoIncrementHelperDefault({ raw } as unknown as Knex);

		await expect(
			helper.raiseAutoIncrementSequence('artists', 'id', 102222),
		).resolves.toBeUndefined();

		expect(raw).not.toHaveBeenCalled();
	});
});

describe('AutoSequenceHelper (postgres)', () => {
	test('raises the sequence past the key the caller provides', async () => {
		const raw = vi.fn();
		const helper = new AutoIncrementHelperPostgres({ raw } as unknown as Knex);

		await helper.raiseAutoIncrementSequence('artists', 'id', 102222);

		expect(raw).toHaveBeenCalledWith(
			`SELECT SETVAL(pg_get_serial_sequence(?, ?),
				GREATEST(?, COALESCE((SELECT MAX(??) FROM ??), 0)));`,
			['"artists"', 'id', 102222, 'id', 'artists'],
		);
	});
});
