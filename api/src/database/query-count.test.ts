import type { Knex } from 'knex';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, test, vi } from 'vitest';
import {
	countQueriesOf,
	emptyQueryCounts,
	formatStatementCounts,
	formatTableCounts,
	formatTransactionCounts,
	queryCountStore,
} from './query-count.js';

afterEach(() => {
	vi.restoreAllMocks();
});

test('counts every statement sent on a connection, by kind and table', () => {
	const counts = emptyQueryCounts();

	queryCountStore.run(counts, () => {
		const driverClient = new (class {
			_query(_connection: object, _queryObject: object) {
				return Promise.resolve();
			}
		})();

		countQueriesOf({ client: driverClient } as unknown as Knex);

		driverClient._query({ __knexUid: 'a' }, {
			sql: 'select "id" from "articles" where "id" = ?',
		});

		driverClient._query({ __knexUid: 'a' }, {
			sql: 'insert into "articles" ("title") values (?)',
		});

		driverClient._query({ __knexUid: 'a' }, {
			sql: 'update "authors" set "name" = ?',
		});

		driverClient._query({ __knexUid: 'a' }, {
			sql: 'delete from "articles" where "id" = ?',
		});

		driverClient._query({ __knexUid: 'a' }, {
			sql: 'SET search_path TO public',
		});
	});

	expect(formatStatementCounts(counts)).toBe(
		'total=5, select=1, insert=1, update=1, delete=1, transaction=0, other=1',
	);

	expect(formatTableCounts(counts)).toBe('articles=3, authors=1');
});

test('leaves a statement sent outside any request uncounted', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve('driver result');
		}
	})();

	countQueriesOf({ client: driverClient } as unknown as Knex);

	const result = await driverClient._query(
		{ __knexUid: 'a' },
		{ sql: 'select 1' },
	);

	expect(result).toBe('driver result');
});

test('reports a transaction: its statements, length and connection', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	})();

	countQueriesOf({ client: driverClient } as unknown as Knex);

	vi.spyOn(performance, 'now')
		.mockReturnValueOnce(1000)
		.mockReturnValueOnce(1084);

	const counts = emptyQueryCounts();

	await queryCountStore.run(counts, async () => {
		await driverClient._query({ __knexUid: 'a' }, { sql: 'BEGIN;' });

		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'select * from "articles"',
		});

		await driverClient._query({ __knexUid: 'a' }, { sql: 'COMMIT;' });
	});

	expect(formatStatementCounts(counts)).toBe(
		'total=3, select=1, insert=0, update=0, delete=0, transaction=2, other=0',
	);

	expect(formatTransactionCounts(counts)).toBe(
		'count=1, rollback=0, savepoint=0, longest=84ms, maxConnections=1',
	);
});

test('counts a rollback and a savepoint, not a rollback to it', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	})();

	countQueriesOf({ client: driverClient } as unknown as Knex);

	vi.spyOn(performance, 'now')
		.mockReturnValueOnce(1000)
		.mockReturnValueOnce(1012);

	const counts = emptyQueryCounts();

	await queryCountStore.run(counts, async () => {
		await driverClient._query({ __knexUid: 'a' }, { sql: 'BEGIN;' });

		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'SAVEPOINT trx2;',
		});

		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'ROLLBACK TO SAVEPOINT trx2',
		});

		await driverClient._query({ __knexUid: 'a' }, { sql: 'ROLLBACK' });
	});

	expect(formatStatementCounts(counts)).toBe(
		'total=4, select=0, insert=0, update=0, delete=0, transaction=4, other=0',
	);

	expect(formatTransactionCounts(counts)).toBe(
		'count=1, rollback=1, savepoint=1, longest=12ms, maxConnections=1',
	);
});

test('reports two connections held while a transaction is open', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	})();

	countQueriesOf({ client: driverClient } as unknown as Knex);

	const counts = emptyQueryCounts();

	await queryCountStore.run(counts, async () => {
		await driverClient._query({ __knexUid: 'a' }, { sql: 'BEGIN;' });
		await driverClient._query({ __knexUid: 'b' }, { sql: 'select 1' });
		await driverClient._query({ __knexUid: 'a' }, { sql: 'COMMIT;' });
		await driverClient._query({ __knexUid: 'b' }, { sql: 'select 1' });
	});

	expect(counts.maxConnections).toBe(2);
});

test('reports one connection for sequential reads', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	})();

	countQueriesOf({ client: driverClient } as unknown as Knex);

	const counts = emptyQueryCounts();

	await queryCountStore.run(counts, async () => {
		await driverClient._query({ __knexUid: 'a' }, { sql: 'select 1' });
		await driverClient._query({ __knexUid: 'b' }, { sql: 'select 1' });
	});

	expect(counts.maxConnections).toBe(1);
});

test('reports two connections for reads running at once', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	})();

	countQueriesOf({ client: driverClient } as unknown as Knex);

	const counts = emptyQueryCounts();

	await queryCountStore.run(counts, () => {
		return Promise.all([
			driverClient._query({ __knexUid: 'a' }, { sql: 'select 1' }),
			driverClient._query({ __knexUid: 'b' }, { sql: 'select 1' }),
		]);
	});

	expect(counts.maxConnections).toBe(2);
});

test('wraps a dialect prototype once, however many pools share it', () => {
	const counts = emptyQueryCounts();

	const DriverClient = class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	};

	const namedPool = new DriverClient();

	countQueriesOf({ client: new DriverClient() } as unknown as Knex);
	countQueriesOf({ client: namedPool } as unknown as Knex);

	queryCountStore.run(counts, () => {
		namedPool._query({ __knexUid: 'a' }, { sql: 'select 1' });
	});

	expect(formatStatementCounts(counts)).toBe(
		'total=1, select=1, insert=0, update=0, delete=0, transaction=0, other=0',
	);
});
