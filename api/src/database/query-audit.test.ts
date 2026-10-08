import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, test, vi } from 'vitest';
import {
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

test('audits a transaction: tables, statements, length and outcome', () => {
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
		{
			ms: 14,
			outcome: 'commit',
			tables: { articles: { select: 2, insert: 1 } },
			statements: [
				{
					sql: 'select "id" from "articles" where "id" = ?',
					count: 2,
					ms: 5,
				},
				{
					sql: 'insert into "articles" ("title") values (?)',
					count: 1,
					ms: 7,
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
			'["select authors",'
			+ '{"ms":0,"outcome":"rollback","tables":{"articles":{"update":1}}},'
			+ '"select authors","set"]',
		);
});

test('reports a statement outside a transaction as its SQL', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select * from "authors"', 'a')();
	auditStatementStart(audit, 'SET search_path TO public', 'a')();

	expect(formatQueryAudit(audit, { level: 'statements', maxSize: 0 }))
		.toBe('["select * from \\"authors\\"","SET search_path TO public"]');
});

test('pairs a statement outside a transaction with its bound values', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('bindings');

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();

	expect(formatQueryAudit(audit, { level: 'bindings', maxSize: 0 }))
		.toBe('[{"select * from \\"a\\" where \\"id\\" = ?":[1]}]');
});

test('times a statement outside a transaction at the full level alone', () => {
	vi.spyOn(performance, 'now')
		.mockReturnValueOnce(0)
		.mockReturnValueOnce(2);

	const audit = emptyQueryAudit('full');

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 0 }))
		.toBe(
			'[{"select * from \\"a\\" where \\"id\\" = ?":'
			+ '{"ms":2,"bindings":[1]}}]',
		);
});

test('steps a statement outside a transaction down a level past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('full');

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [
		'a value long enough to matter',
	])();

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 60 }))
		.toBe('["select * from \\"a\\" where \\"id\\" = ?"]');

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 30 }))
		.toBe('["select a"]');
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

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe(
			'["delete articles","other kept"]',
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
			'[{"outcome":"open","tables":{"articles":{"insert":1}}},'
			+ '{"ms":0,"outcome":"commit","tables":{"authors":{"insert":1}}}]',
		);
});

test('drops the statements of the largest entries first past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "a"', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();
	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "b" where "x" = ?', 'a')();
	auditStatementStart(audit, 'select * from "b" where "y" = ?', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, { level: 'statements', maxSize: 200 }))
		.toBe(
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":1}},'
			+ '"statements":[{"sql":"select * from \\"a\\"","count":1,"ms":0}]},'
			+ '{"ms":0,"outcome":"commit","tables":{"b":{"select":2}},'
			+ '"statementsDropped":2}]',
		);

	expect(formatQueryAudit(audit, { level: 'statements', maxSize: 160 }))
		.toBe(
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":1}},'
			+ '"statementsDropped":1},'
			+ '{"ms":0,"outcome":"commit","tables":{"b":{"select":2}},'
			+ '"statementsDropped":2}]',
		);
});

test('drops the last entries once no entry holds statements', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select * from "a"', 'a')();
	auditStatementStart(audit, 'select * from "b"', 'a')();
	auditStatementStart(audit, 'select * from "c"', 'a')();

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 33 }))
		.toBe('["select a",{"entriesDropped":2}]');

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 10 }))
		.toBe('[{"entriesDropped":3}]');
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

	expect(formatQueryAudit(audit, { level: 'bindings', maxSize: 0 }))
		.toBe(
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":3}},"statements":['
			+ '{"sql":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"count":2,"ms":0,"bindings":[[1],[2]]},'
			+ '{"sql":"select * from \\"a\\"","count":1,"ms":0,"bindings":[[]]}'
			+ ']}]',
		);
});

test('drops bound values before statements past the size', () => {
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

	expect(formatQueryAudit(audit, { level: 'bindings', maxSize: 200 }))
		.toBe(
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":2}},"statements":[{'
			+ '"sql":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"count":2,"ms":0}],"bindingsDropped":2}]',
		);

	expect(formatQueryAudit(audit, { level: 'bindings', maxSize: 100 }))
		.toBe(
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":2}},'
			+ '"bindingsDropped":2,"statementsDropped":1}]',
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

	expect(formatQueryAudit(audit, { level: 'bindings', maxSize: 0 }))
		.toBe(
			'[{"select * from \\"a\\" where \\"n\\" = ?":'
			+ '["9007199254740993"]}]',
		);
});

test('lists every run in order at the full level', () => {
	vi.spyOn(performance, 'now')
		.mockReturnValueOnce(0)
		.mockReturnValueOnce(0)
		.mockReturnValueOnce(1)
		.mockReturnValueOnce(1)
		.mockReturnValueOnce(3)
		.mockReturnValueOnce(3)
		.mockReturnValueOnce(7)
		.mockReturnValueOnce(7)
		.mockReturnValueOnce(8);

	const audit = emptyQueryAudit('full');

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();
	auditStatementStart(audit, 'update "a" set "b" = ?', 'a', [2])();
	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 0 }))
		.toBe(
			'[{"ms":8,"outcome":"commit","tables":{"a":{"select":2,"update":1}},"runs":['
			+ '{"sql":"select * from \\"a\\" where \\"id\\" = ?","ms":1,"bindings":[1]},'
			+ '{"sql":"update \\"a\\" set \\"b\\" = ?","ms":2,"bindings":[2]},'
			+ '{"sql":"select * from \\"a\\" where \\"id\\" = ?","ms":4,"bindings":[1]}'
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

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 260 }))
		.toBe(
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":2}},"statements":[{'
			+ '"sql":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"count":2,"ms":0,"bindings":['
			+ '["a first value long enough to matter"],'
			+ '["a second value long enough to matter"]'
			+ ']}],"runsGrouped":2}]',
		);

	expect(formatQueryAudit(audit, { level: 'full', maxSize: 200 }))
		.toBe(
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":2}},"statements":[{'
			+ '"sql":"select * from \\"a\\" where \\"id\\" = ?",'
			+ '"count":2,"ms":0}],"runsGrouped":2,"bindingsDropped":2}]',
		);
});

test('records no statement at the counts level', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit('counts');

	auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [1])();

	expect(audit.transactionAudits).toEqual([
		{
			startedAt: 0,
			ms: 0,
			loneStatement: {
				sql: 'select * from "a" where "id" = ?',
				summary: 'select a',
			},
			tableCounts: new Map([['a', { select: 1 }]]),
			statementAudits: new Map(),
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

	expect(formatQueryAudit(audit, { level: 'bindings', maxSize: 0 }))
		.toBe(
			'[{"select * from \\"a\\" where \\"id\\" = ?":[1]},'
			+ '{"select * from \\"a\\" where \\"id\\" = ?":[]}]',
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

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe('[{"outcome":"open","tables":{"a":{"select":1}}}]');
});

test('escapes what a header cannot carry', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select *\nfrom "café"', 'a')();

	expect(formatQueryAudit(audit, { level: 'statements', maxSize: 0 }))
		.toBe(
			'["select *\\nfrom \\"caf\\u00e9\\""]',
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

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe('["select authors"]');
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

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe('["select authors"]');
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

	expect(formatQueryAudit(audit, { level: 'counts', maxSize: 0 }))
		.toBe('["select authors"]');
});

test('is enabled by QUERY_AUDIT_HEADER alone', () => {
	vi.mocked(useEnv).mockReturnValue({});

	expect(queryAuditEnabled()).toBe(false);

	vi.mocked(useEnv).mockReturnValue({ QUERY_AUDIT_HEADER: 'X-Query-Audit' });

	expect(queryAuditEnabled()).toBe(true);
});
