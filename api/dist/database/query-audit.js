import { useEnv } from "@directus/env";
import { performance } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";

//#region src/database/query-audit.ts
const QUERY_AUDIT_LEVELS = [
	"counts",
	"statements",
	"bindings",
	"full"
];
const queryAuditStore = new AsyncLocalStorage();
const TRANSACTION_KEYWORDS = new Set([
	"begin",
	"start",
	"commit",
	"rollback",
	"savepoint",
	"release"
]);
const TABLE_PATTERN = /\b(?:from|into|update)\s+["`[]?([^\s"`\]().,;]+)/i;
const auditedPrototypes = /* @__PURE__ */ new WeakSet();
const QUERY_AUDIT_MIN_SIZE = 256;
function queryAuditEnabled() {
	return Boolean(useEnv()["QUERY_AUDIT_HEADER"]);
}
function isQueryAuditLevel(value) {
	return QUERY_AUDIT_LEVELS.includes(value);
}
function levelCarriesBindings(level) {
	return level === "bindings" || level === "full";
}
/**
* A request holds only what its `level` reports: no statements at `counts`,
* each run's bound values from `bindings` up while `bindingsAllowed` says so,
* and every run in order at `full` alone.
*/
function emptyQueryAudit(level = "statements", bindingsAllowed = () => true) {
	return {
		recordsStatements: level !== "counts",
		recordsRuns: level === "full",
		recordsBindings: () => levelCarriesBindings(level) && bindingsAllowed(),
		closed: false,
		startedAt: performance.now(),
		dbMs: 0,
		waitMs: 0,
		connectionWaits: /* @__PURE__ */ new Map(),
		connectionHolds: /* @__PURE__ */ new Map(),
		maxPoolConnections: 0,
		transactionAudits: [],
		openTransactionAudits: /* @__PURE__ */ new Map()
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
function auditQueriesOf(database) {
	const clientPrototype = Object.getPrototypeOf(database.client);
	if (auditedPrototypes.has(clientPrototype)) return;
	auditedPrototypes.add(clientPrototype);
	for (const methodName of ["_query", "_stream"]) {
		const runDriverMethod = clientPrototype[methodName];
		if (runDriverMethod) clientPrototype[methodName] = auditedDriverMethod(runDriverMethod);
	}
	const acquireConnection = clientPrototype.acquireConnection;
	if (acquireConnection) clientPrototype.acquireConnection = auditedAcquireConnection(acquireConnection);
}
/**
* Record how long the pool took to hand `connectionId` out, `undefined` when
* it handed none; the next statement on that connection reports it.
*/
function auditConnectionWait(audit, connectionId, waitMs) {
	if (audit.closed) return;
	audit.waitMs += waitMs;
	if (connectionId !== void 0) audit.connectionWaits.set(connectionId, waitMs);
}
/**
* Stop recording: past the response's headers, nothing more can be reported,
* and a long-lived resource first created during the request would otherwise
* keep adding to its audit.
*/
function closeQueryAudit(audit) {
	audit.closed = true;
	audit.connectionWaits.clear();
	audit.connectionHolds.clear();
	audit.openTransactionAudits.clear();
}
/**
* Let go of the statements once the header is written: a long-lived resource
* first created during the request keeps its audit alive, bound values included.
*/
function discardAuditedStatements(audit) {
	audit.transactionAudits = [];
}
function auditedAcquireConnection(acquireConnection) {
	return function(...acquireArguments) {
		const audit = queryAuditStore.getStore();
		if (!audit) return acquireConnection.apply(this, acquireArguments);
		const startedAt = performance.now();
		return acquireConnection.apply(this, acquireArguments).then((connection) => {
			auditConnectionWait(audit, connection.__knexUid, performance.now() - startedAt);
			return connection;
		}, (acquireError) => {
			auditConnectionWait(audit, void 0, performance.now() - startedAt);
			throw acquireError;
		});
	};
}
function auditedDriverMethod(runDriverMethod) {
	return function(connection, queryObject, ...streamArguments) {
		const audit = queryAuditStore.getStore();
		if (!audit) return runDriverMethod.call(this, connection, queryObject, ...streamArguments);
		const finishStatement = auditStatementStart(audit, queryObject.sql, connection.__knexUid, queryObject.bindings);
		let driverAnswer;
		try {
			driverAnswer = runDriverMethod.call(this, connection, queryObject, ...streamArguments);
		} catch (driverError) {
			finishStatement({ error: errorCodeOf(driverError) });
			throw driverError;
		}
		return driverAnswer.then((driverResult) => {
			finishStatement({
				rows: rowsOfQuery(this.dialect, queryObject),
				command: commandOfQuery(queryObject)
			});
			return driverResult;
		}, (driverError) => {
			finishStatement({ error: errorCodeOf(driverError) });
			throw driverError;
		});
	};
}
/**
* The rows a statement returned or changed, as each dialect's `_query` stores
* them; `undefined` when the driver gives no count.
*/
function rowsOfQuery(dialectName, queryObject) {
	const { response, context } = queryObject;
	let rowCount;
	if (dialectName === "mysql" || dialectName === "mysql2") {
		const [mysqlRows] = Array.isArray(response) ? response : [];
		rowCount = Array.isArray(mysqlRows) ? mysqlRows.length : mysqlRows?.affectedRows;
	} else if (dialectName === "sqlite3") {
		const readsRows = queryObject.method !== "raw" || leadingKeyword(queryObject.sql) === "select";
		if (!Array.isArray(response)) rowCount = context?.changes;
		else if (readsRows) rowCount = response.length;
	} else rowCount = response?.rowCount;
	return typeof rowCount === "number" ? rowCount : void 0;
}
function commandOfQuery(queryObject) {
	const command = queryObject.response?.command;
	return typeof command === "string" ? command : void 0;
}
function errorCodeOf(driverError) {
	const errorCode = driverError?.code;
	return typeof errorCode === "string" || typeof errorCode === "number" ? String(errorCode) : "unknown";
}
/**
* A statement joins the transaction open on its connection. Outside one, it is
* an entry of its own. Returns what records the statement's end.
*/
function auditStatementStart(audit, sql, connectionId, bindings = []) {
	if (audit.closed) return () => {};
	const startedAt = performance.now();
	const keyword = leadingKeyword(sql);
	const waitMs = audit.connectionWaits.get(connectionId) ?? 0;
	audit.connectionWaits.delete(connectionId);
	holdConnection(audit, connectionId);
	if (keyword === "begin" || keyword === "start") {
		const transactionAudit$1 = newTransactionAudit(audit, startedAt, false);
		transactionAudit$1.wait = waitMs;
		audit.openTransactionAudits.set(connectionId, transactionAudit$1);
		holdConnection(audit, connectionId);
		return ({ error } = {}) => {
			releaseConnection(audit, connectionId);
			if (error === void 0) return;
			if (audit.openTransactionAudits.get(connectionId) === transactionAudit$1) audit.openTransactionAudits.delete(connectionId);
			transactionAudit$1.outcome = "rollback";
			transactionAudit$1.error = error;
			transactionAudit$1.ms = performance.now() - startedAt;
			releaseConnection(audit, connectionId);
		};
	}
	const openTransactionAudit = audit.openTransactionAudits.get(connectionId);
	if (TRANSACTION_KEYWORDS.has(keyword)) {
		if (!(keyword === "commit" || keyword === "rollback" && !/^\s*rollback\s+to\b/i.test(sql)) || !openTransactionAudit) return () => releaseConnection(audit, connectionId);
		audit.openTransactionAudits.delete(connectionId);
		return ({ error, command } = {}) => {
			openTransactionAudit.outcome = keyword === "commit" && error === void 0 && command !== "ROLLBACK" ? "commit" : "rollback";
			if (error !== void 0) openTransactionAudit.error = error;
			openTransactionAudit.ms = performance.now() - openTransactionAudit.startedAt;
			releaseConnection(audit, connectionId);
			releaseConnection(audit, connectionId);
		};
	}
	const tableName = TABLE_PATTERN.exec(sql)?.[1];
	const cutStmt = tableName ? `${kindOfKeyword(keyword)} ${tableName}...` : `${keyword}...`;
	const stmt = audit.recordsStatements ? sql : cutStmt;
	const transactionAudit = openTransactionAudit ?? newTransactionAudit(audit, startedAt, true);
	const statementAudit = transactionAudit.statementAudits.get(stmt) ?? {
		stmt,
		cutStmt,
		count: 0,
		ms: 0,
		wait: 0,
		bindings: []
	};
	const runAudit = {
		stmt,
		cutStmt,
		wait: waitMs,
		bindings: []
	};
	statementAudit.count++;
	statementAudit.wait += waitMs;
	if (audit.recordsBindings()) {
		statementAudit.bindings.push(bindings);
		runAudit.bindings = bindings;
	}
	transactionAudit.statementAudits.set(stmt, statementAudit);
	if (audit.recordsRuns) transactionAudit.runAudits.push(runAudit);
	return ({ rows, error } = {}) => {
		const elapsedMs = performance.now() - startedAt;
		statementAudit.ms += elapsedMs;
		runAudit.ms = elapsedMs;
		audit.dbMs += elapsedMs;
		if (rows !== void 0) {
			statementAudit.rows = (statementAudit.rows ?? 0) + rows;
			runAudit.rows = rows;
		}
		if (error !== void 0) {
			statementAudit.error ??= error;
			runAudit.error = error;
		}
		if (!openTransactionAudit) transactionAudit.ms = elapsedMs;
		releaseConnection(audit, connectionId);
	};
}
function holdConnection(audit, connectionId) {
	const { connectionHolds } = audit;
	connectionHolds.set(connectionId, (connectionHolds.get(connectionId) ?? 0) + 1);
	audit.maxPoolConnections = Math.max(audit.maxPoolConnections, connectionHolds.size);
}
function releaseConnection(audit, connectionId) {
	const holdCount = (audit.connectionHolds.get(connectionId) ?? 0) - 1;
	if (holdCount > 0) audit.connectionHolds.set(connectionId, holdCount);
	else audit.connectionHolds.delete(connectionId);
}
/**
* The audit as the JSON header value, non-ASCII escaped so a header can carry
* it: the request's `{ ms, db, wait, maxPoolConnections, statements }`, its
* `statements` each a transaction `{ transaction, ms, wait, statements }` or a
* statement outside one, and every statement `{ stmt, count, ms, bindings }`.
* `timings: false` leaves out every `ms`. Past `maxSize` bytes, the runs of
* the largest entries are grouped by statement first, then their bound values
* go, then their SQL is cut to `<kind> <table>...`, each entry naming how many
* it grouped, dropped or cut, then the last entries go, `entriesDropped`
* naming how many; `0` keeps them all. Each entry is serialised again only
* when it changes, never the whole header, so a request of thousands of
* entries is cut in milliseconds.
*/
function formatQueryAudit(audit, { level, maxSize, timings = true }) {
	const auditEntries = audit.transactionAudits.map((transactionAudit) => {
		return auditEntryOf(transactionAudit, level);
	});
	const jsonValueOf = (auditEntry) => {
		return entryValueOf(auditEntry, timings);
	};
	const requestFields = requestFieldsOf(audit, timings);
	const headerOf = (keptValues, entriesDropped) => {
		return asciiJson({
			...requestFields,
			...entriesDropped === void 0 ? {} : { entriesDropped },
			statements: keptValues
		});
	};
	const entrySizes = auditEntries.map((auditEntry) => {
		return asciiJson(jsonValueOf(auditEntry)).length;
	});
	const entriesMaxSize = maxSize - headerOf([]).length + 2;
	let headerSize = entrySizes.reduce((total, entrySize) => total + entrySize, 0) + Math.max(entrySizes.length - 1, 0) + 2;
	if (maxSize <= 0 || headerSize <= entriesMaxSize) return headerOf(auditEntries.map(jsonValueOf));
	for (const { detailSizeOf, dropDetail } of DROPPED_DETAILS) {
		const largestFirst = entryIndexesByDetailSize(auditEntries, detailSizeOf);
		for (const entryIndex of largestFirst) {
			if (headerSize <= entriesMaxSize) return headerOf(auditEntries.map(jsonValueOf));
			dropDetail(auditEntries[entryIndex]);
			const entrySize = asciiJson(jsonValueOf(auditEntries[entryIndex])).length;
			headerSize += entrySize - entrySizes[entryIndex];
			entrySizes[entryIndex] = entrySize;
		}
	}
	if (headerSize <= entriesMaxSize) return headerOf(auditEntries.map(jsonValueOf));
	const keptCount = keptEntryCount(entrySizes, entriesMaxSize);
	return headerOf(auditEntries.slice(0, keptCount).map(jsonValueOf), auditEntries.length - keptCount);
}
/**
* `ms` from the audit's start until the headers flush, `db` the statements'
* `ms`, `wait` the pool's, and `maxPoolConnections` the most pool connections
* the request held at once.
*/
function requestFieldsOf(audit, timings) {
	return {
		...timings ? {
			ms: Math.round(performance.now() - audit.startedAt),
			db: Math.round(audit.dbMs),
			wait: Math.round(audit.waitMs)
		} : {},
		maxPoolConnections: audit.maxPoolConnections
	};
}
function newTransactionAudit(audit, startedAt, outsideTransaction) {
	const transactionAudit = {
		startedAt,
		wait: 0,
		outsideTransaction,
		statementAudits: /* @__PURE__ */ new Map(),
		runAudits: []
	};
	audit.transactionAudits.push(transactionAudit);
	return transactionAudit;
}
function auditEntryOf(transactionAudit, level) {
	const statementItems = level === "full" ? transactionAudit.runAudits.map((runAudit) => {
		return {
			stmt: runAudit.stmt,
			cutStmt: runAudit.cutStmt,
			count: 1,
			ms: runAudit.ms,
			wait: runAudit.wait,
			rows: runAudit.rows,
			error: runAudit.error,
			bindings: [runAudit.bindings]
		};
	}) : [...transactionAudit.statementAudits.values()].map((statementAudit) => {
		return { ...statementAudit };
	});
	const levelItems = level === "counts" ? mergedStatementItems(statementItems.map((statementItem) => {
		return {
			...statementItem,
			stmt: statementItem.cutStmt
		};
	})) : statementItems;
	if (!levelCarriesBindings(level)) for (const statementItem of levelItems) delete statementItem.bindings;
	const auditEntry = {
		ms: transactionAudit.ms,
		wait: transactionAudit.wait,
		runsInOrder: level === "full",
		statementItems: levelItems
	};
	if (!transactionAudit.outsideTransaction) {
		auditEntry.transaction = transactionAudit.outcome ?? "open";
		auditEntry.error = transactionAudit.error;
	}
	return auditEntry;
}
function entryValueOf(auditEntry, timings) {
	const { runsGrouped, bindingsDropped, statementsCut } = auditEntry;
	const droppedDetails = Object.fromEntries(Object.entries({
		runsGrouped,
		bindingsDropped,
		statementsCut
	}).filter(([, droppedCount]) => droppedCount !== void 0));
	const outsideTransaction = auditEntry.transaction === void 0;
	const statementValues = auditEntry.statementItems.map((statementItem) => {
		return statementValueOf(statementItem, {
			runsInOrder: auditEntry.runsInOrder,
			timings,
			carriesWait: outsideTransaction
		});
	});
	if (outsideTransaction) return {
		...statementValues[0],
		...droppedDetails
	};
	return {
		transaction: auditEntry.transaction,
		...auditEntry.error === void 0 ? {} : { error: auditEntry.error },
		...msValueOf(auditEntry.ms, timings),
		...waitValueOf(auditEntry.wait, timings),
		statements: statementValues,
		...droppedDetails
	};
}
function statementValueOf(statementItem, { runsInOrder, timings, carriesWait }) {
	const statementValue = { stmt: statementItem.stmt };
	if (!runsInOrder && statementItem.count > 1) statementValue["count"] = statementItem.count;
	Object.assign(statementValue, msValueOf(statementItem.ms, timings), waitValueOf(statementItem.wait, timings && carriesWait));
	if (statementItem.rows !== void 0) statementValue["rows"] = statementItem.rows;
	if (statementItem.error !== void 0) statementValue["error"] = statementItem.error;
	if (statementItem.bindings) statementValue["bindings"] = runsInOrder ? statementItem.bindings[0] : statementItem.bindings;
	return statementValue;
}
function msValueOf(ms, timings) {
	return timings && ms !== void 0 ? { ms: Math.round(ms) } : {};
}
function waitValueOf(wait, timings) {
	return timings ? { wait: Math.round(wait) } : {};
}
/**
* The items sharing a `stmt` as one, in first-seen order: their runs counted,
* their `ms`, `wait` and `rows` summed, the first `error` and the bound values
* of each run kept.
*/
function mergedStatementItems(statementItems) {
	const itemsByStmt = /* @__PURE__ */ new Map();
	for (const statementItem of statementItems) {
		const mergedItem = itemsByStmt.get(statementItem.stmt);
		if (!mergedItem) {
			itemsByStmt.set(statementItem.stmt, {
				...statementItem,
				...statementItem.bindings && { bindings: statementItem.bindings.slice() }
			});
			continue;
		}
		mergedItem.count += statementItem.count;
		mergedItem.ms = (mergedItem.ms ?? 0) + (statementItem.ms ?? 0);
		mergedItem.wait += statementItem.wait;
		mergedItem.error ??= statementItem.error;
		if (statementItem.rows !== void 0) mergedItem.rows = (mergedItem.rows ?? 0) + statementItem.rows;
		if (mergedItem.bindings && statementItem.bindings) for (const runBindings of statementItem.bindings) mergedItem.bindings.push(runBindings);
	}
	return [...itemsByStmt.values()];
}
const DROPPED_DETAILS = [
	{
		detailSizeOf: (auditEntry) => {
			return auditEntry.runsInOrder && auditEntry.statementItems.length > 1 ? asciiJson(auditEntry.statementItems).length : 0;
		},
		dropDetail: (auditEntry) => {
			auditEntry.runsGrouped = auditEntry.statementItems.length;
			auditEntry.statementItems = mergedStatementItems(auditEntry.statementItems);
			auditEntry.runsInOrder = false;
		}
	},
	{
		detailSizeOf: (auditEntry) => {
			const { statementItems } = auditEntry;
			return statementItems.some(({ bindings }) => bindings) ? asciiJson(statementItems.map(({ bindings }) => bindings)).length : 0;
		},
		dropDetail: (auditEntry) => {
			let droppedRuns = 0;
			for (const statementItem of auditEntry.statementItems) {
				droppedRuns += statementItem.bindings?.length ?? 0;
				delete statementItem.bindings;
			}
			auditEntry.bindingsDropped = droppedRuns;
		}
	},
	{
		detailSizeOf: (auditEntry) => {
			const uncutStmts = auditEntry.statementItems.filter(({ stmt, cutStmt }) => stmt !== cutStmt).map(({ stmt }) => stmt);
			return uncutStmts.length > 0 ? asciiJson(uncutStmts).length : 0;
		},
		dropDetail: (auditEntry) => {
			let cutCount = 0;
			for (const statementItem of auditEntry.statementItems) if (statementItem.stmt !== statementItem.cutStmt) {
				statementItem.stmt = statementItem.cutStmt;
				cutCount++;
			}
			auditEntry.statementsCut = cutCount;
			auditEntry.statementItems = mergedStatementItems(auditEntry.statementItems);
		}
	}
];
/**
* The entries whose detail is not empty, largest detail first, earliest first
* among equals.
*/
function entryIndexesByDetailSize(auditEntries, detailSizeOf) {
	const detailSizes = auditEntries.map(detailSizeOf);
	return detailSizes.map((_detailSize, entryIndex) => entryIndex).filter((entryIndex) => detailSizes[entryIndex] > 0).sort((left, right) => detailSizes[right] - detailSizes[left]);
}
/**
* How many of the earliest entries fit beside `"entriesDropped":N,`; none
* when not even the first does.
*/
function keptEntryCount(entrySizes, maxSize) {
	let keptSize = 2;
	let keptCount = 0;
	for (const entrySize of entrySizes) {
		const droppedFieldSize = asciiJson({ entriesDropped: entrySizes.length - keptCount - 1 }).length - 1;
		const commaSize = keptCount > 0 ? 1 : 0;
		if (keptSize + commaSize + entrySize + droppedFieldSize > maxSize) break;
		keptSize += commaSize + entrySize;
		keptCount++;
	}
	return keptCount;
}
function asciiJson(value) {
	return JSON.stringify(value, (_key, jsonValue) => {
		return typeof jsonValue === "bigint" ? String(jsonValue) : jsonValue;
	}).replace(/[^\x20-\x7e]/g, (character) => {
		return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
	});
}
function leadingKeyword(sql) {
	return /^[\s(]*([a-z]+)/i.exec(sql)?.[1]?.toLowerCase() ?? "";
}
function kindOfKeyword(keyword) {
	if (keyword === "select" || keyword === "insert" || keyword === "update" || keyword === "delete") return keyword;
	return "other";
}

//#endregion
export { QUERY_AUDIT_LEVELS, QUERY_AUDIT_MIN_SIZE, auditConnectionWait, auditQueriesOf, auditStatementStart, closeQueryAudit, discardAuditedStatements, emptyQueryAudit, formatQueryAudit, isQueryAuditLevel, levelCarriesBindings, queryAuditEnabled, queryAuditStore };