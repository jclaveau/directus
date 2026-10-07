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
	recordsStatements: boolean;
	recordsBindings: () => boolean;
	closed: boolean;
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
	...streamArguments: unknown[]
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
 * A request holds only what its `level` reports: no statements at `counts`, and
 * each run's bound values at `full` alone, while `bindingsAllowed` says so.
 */
export function emptyQueryAudit(
	level: QueryAuditLevel = 'statements',
	bindingsAllowed: () => boolean = () => true,
): QueryAudit {
	return {
		recordsStatements: level !== 'counts',
		recordsBindings: () => level === 'full' && bindingsAllowed(),
		closed: false,
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

	// `.stream()` reaches the driver through `_stream`, not `_query`.
	for (const methodName of ['_query', '_stream']) {
		const runDriverMethod: DriverQuery | undefined = clientPrototype[methodName];

		if (runDriverMethod) {
			clientPrototype[methodName] = auditedDriverMethod(runDriverMethod);
		}
	}
}

/**
 * Stop recording: past the response's headers, nothing more can be reported,
 * and a long-lived resource first created during the request would otherwise
 * keep adding to its audit.
 */
export function closeQueryAudit(audit: QueryAudit): void {
	audit.closed = true;
	audit.openTransactionAudits.clear();
}

function auditedDriverMethod(runDriverMethod: DriverQuery): DriverQuery {
	return function (this: unknown, connection, queryObject, ...streamArguments) {
		const audit = queryAuditStore.getStore();

		if (!audit) {
			return runDriverMethod.call(
				this,
				connection,
				queryObject,
				...streamArguments,
			);
		}

		const finishStatement = auditStatementStart(
			audit,
			queryObject.sql,
			connection.__knexUid,
			queryObject.bindings,
		);

		return runDriverMethod
			.call(this, connection, queryObject, ...streamArguments)
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
	if (audit.closed) {
		return () => {};
	}

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

	if (!audit.recordsStatements) {
		return () => {
			if (!openTransactionAudit) {
				transactionAudit.ms = performance.now() - startedAt;
			}
		};
	}

	const statementAudit = transactionAudit.statementAudits.get(sql)
		?? { count: 0, ms: 0, bindings: [] };

	statementAudit.count++;

	if (audit.recordsBindings()) {
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
 * then their statements, each entry naming how many it dropped, then the last
 * entries, a closing `{"entriesDropped":N}` naming how many; `0` keeps them
 * all. Each entry is serialised again only when it changes, never the whole
 * header, so a request of thousands of entries is cut in milliseconds.
 */
export function formatQueryAudit(
	audit: QueryAudit,
	{ level, maxSize }: QueryAuditFormat,
): string {
	const transactionEntries = audit.transactionAudits.map((transactionAudit) => {
		return transactionEntryOf(transactionAudit, level);
	});

	const entrySizes = transactionEntries.map((transactionEntry) => {
		return asciiJson(transactionEntry).length;
	});

	// The entries, the commas between them and the brackets around them.
	let headerSize = entrySizes.reduce((total, entrySize) => total + entrySize, 0)
		+ Math.max(entrySizes.length - 1, 0)
		+ 2;

	if (maxSize <= 0 || headerSize <= maxSize) {
		return asciiJson(transactionEntries);
	}

	for (const { detailSizeOf, dropDetail } of DROPPED_DETAILS) {
		const largestFirst = entryIndexesByDetailSize(
			transactionEntries,
			detailSizeOf,
		);

		for (const entryIndex of largestFirst) {
			if (headerSize <= maxSize) {
				return asciiJson(transactionEntries);
			}

			dropDetail(transactionEntries[entryIndex]!);

			const entrySize = asciiJson(transactionEntries[entryIndex]).length;

			headerSize += entrySize - entrySizes[entryIndex]!;
			entrySizes[entryIndex] = entrySize;
		}
	}

	if (headerSize <= maxSize) {
		return asciiJson(transactionEntries);
	}

	return asciiJson(withLastEntriesDropped(transactionEntries, entrySizes, maxSize));
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

// Bound values go before statements: a statement's text says more about the
// request than one run's values.
const DROPPED_DETAILS = [
	{
		detailSizeOf: (statements: StatementEntry[]) => {
			return statements.some(({ bindings }) => bindings)
				? asciiJson(statements.map(({ bindings }) => bindings)).length
				: 0;
		},
		dropDetail: (transactionEntry: TransactionEntry) => {
			let droppedRuns = 0;

			for (const statementEntry of transactionEntry.statements ?? []) {
				droppedRuns += statementEntry.bindings?.length ?? 0;
				delete statementEntry.bindings;
			}

			transactionEntry.bindingsDropped = droppedRuns;
		},
	},
	{
		detailSizeOf: (statements: StatementEntry[]) => {
			return asciiJson(statements).length;
		},
		dropDetail: (transactionEntry: TransactionEntry) => {
			transactionEntry.statementsDropped = transactionEntry.statements?.length ?? 0;
			delete transactionEntry.statements;
		},
	},
];

/**
 * The entries holding statements whose detail is not empty, largest detail
 * first, earliest first among equals.
 */
function entryIndexesByDetailSize(
	transactionEntries: TransactionEntry[],
	detailSizeOf: (statements: StatementEntry[]) => number,
): number[] {
	const detailSizes = transactionEntries.map(({ statements }) => {
		return statements
			? detailSizeOf(statements)
			: 0;
	});

	return detailSizes
		.map((_detailSize, entryIndex) => entryIndex)
		.filter((entryIndex) => detailSizes[entryIndex]! > 0)
		.sort((left, right) => detailSizes[right]! - detailSizes[left]!);
}

/**
 * Keep the earliest entries that fit beside `{"entriesDropped":N}`; that entry
 * alone when none does.
 */
function withLastEntriesDropped(
	transactionEntries: TransactionEntry[],
	entrySizes: number[],
	maxSize: number,
): (TransactionEntry | { entriesDropped: number })[] {
	let keptSize = 2;
	let keptCount = 0;

	for (const entrySize of entrySizes) {
		const droppedEntrySize = asciiJson({
			entriesDropped: entrySizes.length - keptCount - 1,
		}).length;

		if (keptSize + entrySize + 1 + droppedEntrySize > maxSize) {
			break;
		}

		keptSize += entrySize + 1;
		keptCount++;
	}

	return [
		...transactionEntries.slice(0, keptCount),
		{ entriesDropped: transactionEntries.length - keptCount },
	];
}

function asciiJson(value: unknown): string {
	const json = JSON.stringify(value, (_key, jsonValue) => {
		return typeof jsonValue === 'bigint'
			? String(jsonValue)
			: jsonValue;
	});

	return json.replace(/[^\x20-\x7e]/g, (character) => {
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
