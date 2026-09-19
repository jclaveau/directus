import { getMilliseconds } from "./utils/get-milliseconds.js";
import database_default from "./database/index.js";
import { getCache } from "./cache.js";
import { CACHE_AUDIT_VERDICTS, auditCache } from "./cache-audit.js";
import { cacheAuditEnabled } from "./utils/cache-audit-enabled.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ServiceUnavailableError, isDirectusError } from "@directus/errors";
import { parseJSON } from "@directus/utils";

//#region src/cache-audit-runs.ts
const CACHE_AUDIT_TRIGGERS = [
	"rest",
	"cli",
	"cron",
	"mcp"
];
const DEFAULT_RETENTION_MS = 2592e6;
const DEFAULT_MAX_DURATION_MS = 6e5;
const DEFAULT_LIST_WINDOW_MS = 6048e5;
const LIST_LIMIT = 200;
const FINDINGS_BATCH = 200;
const RUN_LOCK = "cache-audit:run";
const RUN_LOCK_TTL_MS = 12e4;
const RUN_LOCK_RENEW_MS = 3e4;
const ORPHAN_GRACE_MS = 36e5;
const DIED_ERROR = "The run did not finish: its process died";
const UNCLAIMED_MARGIN_MS = 5e3;
function retentionMs() {
	return getMilliseconds(useEnv()["CACHE_AUDIT_RETENTION"], DEFAULT_RETENTION_MS);
}
function maxDurationMs() {
	const configured = getMilliseconds(useEnv()["CACHE_AUDIT_MAX_DURATION"], DEFAULT_MAX_DURATION_MS);
	return configured > 0 ? configured : DEFAULT_MAX_DURATION_MS;
}
function defaultLimit() {
	const configured = Number(useEnv()["CACHE_AUDIT_LIMIT"] ?? 0);
	return Number.isInteger(configured) && configured > 0 ? configured : void 0;
}
/**
* Run an audit and record it — the one entrypoint every surface goes through,
* so no run escapes the history, none runs on a node that opted out, none
* runs beside another, and a run asking for no limit gets `CACHE_AUDIT_LIMIT`
* and `CACHE_AUDIT_MAX_DURATION`. The engine stays what it was: a function
* over the cache that answers a report and stores nothing.
*
* Two runs at once would share the queue without replaying an entry twice —
* each stamps what it takes — but would put twice the load on the database,
* which is what the limit and the budget are there to bound. So a run that
* finds another in flight is refused rather than started: a cron tick that
* outlives its interval skips the next, and "Audit now" during one says so.
* The claim is a read then a write, not one atomic step: two asks landing
* within a round-trip of each other could both pass, which costs one doubled
* run and nothing else.
*/
async function runCacheAudit(trigger, options = {}) {
	if (!cacheAuditEnabled()) throw new ServiceUnavailableError({
		service: "cache-audit",
		reason: "CACHE_AUDIT_ENABLED is false on this node"
	});
	const budgetMs = maxDurationMs();
	const { lockCache } = getCache();
	const inFlightSince = await lockCache.get(RUN_LOCK);
	if (inFlightSince !== void 0) throw new ServiceUnavailableError({
		service: "cache-audit",
		reason: `${IN_FLIGHT_REASON}, since ${new Date(Number(inFlightSince)).toISOString()}`
	});
	const since = Date.now();
	await lockCache.set(RUN_LOCK, since, RUN_LOCK_TTL_MS);
	let renewing = Promise.resolve();
	const renewal = setInterval(() => {
		renewing = lockCache.set(RUN_LOCK, since, RUN_LOCK_TTL_MS).catch(() => {});
	}, RUN_LOCK_RENEW_MS);
	renewal.unref();
	try {
		const sliced = {
			...options,
			limit: options.limit ?? defaultLimit(),
			maxDurationMs: options.maxDurationMs ?? budgetMs
		};
		const id = await startCacheAuditRun(trigger, sliced);
		let report;
		try {
			report = await auditCache(sliced);
			await finishCacheAuditRun(id, report);
		} catch (error) {
			await failCacheAuditRun(id, error).catch(() => {});
			throw error;
		}
		return {
			id,
			...report
		};
	} finally {
		clearInterval(renewal);
		await renewing;
		await lockCache.delete(RUN_LOCK);
		await reapCacheAuditRuns().catch(() => {});
	}
}
const IN_FLIGHT_REASON = "a cache audit is already running";
/** Whether a run was refused because another was in flight. */
function isCacheAuditInFlight(error) {
	return isDirectusError(error, ErrorCode.ServiceUnavailable) && String(error.extensions.reason).startsWith(IN_FLIGHT_REASON);
}
/**
* Open the run's row before the first entry is examined, so a run in flight
* is one the page can see — and a run whose process dies leaves a row with no
* `finished_at` rather than no trace.
*/
async function startCacheAuditRun(trigger, options) {
	const stored = {
		limit: options.limit ?? null,
		user: options.user ?? null,
		collection: options.collection ?? null,
		purge: options.purge === true
	};
	const [row] = await database_default()("directus_cache_audits").insert({
		started_at: /* @__PURE__ */ new Date(),
		trigger,
		options: JSON.stringify(stored)
	}).returning("id");
	return typeof row === "object" && row !== null ? Number(row.id) : Number(row);
}
/** Close the row with what the run found, and store each finding under it. */
async function finishCacheAuditRun(id, report) {
	await database_default().transaction(async (trx) => {
		await trx("directus_cache_audits").where({ id }).update({
			finished_at: /* @__PURE__ */ new Date(),
			error: null,
			scanned: report.scanned,
			...report.counts,
			evicted: report.evicted,
			duration_ms: report.durationMs,
			timed_out: report.timedOut
		});
		const rows = report.findings.map((finding) => findingRow(id, finding));
		if (rows.length > 0) await trx.batchInsert("directus_cache_audit_findings", rows, FINDINGS_BATCH);
	});
}
/** Close the row with why the run stopped, keeping the failure in the history. */
async function failCacheAuditRun(id, error) {
	await database_default()("directus_cache_audits").where({ id }).update({
		finished_at: /* @__PURE__ */ new Date(),
		error: error instanceof Error ? error.message : String(error)
	});
}
function findingRow(audit, finding) {
	return {
		audit,
		verdict: finding.verdict,
		reason: finding.reason,
		redis_key: finding.redisKey,
		cache_key: finding.cacheKey,
		method: finding.method,
		url: finding.url,
		query: finding.query,
		user_id: finding.user,
		collection: finding.collection,
		filled_at: new Date(finding.filledAt),
		age_ms: finding.ageMs,
		tags: JSON.stringify(finding.tags),
		replay_tags: jsonOrNull(finding.replayTags),
		diff: jsonOrNull(finding.diff),
		purges_since_filled: jsonOrNull(finding.purgesSinceFilled)
	};
}
function jsonOrNull(value) {
	return value === null ? null : JSON.stringify(value);
}
/**
* The runs started in the window, newest first. Without findings: a listing
* is what a trend reads off, and the findings are read per run.
*/
async function listCacheAuditRuns(windowMs) {
	const since = new Date(Date.now() - clampWindow(windowMs));
	const db = database_default();
	await closeUnclaimedCacheAuditRuns(db);
	return (await db("directus_cache_audits").where("started_at", ">", since).orderBy("started_at", "desc").limit(LIST_LIMIT)).map(runOf);
}
/**
* The claim is the truth on what is in flight: on Redis it is one for the
* deployment, and a run whose process died drops it within the TTL. A row
* still open with no claim behind it is that run's residue, and the page
* would wait on it for the reap's hour-long grace — the reap that only a
* later run brings. A memory claim is one per process, so there it says
* nothing about a run on another worker, and the grace is all there is.
*/
async function closeUnclaimedCacheAuditRuns(db) {
	if (useEnv()["CACHE_STORE"] !== "redis") return;
	if (await getCache().lockCache.get(RUN_LOCK) !== void 0) return;
	const now = Date.now();
	await db("directus_cache_audits").whereNull("finished_at").where("started_at", "<", new Date(now - UNCLAIMED_MARGIN_MS)).update({
		finished_at: new Date(now),
		error: DIED_ERROR
	});
}
/** One run as the listing carries it, or null where no run has that id. */
async function readCacheAuditRun(id) {
	const row = await database_default()("directus_cache_audits").where({ id }).first();
	return row === void 0 ? null : runOf(row);
}
/**
* One page of what a run found, and how many findings it stored in all: a
* run over a large cache on a bad day stores tens of thousands, which no
* answer should carry whole. Read in the order they were stored.
*/
async function readCacheAuditFindings(id, page) {
	const db = database_default();
	const stored = () => {
		const query = db("directus_cache_audit_findings").where({ audit: id });
		return page.verdict === void 0 ? query : query.where({ verdict: page.verdict });
	};
	const findingRows = await stored().orderBy("id", "asc").limit(page.limit).offset(page.offset);
	const counted = await stored().count("id as total").first();
	return {
		findings: findingRows.map(findingOf),
		findingsTotal: Number(counted?.["total"] ?? 0)
	};
}
/**
* Drop the runs past retention, their findings with them; and close the runs
* left open by a process that died, so the history stops reporting them as
* in flight.
*/
async function reapCacheAuditRuns() {
	const db = database_default();
	const now = Date.now();
	await db("directus_cache_audits").whereNull("finished_at").where("started_at", "<", /* @__PURE__ */ new Date(now - 2 * maxDurationMs() - ORPHAN_GRACE_MS)).update({
		finished_at: new Date(now),
		error: DIED_ERROR
	});
	return db("directus_cache_audits").where("started_at", "<", new Date(now - retentionMs())).delete();
}
function clampWindow(requested) {
	if (requested === void 0 || !Number.isFinite(requested) || requested <= 0) return Math.min(DEFAULT_LIST_WINDOW_MS, retentionMs());
	return Math.min(requested, retentionMs());
}
function runOf(row) {
	const counts = {};
	for (const verdict of CACHE_AUDIT_VERDICTS) counts[verdict] = Number(row[verdict] ?? 0);
	const finishedAt = row["finished_at"];
	return {
		id: Number(row["id"]),
		startedAt: new Date(row["started_at"]).getTime(),
		finishedAt: finishedAt === null || finishedAt === void 0 ? null : new Date(finishedAt).getTime(),
		trigger: row["trigger"],
		options: json(row["options"]),
		scanned: Number(row["scanned"] ?? 0),
		counts,
		evicted: Number(row["evicted"] ?? 0),
		durationMs: nullableNumber(row["duration_ms"]),
		timedOut: row["timed_out"] === true || row["timed_out"] === 1,
		error: row["error"] ?? null
	};
}
function findingOf(row) {
	return {
		verdict: row["verdict"],
		reason: row["reason"] ?? null,
		redisKey: row["redis_key"],
		cacheKey: row["cache_key"],
		method: row["method"],
		url: row["url"],
		query: row["query"],
		user: row["user_id"] ?? null,
		collection: row["collection"] ?? null,
		filledAt: new Date(row["filled_at"]).getTime(),
		ageMs: Number(row["age_ms"]),
		tags: json(row["tags"]) ?? [],
		replayTags: json(row["replay_tags"]),
		diff: json(row["diff"]),
		purgesSinceFilled: json(row["purges_since_filled"])
	};
}
function nullableNumber(value) {
	return value === null || value === void 0 ? null : Number(value);
}
function json(value) {
	if (value === null || value === void 0) return null;
	return typeof value === "string" ? parseJSON(value) : value;
}

//#endregion
export { CACHE_AUDIT_TRIGGERS, failCacheAuditRun, finishCacheAuditRun, isCacheAuditInFlight, listCacheAuditRuns, readCacheAuditFindings, readCacheAuditRun, reapCacheAuditRuns, runCacheAudit, startCacheAuditRun };