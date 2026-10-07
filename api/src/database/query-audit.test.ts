import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, test, vi } from 'vitest';
import {
	auditQueriesOf,
	auditStatementStart,
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
		withStatements: true,
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

test('reports a statement outside a transaction as one of its own', () => {
	let now = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => now);

	const audit = emptyQueryAudit();

	const finishRead = auditStatementStart(audit, 'select * from "authors"', 'a');

	now = 2;
	finishRead();

	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'update "articles" set "title" = ?', 'a')();
	auditStatementStart(audit, 'select * from "authors"', 'b')();
	auditStatementStart(audit, 'ROLLBACK', 'a')();
	auditStatementStart(audit, 'SET search_path TO public', 'a')();

	expect(formatQueryAudit(audit, { withStatements: false, maxSize: 0 }))
		.toBe(
			'[{"ms":2,"tables":{"authors":{"select":1}}},'
			+ '{"ms":0,"outcome":"rollback","tables":{"articles":{"update":1}}},'
			+ '{"ms":0,"tables":{"authors":{"select":1}}},'
			+ '{"ms":0,"tables":{}}]',
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

	expect(formatQueryAudit(audit, { withStatements: false, maxSize: 0 }))
		.toBe(
			'[{"ms":0,"tables":{"articles":{"delete":1}}},'
			+ '{"ms":0,"tables":{"kept":{"other":1}}}]',
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

	expect(formatQueryAudit(audit, { withStatements: false, maxSize: 0 }))
		.toBe(
			'[{"tables":{"articles":{"insert":1}}},'
			+ '{"ms":0,"outcome":"commit","tables":{"authors":{"insert":1}}}]',
		);
});

test('drops the statements of the largest entries first past the size', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select * from "a"', 'a')();
	auditStatementStart(audit, 'BEGIN;', 'a')();
	auditStatementStart(audit, 'select * from "b" where "x" = ?', 'a')();
	auditStatementStart(audit, 'select * from "b" where "y" = ?', 'a')();
	auditStatementStart(audit, 'COMMIT;', 'a')();

	expect(formatQueryAudit(audit, { withStatements: true, maxSize: 180 }))
		.toBe(
			'[{"ms":0,"tables":{"a":{"select":1}},'
			+ '"statements":[{"sql":"select * from \\"a\\"","count":1,"ms":0}]},'
			+ '{"ms":0,"outcome":"commit","tables":{"b":{"select":2}},'
			+ '"statementsDropped":2}]',
		);

	expect(formatQueryAudit(audit, { withStatements: true, maxSize: 10 }))
		.toBe(
			'[{"ms":0,"tables":{"a":{"select":1}},"statementsDropped":1},'
			+ '{"ms":0,"outcome":"commit","tables":{"b":{"select":2}},'
			+ '"statementsDropped":2}]',
		);
});

test('escapes what a header cannot carry', () => {
	vi.spyOn(performance, 'now').mockReturnValue(0);

	const audit = emptyQueryAudit();

	auditStatementStart(audit, 'select *\nfrom "café"', 'a')();

	expect(formatQueryAudit(audit, { withStatements: true, maxSize: 0 }))
		.toBe(
			'[{"ms":0,"tables":{"caf\\u00e9":{"select":1}},'
			+ '"statements":[{"sql":"select *\\nfrom \\"caf\\u00e9\\"",'
			+ '"count":1,"ms":0}]}]',
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

	expect(formatQueryAudit(audit, { withStatements: false, maxSize: 0 }))
		.toMatch(/^\[\{"ms":\d+,"tables":\{"authors":\{"select":1\}\}\}\]$/);
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

	expect(formatQueryAudit(audit, { withStatements: false, maxSize: 0 }))
		.toBe('[{"tables":{"authors":{"select":1}}}]');
});

test('is enabled by QUERY_AUDIT_HEADER alone', () => {
	vi.mocked(useEnv).mockReturnValue({});

	expect(queryAuditEnabled()).toBe(false);

	vi.mocked(useEnv).mockReturnValue({ QUERY_AUDIT_HEADER: 'X-Query-Audit' });

	expect(queryAuditEnabled()).toBe(true);
});
