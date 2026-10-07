import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

type StatementKind = 'select' | 'insert' | 'update' | 'delete' | 'other';

type KindCounts = Partial<Record<StatementKind, number>>;

type TransactionOutcome = 'commit' | 'rollback';

type StatementAudit = { count: number; ms: number };

type TransactionAudit = {
	startedAt: number;
	ms?: number;
	outcome?: TransactionOutcome;
	tableCounts: Map<string, KindCounts>;
	statementAudits: Map<string, StatementAudit>;
};

export type QueryAudit = {
	transactionAudits: TransactionAudit[];
	openTransactionAudits: Map<string, TransactionAudit>;
};

export type QueryAuditFormat = {
	withStatements: boolean;
	maxSize: number;
};

type TransactionEntry = {
	ms?: number | undefined;
	outcome?: TransactionOutcome | undefined;
	tables: Record<string, KindCounts>;
	statements?: { sql: string; count: number; ms: number }[];
	statementsDropped?: number;
};

type DriverConnection = { __knexUid: string };

type DriverQuery = (
	this: unknown,
	connection: DriverConnection,
	queryObject: { sql: string },
) => Promise<unknown>;

export const queryAuditStore = new AsyncLocalStorage<QueryAudit>();

const TRANSACTION_KEYWORDS = new Set([
	'begin',
	'start',
	'commit',
	'rollback',
	'savepoint',
	'release',
]);

const TABLE_PATTERN = /\b(?:from|into|update)\s+["`[]?([^\s"`\]().,;]+)/i;

const auditedPrototypes = new WeakSet<object>();

export function queryAuditEnabled(): boolean {
	return Boolean(useEnv()['QUERY_AUDIT_HEADER']);
}

export function emptyQueryAudit(): QueryAudit {
	return {
		transactionAudits: [],
		openTransactionAudits: new Map(),
	};
}

/**
 * Audit every statement the request in `queryAuditStore` sends through this
 * knex instance's dialect. The driver call is the one seam every statement
 * crosses: knex's `query` event never fires for a transaction's own
 * `BEGIN` / `COMMIT` / `SAVEPOINT`, and the transaction client is built off the
 * dialect's prototype, not off this instance. The SQL is the text the driver
 * receives, placeholders in place of the bound values.
 */
export function auditQueriesOf(database: Knex): void {
	const clientPrototype = Object.getPrototypeOf(database.client);

	if (auditedPrototypes.has(clientPrototype)) {
		return;
	}

	auditedPrototypes.add(clientPrototype);

	const runDriverQuery: DriverQuery = clientPrototype._query;

	clientPrototype._query = function (
		this: unknown,
		connection: DriverConnection,
		queryObject: { sql: string },
	) {
		const audit = queryAuditStore.getStore();

		if (!audit) {
			return runDriverQuery.call(this, connection, queryObject);
		}

		const finishStatement = auditStatementStart(
			audit,
			queryObject.sql,
			connection.__knexUid,
		);

		return runDriverQuery
			.call(this, connection, queryObject)
			.finally(finishStatement);
	};
}

/**
 * A statement joins the transaction open on its connection. Outside one, it is a
 * transaction of its own, as the database runs it. Returns what records the
 * statement's end.
 */
export function auditStatementStart(
	audit: QueryAudit,
	sql: string,
	connectionId: string,
): () => void {
	const startedAt = performance.now();
	const keyword = leadingKeyword(sql);

	if (keyword === 'begin' || keyword === 'start') {
		const transactionAudit = newTransactionAudit(audit, startedAt);

		audit.openTransactionAudits.set(connectionId, transactionAudit);

		return () => {};
	}

	const openTransactionAudit = audit.openTransactionAudits.get(connectionId);

	if (TRANSACTION_KEYWORDS.has(keyword)) {
		const endsTransaction = keyword === 'commit'
			|| (keyword === 'rollback' && !/^\s*rollback\s+to\b/i.test(sql));

		if (!endsTransaction || !openTransactionAudit) {
			return () => {};
		}

		audit.openTransactionAudits.delete(connectionId);

		openTransactionAudit.outcome = keyword === 'commit'
			? 'commit'
			: 'rollback';

		return () => {
			openTransactionAudit.ms = performance.now()
				- openTransactionAudit.startedAt;
		};
	}

	const transactionAudit = openTransactionAudit
		?? newTransactionAudit(audit, startedAt);

	const tableName = TABLE_PATTERN.exec(sql)?.[1];

	if (tableName) {
		const kindCounts = transactionAudit.tableCounts.get(tableName) ?? {};
		const statementKind = kindOfKeyword(keyword);

		kindCounts[statementKind] = (kindCounts[statementKind] ?? 0) + 1;
		transactionAudit.tableCounts.set(tableName, kindCounts);
	}

	const statementAudit = transactionAudit.statementAudits.get(sql)
		?? { count: 0, ms: 0 };

	statementAudit.count++;
	transactionAudit.statementAudits.set(sql, statementAudit);

	return () => {
		const elapsedMs = performance.now() - startedAt;

		statementAudit.ms += elapsedMs;

		if (!openTransactionAudit) {
			transactionAudit.ms = elapsedMs;
		}
	};
}

/**
 * The audit as the JSON header value, non-ASCII escaped so a header can carry
 * it. Past `maxSize` bytes, the statements of the largest entries go first, each
 * entry naming how many it dropped; `0` keeps them all.
 */
export function formatQueryAudit(
	audit: QueryAudit,
	{ withStatements, maxSize }: QueryAuditFormat,
): string {
	const transactionEntries = audit.transactionAudits.map((transactionAudit) => {
		return transactionEntryOf(transactionAudit, withStatements);
	});

	let headerValue = asciiJson(transactionEntries);

	while (maxSize > 0 && headerValue.length > maxSize) {
		const largestEntry = largestStatementsEntry(transactionEntries);

		if (!largestEntry?.statements) {
			break;
		}

		largestEntry.statementsDropped = largestEntry.statements.length;
		delete largestEntry.statements;

		headerValue = asciiJson(transactionEntries);
	}

	return headerValue;
}

function newTransactionAudit(
	audit: QueryAudit,
	startedAt: number,
): TransactionAudit {
	const transactionAudit: TransactionAudit = {
		startedAt,
		tableCounts: new Map(),
		statementAudits: new Map(),
	};

	audit.transactionAudits.push(transactionAudit);

	return transactionAudit;
}

// A transaction still open when the headers flush has no `ms` yet.
function transactionEntryOf(
	transactionAudit: TransactionAudit,
	withStatements: boolean,
): TransactionEntry {
	const transactionEntry: TransactionEntry = {
		ms: transactionAudit.ms === undefined
			? undefined
			: Math.round(transactionAudit.ms),
		outcome: transactionAudit.outcome,
		tables: Object.fromEntries(transactionAudit.tableCounts),
	};

	if (withStatements) {
		transactionEntry.statements = [...transactionAudit.statementAudits]
			.map(([sql, statementAudit]) => {
				return {
					sql,
					count: statementAudit.count,
					ms: Math.round(statementAudit.ms),
				};
			});
	}

	return transactionEntry;
}

function largestStatementsEntry(
	transactionEntries: TransactionEntry[],
): TransactionEntry | undefined {
	let largestEntry: TransactionEntry | undefined;
	let largestSize = 0;

	for (const transactionEntry of transactionEntries) {
		const statementsSize = transactionEntry.statements
			? asciiJson(transactionEntry.statements).length
			: 0;

		if (statementsSize > largestSize) {
			largestEntry = transactionEntry;
			largestSize = statementsSize;
		}
	}

	return largestEntry;
}

function asciiJson(value: unknown): string {
	return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (character) => {
		const hexCode = character.charCodeAt(0)
			.toString(16)
			.padStart(4, '0');

		return `\\u${hexCode}`;
	});
}

function leadingKeyword(sql: string): string {
	return /^[\s(]*([a-z]+)/i.exec(sql)?.[1]?.toLowerCase() ?? '';
}

function kindOfKeyword(keyword: string): StatementKind {
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
