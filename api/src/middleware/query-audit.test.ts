import { useEnv } from '@directus/env';
import { InvalidQueryError } from '@directus/errors';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, test, vi } from 'vitest';
import {
	auditStatementStart,
	queryAuditStore,
} from '../database/query-audit.js';
import auditRequestQueries from './query-audit.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.restoreAllMocks();
});

test('writes the audit of the request when its headers flush', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const writeHead = vi.fn();
	const setHeader = vi.fn();

	const res = Object.assign(new EventEmitter(), {
		writeHead,
		setHeader,
	}) as unknown as Response;

	const req = { get: vi.fn() } as unknown as Request;

	auditRequestQueries(req, res, () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select * from "articles"', 'a')();
	});

	res.writeHead(500, { 'Content-Type': 'application/json' });

	expect(setHeader.mock.calls).toEqual([
		[
			'X-Query-Audit',
			'[{"ms":0,"tables":{"articles":{"select":1}},'
			+ '"statements":[{"sql":"select * from \\"articles\\"",'
			+ '"count":1,"ms":0}]}]',
		],
	]);

	expect(writeHead).toHaveBeenCalledWith(500, {
		'Content-Type': 'application/json',
	});
});

test('takes the level the request sends over QUERY_AUDIT_LEVEL', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const setHeader = vi.fn();

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader,
	}) as unknown as Response;

	const req = { get: vi.fn().mockReturnValue('counts') } as unknown as Request;

	auditRequestQueries(req, res, () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select * from "articles"', 'a')();
	});

	res.writeHead(200);

	expect(req.get).toHaveBeenCalledWith('X-Query-Audit');

	expect(setHeader.mock.calls).toEqual([
		['X-Query-Audit', '[{"ms":0,"tables":{"articles":{"select":1}}}]'],
	]);
});

test('reports the bound values to an admin asking bindings', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const setHeader = vi.fn();

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader,
	}) as unknown as Response;

	const req = {
		get: vi.fn().mockReturnValue('bindings'),
		accountability: { admin: true },
	} as unknown as Request;

	auditRequestQueries(req, res, () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select * from "articles" where "id" = ?', 'a', [
			7,
		])();
	});

	res.writeHead(200);

	expect(setHeader.mock.calls).toEqual([
		[
			'X-Query-Audit',
			'[{"ms":0,"tables":{"articles":{"select":1}},'
			+ '"statements":[{"sql":"select * from \\"articles\\" where \\"id\\" = ?",'
			+ '"count":1,"ms":0,"bindings":[[7]]}]}]',
		],
	]);
});

test('lists every run in order to an admin asking full', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const setHeader = vi.fn();

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader,
	}) as unknown as Response;

	const req = {
		get: vi.fn().mockReturnValue('full'),
		accountability: { admin: true },
	} as unknown as Request;

	auditRequestQueries(req, res, () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'BEGIN;', 'a')();
		auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [7])();
		auditStatementStart(audit, 'update "a" set "b" = ?', 'a', [8])();
		auditStatementStart(audit, 'select * from "a" where "id" = ?', 'a', [7])();
		auditStatementStart(audit, 'COMMIT;', 'a')();
	});

	res.writeHead(200);

	expect(setHeader.mock.calls).toEqual([
		[
			'X-Query-Audit',
			'[{"ms":0,"outcome":"commit","tables":{"a":{"select":2,"update":1}},'
			+ '"runs":['
			+ '{"sql":"select * from \\"a\\" where \\"id\\" = ?","ms":0,"bindings":[7]},'
			+ '{"sql":"update \\"a\\" set \\"b\\" = ?","ms":0,"bindings":[8]},'
			+ '{"sql":"select * from \\"a\\" where \\"id\\" = ?","ms":0,"bindings":[7]}'
			+ ']}]',
		],
	]);
});

test.each(['bindings', 'full'])(
	'withholds the bound values from anyone else asking %s',
	(requestedLevel) => {
		vi.mocked(useEnv).mockReturnValue({
			QUERY_AUDIT_HEADER: 'X-Query-Audit',
			QUERY_AUDIT_LEVEL: 'counts',
			QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
		});

		vi.spyOn(performance, 'now').mockReturnValue(0);

		const setHeader = vi.fn();

		const res = Object.assign(new EventEmitter(), {
			writeHead: vi.fn(),
			setHeader,
		}) as unknown as Response;

		const req = {
			get: vi.fn().mockReturnValue(requestedLevel),
			accountability: { admin: false },
		} as unknown as Request;

		auditRequestQueries(req, res, () => {
			const audit = queryAuditStore.getStore()!;

			auditStatementStart(audit, 'select * from "articles" where "id" = ?', 'a', [
				7,
			])();
		});

		res.writeHead(200);

		expect(setHeader.mock.calls).toEqual([
			[
				'X-Query-Audit',
				'[{"ms":0,"tables":{"articles":{"select":1}},'
				+ '"statements":[{"sql":"select * from \\"articles\\" where \\"id\\" = ?",'
				+ '"count":1,"ms":0}]}]',
			],
		]);
	},
);

test('refuses a level outside the list', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
	});

	const writeHead = vi.fn();

	const res = Object.assign(new EventEmitter(), {
		writeHead,
		setHeader: vi.fn(),
	}) as unknown as Response;

	const req = { get: vi.fn().mockReturnValue('every') } as unknown as Request;
	const next = vi.fn();

	auditRequestQueries(req, res, next);

	expect(next).toHaveBeenCalledWith(new InvalidQueryError({
		reason: '"X-Query-Audit" must be one of counts, statements, bindings, full',
	}));

	expect(res.writeHead).toBe(writeHead);
});

test('writes an empty list for a request that ran no statement', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const setHeader = vi.fn();

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader,
	}) as unknown as Response;

	const req = { get: vi.fn() } as unknown as Request;

	auditRequestQueries(req, res, () => {});

	res.writeHead(200);

	expect(setHeader.mock.calls).toEqual([['X-Query-Audit', '[]']]);
});

test('caps nothing when QUERY_AUDIT_HEADER_MAX_SIZE is unset', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'statements',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const setHeader = vi.fn();

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader,
	}) as unknown as Response;

	const req = { get: vi.fn() } as unknown as Request;

	auditRequestQueries(req, res, () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select * from "articles"', 'a')();
	});

	res.writeHead(200);

	expect(setHeader.mock.calls).toEqual([
		[
			'X-Query-Audit',
			'[{"ms":0,"tables":{"articles":{"select":1}},'
			+ '"statements":[{"sql":"select * from \\"articles\\"",'
			+ '"count":1,"ms":0}]}]',
		],
	]);
});

// A connection pool first filled during the request runs its callbacks in the
// request's store long after the response left.
test('records nothing once the headers flushed', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader: vi.fn(),
	}) as unknown as Response;

	const req = { get: vi.fn() } as unknown as Request;
	let requestAudit = queryAuditStore.getStore();

	auditRequestQueries(req, res, () => {
		requestAudit = queryAuditStore.getStore();
	});

	res.writeHead(200);
	auditStatementStart(requestAudit!, 'select * from "articles"', 'a')();

	expect(requestAudit!.transactionAudits).toEqual([]);
});

test('records nothing once the connection closed', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader: vi.fn(),
	}) as unknown as Response;

	const req = { get: vi.fn() } as unknown as Request;
	let requestAudit = queryAuditStore.getStore();

	auditRequestQueries(req, res, () => {
		requestAudit = queryAuditStore.getStore();
	});

	res.emit('close');
	auditStatementStart(requestAudit!, 'select * from "articles"', 'a')();

	expect(requestAudit!.transactionAudits).toEqual([]);
});

test('records no bound value once anyone else authenticated', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_LEVEL: 'counts',
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const res = Object.assign(new EventEmitter(), {
		writeHead: vi.fn(),
		setHeader: vi.fn(),
	}) as unknown as Response;

	const req = { get: vi.fn().mockReturnValue('full') } as unknown as Request;
	let requestAudit = queryAuditStore.getStore();

	auditRequestQueries(req, res, () => {
		requestAudit = queryAuditStore.getStore();
	});

	req.accountability = { admin: false } as NonNullable<Request['accountability']>;

	auditStatementStart(
		requestAudit!,
		'select * from "articles" where "id" = ?',
		'a',
		[7],
	)();

	expect(requestAudit!.transactionAudits).toEqual([
		{
			startedAt: 0,
			ms: 0,
			tableCounts: new Map([['articles', { select: 1 }]]),
			statementAudits: new Map([
				[
					'select * from "articles" where "id" = ?',
					{ count: 1, ms: 0, bindings: [] },
				],
			]),
			runAudits: [{ sql: 'select * from "articles" where "id" = ?', ms: 0 }],
		},
	]);
});
