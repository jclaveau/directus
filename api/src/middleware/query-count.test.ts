import { useEnv } from '@directus/env';
import type { Request, Response } from 'express';
import { afterEach, expect, test, vi } from 'vitest';
import {
	countStatementStart,
	queryCountStore,
} from '../database/query-count.js';
import countRequestQueries from './query-count.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.restoreAllMocks();
});

test('writes the counts of the request when its headers flush', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_COUNT_HEADER: 'X-Query-Count',
		QUERY_TRANSACTIONS_HEADER: 'X-Query-Transactions',
		QUERY_TABLES_HEADER: 'X-Query-Tables',
	});

	const writeHead = vi.fn();
	const setHeader = vi.fn();
	const res = { writeHead, setHeader } as unknown as Response;

	countRequestQueries({} as Request, res, () => {
		const counts = queryCountStore.getStore()!;

		countStatementStart(counts, 'select * from "articles"', 'a');
		countStatementStart(counts, 'select * from "articles"', 'a');
	});

	res.writeHead(500, { 'Content-Type': 'application/json' });

	expect(setHeader.mock.calls).toEqual([
		[
			'X-Query-Count',
			'total=2, select=2, insert=0, update=0, delete=0, transaction=0, other=0',
		],
		[
			'X-Query-Transactions',
			'count=0, rollback=0, savepoint=0, longest=0ms, maxConnections=1',
		],
		['X-Query-Tables', 'articles=2'],
	]);

	expect(writeHead).toHaveBeenCalledWith(500, {
		'Content-Type': 'application/json',
	});
});

test('writes only the headers an env var names', () => {
	vi.mocked(useEnv).mockReturnValue({
		QUERY_COUNT_HEADER: 'X-Query-Count',
	});

	const setHeader = vi.fn();
	const res = { writeHead: vi.fn(), setHeader } as unknown as Response;

	countRequestQueries({} as Request, res, () => {});

	res.writeHead(200);

	expect(setHeader.mock.calls).toEqual([
		[
			'X-Query-Count',
			'total=0, select=0, insert=0, update=0, delete=0, transaction=0, other=0',
		],
	]);
});
