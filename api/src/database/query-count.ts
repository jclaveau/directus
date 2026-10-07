import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

type StatementKind =
	| 'select'
	| 'insert'
	| 'update'
	| 'delete'
	| 'transaction'
	| 'other';

export type QueryCounts = {
	statementCounts: Record<StatementKind, number>;
	tableCounts: Map<string, number>;
	transactionCount: number;
	rollbackCount: number;
	savepointCount: number;
	longestTransactionMs: number;
	transactionStarts: Map<string, number>;
	connectionHolds: Map<string, number>;
	maxConnections: number;
};

type DriverConnection = { __knexUid: string };

type DriverQuery = (
	this: unknown,
	connection: DriverConnection,
	queryObject: { sql: string },
) => Promise<unknown>;

export const queryCountStore = new AsyncLocalStorage<QueryCounts>();

const TRANSACTION_KEYWORDS = new Set([
	'begin',
	'start',
	'commit',
	'rollback',
	'savepoint',
	'release',
]);

const TABLE_PATTERN = /\b(?:from|into|update)\s+["`[]?([^\s"`\]().,;]+)/i;

const countedPrototypes = new WeakSet<object>();

export function queryCountEnabled(): boolean {
	const env = useEnv();

	return Boolean(
		env['QUERY_COUNT_HEADER']
		|| env['QUERY_TRANSACTIONS_HEADER']
		|| env['QUERY_TABLES_HEADER'],
	);
}

export function emptyQueryCounts(): QueryCounts {
	return {
		statementCounts: {
			select: 0,
			insert: 0,
			update: 0,
			delete: 0,
			transaction: 0,
			other: 0,
		},
		tableCounts: new Map(),
		transactionCount: 0,
		rollbackCount: 0,
		savepointCount: 0,
		longestTransactionMs: 0,
		transactionStarts: new Map(),
		connectionHolds: new Map(),
		maxConnections: 0,
	};
}

/**
 * Count every statement the request in `queryCountStore` sends through this
 * knex instance's dialect. The driver call is the one seam every statement
 * crosses: knex's `query` event never fires for a transaction's own
 * `BEGIN` / `COMMIT` / `SAVEPOINT`, and the transaction client is built off the
 * dialect's prototype, not off this instance.
 */
export function countQueriesOf(database: Knex): void {
	const clientPrototype = Object.getPrototypeOf(database.client);

	if (countedPrototypes.has(clientPrototype)) {
return;
}

	countedPrototypes.add(clientPrototype);

	const runDriverQuery: DriverQuery = clientPrototype._query;

	clientPrototype._query = function (
		this: unknown,
		connection: DriverConnection,
		queryObject: { sql: string },
	) {
		const counts = queryCountStore.getStore();

		if (!counts) {
return runDriverQuery.call(this, connection, queryObject);
}

		const connectionId = connection.__knexUid;

		countStatementStart(counts, queryObject.sql, connectionId);

		return runDriverQuery
			.call(this, connection, queryObject)
			.finally(() => {
				countStatementEnd(counts, queryObject.sql, connectionId);
			});
	};
}

export function countStatementStart(
	counts: QueryCounts,
	sql: string,
	connectionId: string,
): void {
	const keyword = leadingKeyword(sql);
	const statementKind = kindOfKeyword(keyword);

	counts.statementCounts[statementKind]++;

	const tableName = statementKind === 'transaction'
		? undefined
		: TABLE_PATTERN.exec(sql)?.[1];

	if (tableName) {
		counts.tableCounts.set(
			tableName,
			(counts.tableCounts.get(tableName) ?? 0) + 1,
		);
	}

	holdConnection(counts, connectionId);

	if (keyword === 'begin' || keyword === 'start') {
		counts.transactionCount++;
		counts.transactionStarts.set(connectionId, performance.now());
		holdConnection(counts, connectionId);
	}

	if (keyword === 'savepoint') {
counts.savepointCount++;
}

	if (keyword === 'rollback' && !isSavepointRollback(sql)) {
		counts.rollbackCount++;
	}
}

export function countStatementEnd(
	counts: QueryCounts,
	sql: string,
	connectionId: string,
): void {
	releaseConnection(counts, connectionId);

	const keyword = leadingKeyword(sql);

	const endsTransaction = keyword === 'commit'
		|| (keyword === 'rollback' && !isSavepointRollback(sql));

	const startedAt = counts.transactionStarts.get(connectionId);

	if (!endsTransaction || startedAt === undefined) {
return;
}

	counts.longestTransactionMs = Math.max(
		counts.longestTransactionMs,
		performance.now() - startedAt,
	);

	counts.transactionStarts.delete(connectionId);
	releaseConnection(counts, connectionId);
}

export function formatStatementCounts(counts: QueryCounts): string {
	const statementCounts = counts.statementCounts;

	const totalCount = Object.values(statementCounts)
		.reduce((sum, count) => sum + count, 0);

	return [
		`total=${totalCount}`,
		...Object.entries(statementCounts)
			.map(([statementKind, count]) => `${statementKind}=${count}`),
	].join(', ');
}

export function formatTransactionCounts(counts: QueryCounts): string {
	return [
		`count=${counts.transactionCount}`,
		`rollback=${counts.rollbackCount}`,
		`savepoint=${counts.savepointCount}`,
		`longest=${Math.round(counts.longestTransactionMs)}ms`,
		`maxConnections=${counts.maxConnections}`,
	].join(', ');
}

export function formatTableCounts(counts: QueryCounts): string {
	return [...counts.tableCounts]
		.sort(([leftName, leftCount], [rightName, rightCount]) =>
			rightCount - leftCount || leftName.localeCompare(rightName))
		.map(([tableName, count]) => `${tableName}=${count}`)
		.join(', ');
}

function leadingKeyword(sql: string): string {
	return /^[\s(]*([a-z]+)/i.exec(sql)?.[1]?.toLowerCase() ?? '';
}

function kindOfKeyword(keyword: string): StatementKind {
	if (TRANSACTION_KEYWORDS.has(keyword)) {
return 'transaction';
}

	if (
		keyword === 'select'
		|| keyword === 'insert'
		|| keyword === 'update'
		|| keyword === 'delete'
	) {
		return keyword;
	}

	return 'other';
}

function isSavepointRollback(sql: string): boolean {
	return /^\s*rollback\s+to\b/i.test(sql);
}

// A connection is held while a statement runs on it, and from its `BEGIN`
// until its `COMMIT` / `ROLLBACK` returns.
function holdConnection(counts: QueryCounts, connectionId: string): void {
	const connectionHolds = counts.connectionHolds;

	connectionHolds.set(
		connectionId,
		(connectionHolds.get(connectionId) ?? 0) + 1,
	);

	counts.maxConnections = Math.max(
		counts.maxConnections,
		connectionHolds.size,
	);
}

function releaseConnection(counts: QueryCounts, connectionId: string): void {
	const holdCount = (counts.connectionHolds.get(connectionId) ?? 0) - 1;

	if (holdCount > 0) {
		counts.connectionHolds.set(connectionId, holdCount);
	}
	else {
		counts.connectionHolds.delete(connectionId);
	}
}
