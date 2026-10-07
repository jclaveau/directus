import { useEnv } from '@directus/env';
import type { RequestHandler, Response } from 'express';
import {
	emptyQueryCounts,
	formatStatementCounts,
	formatTableCounts,
	formatTransactionCounts,
	queryCountStore,
	type QueryCounts,
} from '../database/query-count.js';

/**
 * Dev-only: QUERY_COUNT_HEADER / QUERY_TRANSACTIONS_HEADER / QUERY_TABLES_HEADER
 * name the headers reporting the SQL this request ran. They are written when
 * the headers flush rather than in `respond`, so an error response and a route
 * that bypasses `respond` carry them too.
 */
const countRequestQueries: RequestHandler = (_req, res, next) => {
	const counts = emptyQueryCounts();
	const writeHead = res.writeHead;

	res.writeHead = function (this: Response, ...headArguments: any[]) {
		setQueryCountHeaders(this, counts);

		return writeHead.apply(this, headArguments as any);
	} as Response['writeHead'];

	queryCountStore.run(counts, next);
};

export default countRequestQueries;

function setQueryCountHeaders(res: Response, counts: QueryCounts): void {
	const env = useEnv();

	if (env['QUERY_COUNT_HEADER']) {
		res.setHeader(
			`${env['QUERY_COUNT_HEADER']}`,
			formatStatementCounts(counts),
		);
	}

	if (env['QUERY_TRANSACTIONS_HEADER']) {
		res.setHeader(
			`${env['QUERY_TRANSACTIONS_HEADER']}`,
			formatTransactionCounts(counts),
		);
	}

	if (env['QUERY_TABLES_HEADER']) {
		res.setHeader(
			`${env['QUERY_TABLES_HEADER']}`,
			formatTableCounts(counts),
		);
	}
}
