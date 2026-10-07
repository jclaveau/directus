import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

type StatementKind = 'select' | 'insert' | 'update' | 'delete' | 'other';

type KindCounts = Partial<Record<StatementKind, number>>;

type TransactionOutcome = 'commit' | 'rollback';

type StatementAudit = { count: number; ms: number; bindings: unknown[][] };

type TransactionAudit = {
	startedAt: number;
	ms?: number;
	outcome?: TransactionOutcome;
	tableCounts: Map<string, KindCounts>;
	statementAudits: Map<string, StatementAudit>;
};

export type QueryAudit = {
	recordsBindings: boolean;
	transactionAudits: TransactionAudit[];
	openTransactionAudits: Map<string, TransactionAudit>;
};

export const QUERY_AUDIT_LEVELS = ['counts', 'statements', 'full'] as const;

export type QueryAuditLevel = (typeof QUERY_AUDIT_LEVELS)[number];

export type QueryAuditFormat = {
	level: QueryAuditLevel;
	maxSize: number;
};

type StatementEntry = {
	sql: string;
	count: number;
	ms: number;
	bindings?: unknown[][];
};

type TransactionEntry = {
	ms?: number | undefined;
	outcome?: TransactionOutcome | undefined;
	tables: Record<string, KindCounts>;
	statements?: StatementEntry[];
	bindingsDropped?: number;
	statementsDropped?: number;
};

type DriverConnection = { __knexUid: string };

type DriverQuery = (
	this: unknown,
	connection: DriverConnection,
	queryObject: DriverQueryObject,
) => Promise<unknown>;

type DriverQueryObject = { sql: string; bindings?: unknown[] };

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

export function isQueryAuditLevel(value: unknown): value is QueryAuditLevel {
	return QUERY_AUDIT_LEVELS.includes(value as QueryAuditLevel);
}

/**
 * `recordsBindings` keeps each run's bound values, which only the `full` level
 * reports: off, a request holds none of them.
 */
export function emptyQueryAudit(recordsBindings = false): QueryAudit {
	return {
		recordsBindings,
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
		queryObject: DriverQueryObject,
	) {
		const audit = queryAuditStore.getStore();

		if (!audit) {
			return runDriverQuery.call(this, connection, queryObject);
		}

		const finishStatement = auditStatementStart(
			audit,
			queryObject.sql,
			connection.__knexUid,
			queryObject.bindings,
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
	bindings: unknown[] = [],
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
		?? { count: 0, ms: 0, bindings: [] };

	statementAudit.count++;

	if (audit.recordsBindings) {
		statementAudit.bindings.push(bindings);
	}

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
 * it. Past `maxSize` bytes, the bound values of the largest entries go first,
 * then their statements, each entry naming how many it dropped; `0` keeps them
 * all.
 */
export function formatQueryAudit(
	audit: QueryAudit,
	{ level, maxSize }: QueryAuditFormat,
): string {
	const transactionEntries = audit.transactionAudits.map((transactionAudit) => {
		return transactionEntryOf(transactionAudit, level);
	});

	let headerValue = asciiJson(transactionEntries);

	while (maxSize > 0 && headerValue.length > maxSize) {
		if (!dropLargestDetail(transactionEntries)) {
			break;
		}

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
	level: QueryAuditLevel,
): TransactionEntry {
	const transactionEntry: TransactionEntry = {
		ms: transactionAudit.ms === undefined
			? undefined
			: Math.round(transactionAudit.ms),
		outcome: transactionAudit.outcome,
		tables: Object.fromEntries(transactionAudit.tableCounts),
	};

	if (level === 'counts') {
		return transactionEntry;
	}

	transactionEntry.statements = [...transactionAudit.statementAudits]
		.map(([sql, statementAudit]) => {
			const statementEntry: StatementEntry = {
				sql,
				count: statementAudit.count,
				ms: Math.round(statementAudit.ms),
			};

			if (level === 'full') {
				statementEntry.bindings = statementAudit.bindings;
			}

			return statementEntry;
		});

	return transactionEntry;
}

/**
 * Drop the bound values of the entry holding the most, or once none holds any,
 * the statements of the entry holding the most. Returns whether there was
 * anything left to drop.
 */
function dropLargestDetail(transactionEntries: TransactionEntry[]): boolean {
	const bindingsEntry = largestEntryBy(transactionEntries, (statements) => {
		return statements.some(({ bindings }) => bindings !== undefined)
			? asciiJson(statements.map(({ bindings }) => bindings)).length
			: 0;
	});

	if (bindingsEntry?.statements) {
		let droppedRuns = 0;

		for (const statementEntry of bindingsEntry.statements) {
			droppedRuns += statementEntry.bindings?.length ?? 0;
			delete statementEntry.bindings;
		}

		bindingsEntry.bindingsDropped = droppedRuns;

		return true;
	}

	const statementsEntry = largestEntryBy(transactionEntries, (statements) => {
		return asciiJson(statements).length;
	});

	if (statementsEntry?.statements) {
		statementsEntry.statementsDropped = statementsEntry.statements.length;
		delete statementsEntry.statements;

		return true;
	}

	return false;
}

function largestEntryBy(
	transactionEntries: TransactionEntry[],
	sizeOfStatements: (statements: StatementEntry[]) => number,
): TransactionEntry | undefined {
	let largestEntry: TransactionEntry | undefined;
	let largestSize = 0;

	for (const transactionEntry of transactionEntries) {
		const statementsSize = transactionEntry.statements
			? sizeOfStatements(transactionEntry.statements)
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
