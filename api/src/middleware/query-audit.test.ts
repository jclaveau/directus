import { useEnv } from '@directus/env';
import type { Request, Response } from 'express';
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
		QUERY_AUDIT_STATEMENTS: true,
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const writeHead = vi.fn();
	const setHeader = vi.fn();
	const res = { writeHead, setHeader } as unknown as Response;

	auditRequestQueries({} as Request, res, () => {
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

test('writes the tables alone without QUERY_AUDIT_STATEMENTS', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_STATEMENTS: false,
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const setHeader = vi.fn();
	const res = { writeHead: vi.fn(), setHeader } as unknown as Response;

	auditRequestQueries({} as Request, res, () => {
		const audit = queryAuditStore.getStore()!;

		auditStatementStart(audit, 'select * from "articles"', 'a')();
	});

	res.writeHead(200);

	expect(setHeader.mock.calls).toEqual([
		['X-Query-Audit', '[{"ms":0,"tables":{"articles":{"select":1}}}]'],
	]);
});

test('writes an empty list for a request that ran no statement', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_STATEMENTS: false,
		QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
	});

	const setHeader = vi.fn();
	const res = { writeHead: vi.fn(), setHeader } as unknown as Response;

	auditRequestQueries({} as Request, res, () => {});

	res.writeHead(200);

	expect(setHeader.mock.calls).toEqual([['X-Query-Audit', '[]']]);
});

test('caps nothing when QUERY_AUDIT_HEADER_MAX_SIZE is unset', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_AUDIT_HEADER: 'X-Query-Audit',
		QUERY_AUDIT_STATEMENTS: true,
	});

	vi.spyOn(performance, 'now').mockReturnValue(0);

	const setHeader = vi.fn();
	const res = { writeHead: vi.fn(), setHeader } as unknown as Response;

	auditRequestQueries({} as Request, res, () => {
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
