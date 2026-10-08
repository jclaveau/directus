import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

type StatementKind = 'select' | 'insert' | 'update' | 'delete' | 'other';

type TransactionOutcome = 'commit' | 'rollback';

/**
 * One statement as reported: `stmt` is its SQL, or `<kind> <table>...` at
 * `counts`, and `cutStmt` that shorter form whatever the level.
 */
type StatementAudit = {
	stmt: string;
	cutStmt: string;
	count: number;
	ms: number;
	bindings: unknown[][];
};

type RunAudit = {
	stmt: string;
	cutStmt: string;
	ms?: number;
	bindings: unknown[];
};

type TransactionAudit = {
	startedAt: number;
	ms?: number;
	outcome?: TransactionOutcome;
	outsideTransaction: boolean;
	statementAudits: Map<string, StatementAudit>;
	runAudits: RunAudit[];
};

export type QueryAudit = {
	recordsStatements: boolean;
	recordsRuns: boolean;
	recordsBindings: () => boolean;
	closed: boolean;
	transactionAudits: TransactionAudit[];
	openTransactionAudits: Map<string, TransactionAudit>;
};

export const QUERY_AUDIT_LEVELS = [
	'counts',
	'statements',
	'bindings',
	'full',
] as const;

export type QueryAuditLevel = (typeof QUERY_AUDIT_LEVELS)[number];

export type QueryAuditFormat = {
	level: QueryAuditLevel;
	maxSize: number;
	timings?: boolean;
};

// `bindings` holds one array of values per run, its single run's at `full`.
type StatementItem = {
	stmt: string;
	cutStmt: string;
	count: number;
	ms: number | undefined;
	bindings?: unknown[][];
};

/**
 * A transaction, or with no `transaction` a statement outside one: its single
 * item then stands as the entry. `runsInOrder` holds every run at `full`.
 */
type AuditEntry = {
	transaction?: TransactionOutcome | 'open';
	ms: number | undefined;
	runsInOrder: boolean;
	statementItems: StatementItem[];
	runsGrouped?: number;
	bindingsDropped?: number;
	statementsCut?: number;
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

// Bound values carry what the request read and wrote.
export function levelCarriesBindings(level: QueryAuditLevel): boolean {
	return level === 'bindings' || level === 'full';
}

/**
 * A request holds only what its `level` reports: no statements at `counts`,
 * each run's bound values from `bindings` up while `bindingsAllowed` says so,
 * and every run in order at `full` alone.
 */
export function emptyQueryAudit(
	level: QueryAuditLevel = 'statements',
	bindingsAllowed: () => boolean = () => true,
): QueryAudit {
	return {
		recordsStatements: level !== 'counts',
		recordsRuns: level === 'full',
		recordsBindings: () => levelCarriesBindings(level) && bindingsAllowed(),
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
 * A statement joins the transaction open on its connection. Outside one, it is
 * an entry of its own. Returns what records the statement's end.
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
		const transactionAudit = newTransactionAudit(audit, startedAt, false);

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

	const tableName = TABLE_PATTERN.exec(sql)?.[1];

	const cutStmt = tableName
		? `${kindOfKeyword(keyword)} ${tableName}...`
		: `${keyword}...`;

	const stmt = audit.recordsStatements
		? sql
		: cutStmt;

	const transactionAudit = openTransactionAudit
		?? newTransactionAudit(audit, startedAt, true);

	const statementAudit = transactionAudit.statementAudits.get(stmt)
		?? { stmt, cutStmt, count: 0, ms: 0, bindings: [] };

	const runAudit: RunAudit = { stmt, cutStmt, bindings: [] };

	statementAudit.count++;

	if (audit.recordsBindings()) {
		statementAudit.bindings.push(bindings);
		runAudit.bindings = bindings;
	}

	transactionAudit.statementAudits.set(stmt, statementAudit);

	if (audit.recordsRuns) {
		transactionAudit.runAudits.push(runAudit);
	}

	return () => {
		const elapsedMs = performance.now() - startedAt;

		statementAudit.ms += elapsedMs;
		runAudit.ms = elapsedMs;

		if (!openTransactionAudit) {
			transactionAudit.ms = elapsedMs;
		}
	};
}

/**
 * The audit as the JSON header value, non-ASCII escaped so a header can carry
 * it: a transaction is `{ transaction, ms, statements }`, a statement outside
 * one `{ stmt, ms }` on its own, and every statement `{ stmt, count, ms,
 * bindings }`. `timings: false` leaves out every `ms`. Past `maxSize` bytes,
 * the runs of the largest entries are grouped by statement first, then their
 * bound values go, then their SQL is cut to `<kind> <table>...`, each entry
 * naming how many it grouped, dropped or cut, then the last entries go, a
 * closing `{"entriesDropped":N}` naming how many; `0` keeps them all. Each entry
 * is serialised again only when it changes, never the whole header, so a
 * request of thousands of entries is cut in milliseconds.
 */
export function formatQueryAudit(
	audit: QueryAudit,
	{ level, maxSize, timings = true }: QueryAuditFormat,
): string {
	const auditEntries = audit.transactionAudits.map((transactionAudit) => {
		return auditEntryOf(transactionAudit, level);
	});

	const jsonValueOf = (auditEntry: AuditEntry) => {
		return entryValueOf(auditEntry, timings);
	};

	const entrySizes = auditEntries.map((auditEntry) => {
		return asciiJson(jsonValueOf(auditEntry)).length;
	});

	// The entries, the commas between them and the brackets around them.
	let headerSize = entrySizes.reduce((total, entrySize) => total + entrySize, 0)
		+ Math.max(entrySizes.length - 1, 0)
		+ 2;

	if (maxSize <= 0 || headerSize <= maxSize) {
		return asciiJson(auditEntries.map(jsonValueOf));
	}

	for (const { detailSizeOf, dropDetail } of DROPPED_DETAILS) {
		const largestFirst = entryIndexesByDetailSize(
			auditEntries,
			detailSizeOf,
		);

		for (const entryIndex of largestFirst) {
			if (headerSize <= maxSize) {
				return asciiJson(auditEntries.map(jsonValueOf));
			}

			dropDetail(auditEntries[entryIndex]!);

			const entrySize = asciiJson(jsonValueOf(auditEntries[entryIndex]!)).length;

			headerSize += entrySize - entrySizes[entryIndex]!;
			entrySizes[entryIndex] = entrySize;
		}
	}

	if (headerSize <= maxSize) {
		return asciiJson(auditEntries.map(jsonValueOf));
	}

	const keptCount = keptEntryCount(entrySizes, maxSize);

	return asciiJson([
		...auditEntries.slice(0, keptCount).map(jsonValueOf),
		{ entriesDropped: auditEntries.length - keptCount },
	]);
}

function newTransactionAudit(
	audit: QueryAudit,
	startedAt: number,
	outsideTransaction: boolean,
): TransactionAudit {
	const transactionAudit: TransactionAudit = {
		startedAt,
		outsideTransaction,
		statementAudits: new Map(),
		runAudits: [],
	};

	audit.transactionAudits.push(transactionAudit);

	return transactionAudit;
}

// A transaction or statement still open when the headers flush has no `ms`
// yet.
function auditEntryOf(
	transactionAudit: TransactionAudit,
	level: QueryAuditLevel,
): AuditEntry {
	const statementItems: StatementItem[] = level === 'full'
		? transactionAudit.runAudits.map((runAudit) => {
			return {
				stmt: runAudit.stmt,
				cutStmt: runAudit.cutStmt,
				count: 1,
				ms: runAudit.ms,
				bindings: [runAudit.bindings],
			};
		})
		: [...transactionAudit.statementAudits.values()].map((statementAudit) => {
			return { ...statementAudit };
		});

	const levelItems = level === 'counts'
		? mergedStatementItems(statementItems.map((statementItem) => {
			return { ...statementItem, stmt: statementItem.cutStmt };
		}))
		: statementItems;

	if (!levelCarriesBindings(level)) {
		for (const statementItem of levelItems) {
			delete statementItem.bindings;
		}
	}

	const auditEntry: AuditEntry = {
		ms: transactionAudit.ms,
		runsInOrder: level === 'full',
		statementItems: levelItems,
	};

	if (!transactionAudit.outsideTransaction) {
		auditEntry.transaction = transactionAudit.outcome ?? 'open';
	}

	return auditEntry;
}

function entryValueOf(auditEntry: AuditEntry, timings: boolean): unknown {
	const { runsGrouped, bindingsDropped, statementsCut } = auditEntry;

	const droppedDetails = Object.fromEntries(Object.entries({
		runsGrouped,
		bindingsDropped,
		statementsCut,
	}).filter(([, droppedCount]) => droppedCount !== undefined));

	const statementValues = auditEntry.statementItems.map((statementItem) => {
		return statementValueOf(statementItem, auditEntry.runsInOrder, timings);
	});

	if (auditEntry.transaction === undefined) {
		return { ...statementValues[0], ...droppedDetails };
	}

	return {
		transaction: auditEntry.transaction,
		...msValueOf(auditEntry.ms, timings),
		statements: statementValues,
		...droppedDetails,
	};
}

function statementValueOf(
	statementItem: StatementItem,
	runsInOrder: boolean,
	timings: boolean,
): Record<string, unknown> {
	const statementValue: Record<string, unknown> = { stmt: statementItem.stmt };

	if (!runsInOrder && statementItem.count > 1) {
		statementValue['count'] = statementItem.count;
	}

	Object.assign(statementValue, msValueOf(statementItem.ms, timings));

	if (statementItem.bindings) {
		statementValue['bindings'] = runsInOrder
			? statementItem.bindings[0]
			: statementItem.bindings;
	}

	return statementValue;
}

function msValueOf(ms: number | undefined, timings: boolean) {
	return timings && ms !== undefined
		? { ms: Math.round(ms) }
		: {};
}

/**
 * The items sharing a `stmt` as one, in first-seen order: their runs counted,
 * their `ms` summed, the bound values of each run kept.
 */
function mergedStatementItems(
	statementItems: StatementItem[],
): StatementItem[] {
	const itemsByStmt = new Map<string, StatementItem>();

	for (const statementItem of statementItems) {
		const mergedItem = itemsByStmt.get(statementItem.stmt);

		if (!mergedItem) {
			itemsByStmt.set(statementItem.stmt, { ...statementItem });

			continue;
		}

		mergedItem.count += statementItem.count;
		mergedItem.ms = (mergedItem.ms ?? 0) + (statementItem.ms ?? 0);

		if (mergedItem.bindings && statementItem.bindings) {
			mergedItem.bindings = mergedItem.bindings.concat(statementItem.bindings);
		}
	}

	return [...itemsByStmt.values()];
}

// Grouping the runs keeps every value but their order; bound values go before
// the SQL: a statement's text says more about the request than one run's
// values.
const DROPPED_DETAILS = [
	{
		detailSizeOf: (auditEntry: AuditEntry) => {
			return auditEntry.runsInOrder && auditEntry.statementItems.length > 1
				? asciiJson(auditEntry.statementItems).length
				: 0;
		},
		dropDetail: (auditEntry: AuditEntry) => {
			auditEntry.runsGrouped = auditEntry.statementItems.length;
			auditEntry.statementItems = mergedStatementItems(auditEntry.statementItems);
			auditEntry.runsInOrder = false;
		},
	},
	{
		detailSizeOf: (auditEntry: AuditEntry) => {
			const { statementItems } = auditEntry;

			return statementItems.some(({ bindings }) => bindings)
				? asciiJson(statementItems.map(({ bindings }) => bindings)).length
				: 0;
		},
		dropDetail: (auditEntry: AuditEntry) => {
			let droppedRuns = 0;

			for (const statementItem of auditEntry.statementItems) {
				droppedRuns += statementItem.bindings?.length ?? 0;
				delete statementItem.bindings;
			}

			auditEntry.bindingsDropped = droppedRuns;
		},
	},
	{
		detailSizeOf: (auditEntry: AuditEntry) => {
			const uncutStmts = auditEntry.statementItems
				.filter(({ stmt, cutStmt }) => stmt !== cutStmt)
				.map(({ stmt }) => stmt);

			return uncutStmts.length > 0
				? asciiJson(uncutStmts).length
				: 0;
		},
		dropDetail: (auditEntry: AuditEntry) => {
			let cutCount = 0;

			for (const statementItem of auditEntry.statementItems) {
				if (statementItem.stmt !== statementItem.cutStmt) {
					statementItem.stmt = statementItem.cutStmt;
					cutCount++;
				}
			}

			auditEntry.statementsCut = cutCount;
			auditEntry.statementItems = mergedStatementItems(auditEntry.statementItems);
		},
	},
];

/**
 * The entries whose detail is not empty, largest detail first, earliest first
 * among equals.
 */
function entryIndexesByDetailSize(
	auditEntries: AuditEntry[],
	detailSizeOf: (auditEntry: AuditEntry) => number,
): number[] {
	const detailSizes = auditEntries.map(detailSizeOf);

	return detailSizes
		.map((_detailSize, entryIndex) => entryIndex)
		.filter((entryIndex) => detailSizes[entryIndex]! > 0)
		.sort((left, right) => detailSizes[right]! - detailSizes[left]!);
}

/**
 * How many of the earliest entries fit beside `{"entriesDropped":N}`; none
 * when not even the first does.
 */
function keptEntryCount(entrySizes: number[], maxSize: number): number {
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

	return keptCount;
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
