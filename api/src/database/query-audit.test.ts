import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, test, vi } from 'vitest';
import {
	auditConnectionWait,
	auditQueriesOf,
	auditStatementStart,
	closeQueryAudit,
	emptyQueryAudit,
	formatQueryAudit,
	queryAuditEnabled,
	queryAuditStore,
} from './query-audit.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.restoreAllMocks();
});

test('audits a transaction: its statements, length and outcome', () => {
	let now = 1000;
	vi.spyOn(performance, 'now').mockImplementation(() => now);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'BEGIN;', 'a')();

	const finishSelect = auditStatementStart(
		audit,
		'select "id" from "articles" where "id" = ?',
		'a',
	);

	now = 1003;
	finishSelect();

	auditStatementStart(audit, 'SAVEPOINT trx2;', 'a')();

	const finishInsert = auditStatementStart(
		audit,
		'insert into "articles" ("title") values (?)',
		'a',
	);

	now = 1010;
	finishInsert();

	auditStatementStart(audit, 'ROLLBACK TO SAVEPOINT trx2', 'a')();

	const finishSecondSelect = auditStatementStart(
		audit,
		'select "id" from "articles" where "id" = ?',
		'a',
	);

	now = 1012;
	finishSecondSelect();

	const finishCommit = auditStatementStart(audit, 'COMMIT;', 'a');

	now = 1014;
	finishCommit();

	expect(JSON.parse(formatQueryAudit(audit, {
		level: 'statements',
		maxSize: 0,
	}))).toEqual([
		{ request: { ms: 14, db: 12, wait: 0, maxConnections: 1 } },
		{
			transaction: 'commit',
			ms: 14,
			wait: 0,
			statements: [
				{
					stmt: 'select "id" from "articles" where "id" = ?',
					count: 2,
					ms: 5,
					wait: 0,
				},
				{
					stmt: 'insert into "articles" ("title") values (?)',
					ms: 7,
					wait: 0,
				},
			],
		},
	]);
});

test('counts a statement outside a transaction as its kind and table', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select * from "authors"', 'a')();
	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'update "articles" set "title" = ?', 'a')();
	auditStatementStart(audit, 'select * from "authors"', 'b')();
	auditStatementStart(audit, 'ROLLBACK', 'a')();
	auditStatementStart(audit, 'SET search_path TO public', 'a')();

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe(
			'[{"request":{"ms":0,"db":0,"wait":0,"maxConnections":2}},'
			+ '{"stmt":"select authors...","ms":0,"wait":0},'
			+ '{"transaction":"rollback","ms":0,"wait":0,'
			+ '"statements":[{"stmt":"update articles...","ms":0,"wait":0}]},'
			+ '{"stmt":"select authors...","ms":0,"wait":0},'
			+ '{"stmt":"set...","ms":0,"wait":0}]',
		);
});

test('counts the statements of a transaction by kind and table', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('counts');

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "a" where "x" = ?', 'a')();
	auditStatementStart(audit, 'insert into "b" ("x") values (?)', 'a')();
	auditStatementStart(audit, 'select * from "a" where "y" = ?', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},{"transaction":"commit","statements":['
		+ '{"stmt":"select a...","count":2},{"stmt":"insert b..."}]}]',
	);
});

test('reports a statement outside a transaction as its SQL', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select * from "authors"', 'a')();
	auditStatementStart(audit, 'SET search_path TO public', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'statements',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},{"stmt":"select * from \\"authors\\""},'
		+ '{"stmt":"SET search_path TO public"}]',
	);
});

test('pairs a statement outside a transaction with its bound values', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('bindings');

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();

	expect(formatQueryAudit(audit, {
		level: 'bindings',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?","bindings":[[1]]}]',
	);
});

test('gives a run outside a transaction its own values at the full level', () => {
	let now = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => now);

	const audit = emptyQueryAudit('full');

	const finishRead = auditStatementStart(
		audit,
		'select * from "a" where "id" = ?',
		'a',
		[1],
	);

	now = 2;
	finishRead();

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 0 }))
		.toBe(
			'[{"request":{"ms":2,"db":2,"wait":0,"maxConnections":1}},'
			+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"ms":2,"wait":0,"bindings":[1]}]',
		);
});

test('cuts a lone statement to its kind and table past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('full');

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [
		'a value long enough to matter',
	])();

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 113, timings: false }))
		.toBe(
			'[{"request":{"maxConnections":1}},'
			+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"bindingsDropped":1}]',
		);

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 98, timings: false }))
		.toBe(
			'[{"request":{"maxConnections":1}},'
			+ '{"stmt":"select a...","bindingsDropped":1,"statementsCut":1}]',
		);
});

test('counts a statement of no other kind as other', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'delete from "articles" where "id" = ?', 'a')();

	auditStatementStart(
		audit,
		'with "kept" as (select 1) select * from "kept"',
		'a',
	)();

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"stmt":"delete articles..."},{"stmt":"other kept..."}]',
	);
});

test('keeps two transactions open at once apart', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'BEGIN;', 'b')();
	auditStatementStart(audit, 'insert into "authors" ("name") values (?)', 'b')();
	auditStatementStart(audit, 'insert into "articles" ("title") values (?)', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'b')();

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe(
			'[{"request":{"ms":0,"db":0,"wait":0,"maxConnections":2}},'
			+ '{"transaction":"open","wait":0,'
			+ '"statements":[{"stmt":"insert articles...","ms":0,"wait":0}]},'
			+ '{"transaction":"commit","ms":0,"wait":0,'
			+ '"statements":[{"stmt":"insert authors...","ms":0,"wait":0}]}]',
		);
});

test('cuts the SQL of the largest entries first past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "a" where "x" = ?', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();
	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "b" where "x" = ?', 'a')();
	auditStatementStart(audit, 'select * from "b" where "y" = ?', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'statements',
		maxSize: 213,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"commit","statements":['
		+ '{"stmt":"select * from \\"a\\" where \\"x\\" = ?"}]},'
		+ '{"transaction":"commit","statements":[{"stmt":"select b...","count":2}],'
		+ '"statementsCut":2}]',
	);

	expect(formatQueryAudit(audit, {
		level: 'statements',
		maxSize: 208,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"commit","statements":[{"stmt":"select a..."}],'
		+ '"statementsCut":1},'
		+ '{"transaction":"commit","statements":[{"stmt":"select b...","count":2}],'
		+ '"statementsCut":2}]',
	);
});

test('drops the last entries once no entry holds more to cut', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select * from "a"', 'a')();
	auditStatementStart(audit, 'select * from "b"', 'a')();
	auditStatementStart(audit, 'select * from "c"', 'a')();

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 83, timings: false }))
		.toBe(
			'[{"request":{"maxConnections":1}},'
			+ '{"stmt":"select a..."},{"entriesDropped":2}]',
		);

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 10, timings: false }))
		.toBe('[{"request":{"maxConnections":1}},{"entriesDropped":3}]');
});

// Dropping one entry's detail used to serialise the whole header again: 2000
// entries took 20 s of the event loop.
test('cuts thousands of entries down to the size in milliseconds', () => {
	const audit = emptyQueryAudit('bindings');

	for (let connectionNumber = 0; connectionNumber < 2000; connectionNumber++) {
		auditStatementStart(
			audit,
			'select * from "a" where "id" = ?',
			`connection ${connectionNumber}`,
			[connectionNumber],
		)();
	}

	const startedAt = Date.now();
	const headerValue = formatQueryAudit(audit, { level: 'bindings', maxSize: 8192 });

	expect({
		within8kb: headerValue.length <= 8192,
		withinOneSecond: Date.now() - startedAt < 1000,
	}).toEqual({ within8kb: true, withinOneSecond: true });

	expect(headerValue).toMatch(/,\{"entriesDropped":\d+\}\]$/);
});

test('reports each run\'s bound values at the bindings level', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('bindings');

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();
	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [2])();
	auditStatementStart(audit, 'select * from "a"', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'bindings',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},{"transaction":"commit","statements":['
		+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
		+ '"count":2,"bindings":[[1],[2]]},'
		+ '{"stmt":"select * from \\"a\\"","bindings":[[]]}'
		+ ']}]',
	);
});

test('drops bound values before cutting the SQL past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('bindings');

	auditStatementStart(audit, 'BEGIN;', 'a')();

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [
		'a first value long enough to matter',
	])();

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [
		'a second value long enough to matter',
	])();

	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'bindings',
		maxSize: 153,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"commit","statements":[{'
		+ '"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
		+ '"count":2}],"bindingsDropped":2}]',
	);

	expect(formatQueryAudit(audit, {
		level: 'bindings',
		maxSize: 148,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"commit","statements":[{"stmt":"select a...","count":2}],'
		+ '"bindingsDropped":2,"statementsCut":1}]',
	);
});

// `search` binds a number past Number.MAX_SAFE_INTEGER as a BigInt, which
// JSON.stringify refuses.
test('reports a BigInt bound value as its digits', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('bindings');

	auditStatementStart(audit, 'select * from "a" where "n" = ?', 'a', [
		9007199254740993n,
	])();

	expect(formatQueryAudit(audit, {
		level: 'bindings',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"stmt":"select * from \\"a\\" where \\"n\\" = ?",'
		+ '"bindings":[["9007199254740993"]]}]',
	);
});

test('lists every run in order at the full level', () => {
	let now = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => now);

	const audit = emptyQueryAudit('full');

	auditStatementStart(audit, 'BEGIN;', 'a')();

	const finishFirstRead = auditStatementStart(
		audit,
		'select * from "a" where "id" = ?',
		'a',
		[1],
	);

	now = 1;
	finishFirstRead();

	const finishUpdate = auditStatementStart(
		audit,
		'update "a" set "b" = ?',
		'a',
		[2],
	);

	now = 3;
	finishUpdate();

	const finishSecondRead = auditStatementStart(
		audit,
		'select * from "a" where "id" = ?',
		'a',
		[1],
	);

	now = 7;
	finishSecondRead();
	const finishCommit = auditStatementStart(audit, 'COMMIT;', 'a');
	now = 8;
	finishCommit();

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 0 }))
		.toBe(
			'[{"request":{"ms":8,"db":7,"wait":0,"maxConnections":1}},'
			+ '{"transaction":"commit","ms":8,"wait":0,"statements":['
			+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"ms":1,"wait":0,"bindings":[1]},'
			+ '{"stmt":"update \\"a\\" set \\"b\\" = ?","ms":2,"wait":0,"bindings":[2]},'
			+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"ms":4,"wait":0,"bindings":[1]}'
			+ ']}]',
		);
});

test('groups the runs before dropping bound values past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('full');

	auditStatementStart(audit, 'BEGIN;', 'a')();

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [
		'a first value long enough to matter',
	])();

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [
		'a second value long enough to matter',
	])();

	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'full',
		maxSize: 253,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"commit","statements":[{'
		+ '"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
		+ '"count":2,"bindings":['
		+ '["a first value long enough to matter"],'
		+ '["a second value long enough to matter"]'
		+ ']}],"runsGrouped":2}]',
	);

	expect(formatQueryAudit(audit, {
		level: 'full',
		maxSize: 183,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"commit","statements":[{'
		+ '"stmt":"select * from \\"a\\" where \\"id\\" = ?",'
		+ '"count":2}],"runsGrouped":2,"bindingsDropped":2}]',
	);
});

test('records no SQL at the counts level', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('counts');

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();

	expect(audit.transactionAudits).toEqual([
		{
			startedAt: 0,
			ms: 0,
			wait: 0,
			outsideTransaction: true,
			statementAudits: new Map([
				[
					'select a...',
					{
						stmt: 'select a...',
						cutStmt: 'select a...',
						count: 1,
						ms: 0,
						wait: 0,
						bindings: [],
					},
				],
			]),
			runAudits: [],
		},
	]);
});

test('records bound values only while they are allowed', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	let bindingsAllowed = true;
	const audit = emptyQueryAudit('bindings', () => bindingsAllowed);

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();
	bindingsAllowed = false;
	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [2])();

	expect(formatQueryAudit(audit, {
		level: 'bindings',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?","bindings":[[1]]},'
		+ '{"stmt":"select * from \\"a\\" where \\"id\\" = ?","bindings":[]}]',
	);
});

// A resource first created during a request runs its callbacks in that
// request's store for as long as it lives.
test('records nothing once closed', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "a"', 'a')();
	closeQueryAudit(audit);
	auditStatementStart(audit, 'select * from "b"', 'b')();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"open","statements":[{"stmt":"select a..."}]}]',
	);
});

test('escapes what a header cannot carry', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select *\nfrom "café"', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'statements',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"stmt":"select *\\nfrom \\"caf\\u00e9\\""}]',
	);
});

test('audits every statement sent through the driver', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve('driver result');
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit();

	const result = await queryAuditStore.run(audit, () => {
		return driverClient._query({ __knexUid: 'a' }, {
			sql: 'select * from "authors"',
		});
	});

	expect(result).toBe('driver result');

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe('[{"request":{"maxConnections":1}},{"stmt":"select authors..."}]');
});

test('leaves a statement sent outside any request unaudited', async () => {
	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve('driver result');
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const result = await driverClient._query(
		{ __knexUid: 'a' },
		{ sql: 'select 1' },
	);

	expect(result).toBe('driver result');
});

test('audits a statement streamed through the driver', async () => {
	const driverClient = new (class {
		_query() {
			return Promise.resolve();
		}

		_stream(
			_connection: object,
			_queryObject: object,
			readStream: string,
			streamOptions: object,
		) {
			return Promise.resolve([readStream, streamOptions]);
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit();

	const result = await queryAuditStore.run(audit, () => {
		return driverClient._stream(
			{ __knexUid: 'a' },
			{ sql: 'select * from "authors"' },
			'the stream',
			{ highWaterMark: 1 },
		);
	});

	expect(result).toEqual(['the stream', { highWaterMark: 1 }]);

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe('[{"request":{"maxConnections":1}},{"stmt":"select authors..."}]');
});

test('wraps a dialect prototype once, however many pools share it', () => {
	const audit = emptyQueryAudit();

	const DriverClient = class {
		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	};

	const namedPool = new DriverClient();

	auditQueriesOf({ client: new DriverClient() } as unknown as Knex);
	auditQueriesOf({ client: namedPool } as unknown as Knex);

	queryAuditStore.run(audit, () => {
		namedPool._query({ __knexUid: 'a' }, { sql: 'select * from "authors"' });
	});

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe('[{"request":{"maxConnections":1}},{"stmt":"select authors..."}]');
});

test('reports how long a statement waited for its pool connection', async () => {
	let now = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => now);

	let handConnectionOut: (connection: { __knexUid: string }) => void = () => {};

	const driverClient = new (class {
		acquireConnection() {
			return new Promise<{ __knexUid: string }>((resolve) => {
				handConnectionOut = resolve;
			});
		}

		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit();

	await queryAuditStore.run(audit, async () => {
		const pendingConnection = driverClient.acquireConnection();

		now = 40;
		handConnectionOut({ __knexUid: 'a' });

		await driverClient._query(await pendingConnection, {
			sql: 'select * from "authors"',
		});
	});

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe(
			'[{"request":{"ms":40,"db":0,"wait":40,"maxConnections":1}},'
			+ '{"stmt":"select authors...","ms":0,"wait":40}]',
		);
});

test('counts the wait for a connection the pool never handed out', async () => {
	let now = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => now);

	let refuseConnection: (poolError: Error) => void = () => {};

	const driverClient = new (class {
		acquireConnection() {
			return new Promise<object>((_resolve, reject) => {
				refuseConnection = reject;
			});
		}

		_query(_connection: object, _queryObject: object) {
			return Promise.resolve();
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit();

	const acquireResult = queryAuditStore.run(audit, () => {
		const pendingConnection = driverClient.acquireConnection();

		now = 30;
		refuseConnection(new Error('pool exhausted'));

		return pendingConnection;
	});

	await expect(acquireResult).rejects.toThrow('pool exhausted');

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe('[{"request":{"ms":30,"db":0,"wait":30,"maxConnections":0}}]');
});

test('gives a transaction the wait of its BEGIN, its statements none', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditConnectionWait(audit, 'a', 5);
	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "a"', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe(
			'[{"request":{"ms":0,"db":0,"wait":5,"maxConnections":1}},'
			+ '{"transaction":"commit","ms":0,"wait":5,'
			+ '"statements":[{"stmt":"select a...","ms":0,"wait":0}]}]',
		);
});

test('sums the rows of grouped runs, each run its own at full', async () => {
	const driverClient = new (class {
		_query(
			_connection: object,
			queryObject: { sql: string; bindings: number[]; response?: object },
		) {
			queryObject.response = { rowCount: queryObject.bindings[0] };

			return Promise.resolve(queryObject);
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit('full');

	await queryAuditStore.run(audit, async () => {
		await driverClient._query({ __knexUid: 'a' }, { sql: 'BEGIN;', bindings: [] });

		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'update "a" set "b" = ?',
			bindings: [2],
		});

		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'update "a" set "b" = ?',
			bindings: [3],
		});

		await driverClient._query({ __knexUid: 'a' }, { sql: 'COMMIT;', bindings: [] });
	});

	expect(formatQueryAudit(audit, {
		level: 'statements',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},{"transaction":"commit","statements":['
		+ '{"stmt":"update \\"a\\" set \\"b\\" = ?","count":2,"rows":5}]}]',
	);

	expect(formatQueryAudit(audit, {
		level: 'full',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},{"transaction":"commit","statements":['
		+ '{"stmt":"update \\"a\\" set \\"b\\" = ?","rows":2,"bindings":[2]},'
		+ '{"stmt":"update \\"a\\" set \\"b\\" = ?","rows":3,"bindings":[3]}]}]',
	);
});

test('sums rows and keeps the first error of statements a cut merges', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('statements');

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'update "a" set "b" = 1', 'a')({ rows: 2 });
	auditStatementStart(audit, 'update "a" set "c" = 1', 'a')({ rows: 3 });
	auditStatementStart(audit, 'update "a" set "d" = 1', 'a')({ error: '23505' });
	auditStatementStart(audit, 'update "a" set "e" = 1', 'a')({ error: '23503' });
	auditStatementStart(audit, 'ROLLBACK', 'a')();

	expect(formatQueryAudit(audit, {
		level: 'statements',
		maxSize: 200,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},{"transaction":"rollback","statements":['
		+ '{"stmt":"update a...","count":4,"rows":5,"error":"23505"}],'
		+ '"statementsCut":4}]',
	);
});

test('leaves out the rows of a statement pg counts none for', async () => {
	const driverClient = new (class {
		_query(
			_connection: object,
			queryObject: { sql: string; response?: object },
		) {
			queryObject.response = { rowCount: null };

			return Promise.resolve(queryObject);
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit('counts');

	await queryAuditStore.run(audit, async () => {
		await driverClient._query({ __knexUid: 'a' }, { sql: 'SET search_path' });
	});

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0, timings: false }))
		.toBe('[{"request":{"maxConnections":1}},{"stmt":"set..."}]');
});

test('reads the rows sqlite3 returned or changed', async () => {
	const driverClient = new (class {
		dialect = 'sqlite3';

		_query(
			_connection: object,
			queryObject: { sql: string; response?: unknown; context?: unknown },
		) {
			return Promise.resolve(queryObject);
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit();

	await queryAuditStore.run(audit, async () => {
		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'select * from "a"',
			response: [{ id: 1 }, { id: 2 }],
		});

		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'delete from "b"',
			context: { changes: 4 },
		});

		await driverClient._query({ __knexUid: 'a' }, { sql: 'PRAGMA foreign_keys' });
	});

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"stmt":"select a...","rows":2},{"stmt":"delete b...","rows":4},'
		+ '{"stmt":"pragma..."}]',
	);
});

test('reads the rows mysql returned or changed', async () => {
	const driverClient = new (class {
		dialect = 'mysql';

		_query(
			_connection: object,
			queryObject: { sql: string; response?: unknown },
		) {
			return Promise.resolve(queryObject);
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit();

	await queryAuditStore.run(audit, async () => {
		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'select * from `a`',
			response: [[{ id: 1 }], []],
		});

		await driverClient._query({ __knexUid: 'a' }, {
			sql: 'delete from `b`',
			response: [{ affectedRows: 6 }, undefined],
		});

		await driverClient._query({ __knexUid: 'a' }, { sql: 'select * from `c`' });
	});

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"stmt":"select a...","rows":1},{"stmt":"delete b...","rows":6},'
		+ '{"stmt":"select c..."}]',
	);
});

test('reports a failed statement\'s code and the rollback after it', async () => {
	let driverError: unknown;

	const driverClient = new (class {
		_query(_connection: object, _queryObject: object) {
			return driverError === undefined
				? Promise.resolve()
				: Promise.reject(driverError);
		}
	})();

	auditQueriesOf({ client: driverClient } as unknown as Knex);

	const audit = emptyQueryAudit();
	const insertStatement = { sql: 'insert into "a" ("b") values (?)' };

	await queryAuditStore.run(audit, async () => {
		await driverClient._query({ __knexUid: 'a' }, { sql: 'BEGIN;' });
		driverError = { code: '23505' };

		await expect(driverClient._query({ __knexUid: 'a' }, insertStatement))
			.rejects.toBe(driverError);

		driverError = { code: '23503' };

		await expect(driverClient._query({ __knexUid: 'a' }, insertStatement))
			.rejects.toBe(driverError);

		driverError = undefined;
		await driverClient._query({ __knexUid: 'a' }, { sql: 'ROLLBACK' });
		driverError = { code: 1062 };

		await expect(driverClient._query({ __knexUid: 'b' }, {
			sql: 'select * from "c"',
		})).rejects.toBe(driverError);

		driverError = new Error('connection reset');

		await expect(driverClient._query({ __knexUid: 'b' }, {
			sql: 'select * from "d"',
		})).rejects.toBe(driverError);
	});

	expect(formatQueryAudit(audit, {
		level: 'counts',
		maxSize: 0,
		timings: false,
	})).toBe(
		'[{"request":{"maxConnections":1}},'
		+ '{"transaction":"rollback",'
		+ '"statements":[{"stmt":"insert a...","count":2,"error":"23505"}]},'
		+ '{"stmt":"select c...","error":"1062"},'
		+ '{"stmt":"select d...","error":"unknown"}]',
	);
});

test('keeps the rows and the error of an item past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('full');

	auditStatementStart(audit, 'update "a" set "b" = ?', 'a', [
		'a value long enough to matter',
	])({ rows: 3 });

	auditStatementStart(audit, 'insert into "c" ("d") values (?)', 'a', [
		'another value long enough to matter',
	])({ error: '23505' });

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 0, timings: false }))
		.toBe(
			'[{"request":{"maxConnections":1}},'
			+ '{"stmt":"update \\"a\\" set \\"b\\" = ?","rows":3,'
			+ '"bindings":["a value long enough to matter"]},'
			+ '{"stmt":"insert into \\"c\\" (\\"d\\") values (?)","error":"23505",'
			+ '"bindings":["another value long enough to matter"]}]',
		);

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 184, timings: false }))
		.toBe(
			'[{"request":{"maxConnections":1}},'
			+ '{"stmt":"update \\"a\\" set \\"b\\" = ?","rows":3,"bindingsDropped":1},'
			+ '{"stmt":"insert c...","error":"23505",'
			+ '"bindingsDropped":1,"statementsCut":1}]',
		);

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 177, timings: false }))
		.toBe(
			'[{"request":{"maxConnections":1}},'
			+ '{"stmt":"update a...","rows":3,"bindingsDropped":1,"statementsCut":1},'
			+ '{"entriesDropped":1}]',
		);
});

test('is enabled by QUERY_AUDIT_HEADER alone', () => {
	vi.mocked(useEnv).mockReturnValue({});

	expect(queryAuditEnabled()).toBe(false);

	vi.mocked(useEnv).mockReturnValue({ QUERY_AUDIT_HEADER: 'X-Query-Audit' });

	expect(queryAuditEnabled()).toBe(true);
});
