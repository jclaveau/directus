import { useEnv } from '@directus/env';
import { ServiceUnavailableError } from '@directus/errors';
import { parseJSON } from '@directus/utils';
import {
	auditCache,
	CACHE_AUDIT_VERDICTS,
	type CacheAuditFinding,
	type CacheAuditOptions,
	type CacheAuditReport,
	type CacheAuditVerdict,
} from './cache-audit.js';
import type { CacheEntryPurgeRecord } from './cache-events.js';
import getDatabase from './database/index.js';
import { cacheAuditEnabled } from './utils/cache-audit-enabled.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

/**
 * The audit history: one row per run in `directus_cache_audits`, one per
 * non-fresh finding in `directus_cache_audit_findings` (see the migration for
 * why). Every surface that runs an audit records through here, so the cache
 * page, the MCP and a `SELECT` all read the same history whichever one ran it.
 */

/** What started a run. */
export type CacheAuditTrigger = 'rest' | 'cli' | 'cron' | 'mcp';

export const CACHE_AUDIT_TRIGGERS: readonly CacheAuditTrigger[] = [
	'rest',
	'cli',
	'cron',
	'mcp',
];

/** The narrowing a run was asked for, as stored with it. */
export interface CacheAuditRunOptions {
	limit: number | null;
	user: string | null;
	collection: string | null;
	purge: boolean;
}

export interface CacheAuditRun {
	id: number;
	startedAt: number;
	/** Null while the run is in flight — or forever, if its process died. */
	finishedAt: number | null;
	trigger: CacheAuditTrigger;
	options: CacheAuditRunOptions;
	scanned: number;
	counts: Record<CacheAuditVerdict, number>;
	evicted: number;
	durationMs: number | null;
	error: string | null;
}

export interface CacheAuditRunWithFindings extends CacheAuditRun {
	findings: CacheAuditFinding[];
}

/** A report with the row it was recorded under. */
export interface CacheAuditRunReport extends CacheAuditReport {
	id: number;
}

const DEFAULT_RETENTION_MS = 2_592_000_000; // 30d
const DEFAULT_LIST_WINDOW_MS = 604_800_000; // 7d
const LIST_LIMIT = 200;
const FINDINGS_BATCH = 200;

function retentionMs(): number {
	return getMilliseconds(useEnv()['CACHE_AUDIT_RETENTION'], DEFAULT_RETENTION_MS);
}

/**
 * Run an audit and record it — the one entrypoint every surface goes through,
 * so no run escapes the history, and none runs on a node that opted out. The
 * engine stays what it was: a function over the cache that answers a report
 * and stores nothing.
 */
export async function runCacheAudit(
	trigger: CacheAuditTrigger,
	options: CacheAuditOptions = {},
): Promise<CacheAuditRunReport> {
	if (!cacheAuditEnabled()) {
		throw new ServiceUnavailableError({
			service: 'cache-audit',
			reason: 'CACHE_AUDIT_ENABLED is false on this node',
		});
	}

	const id = await startCacheAuditRun(trigger, options);
	let report: CacheAuditReport;

	try {
		report = await auditCache(options);
	}
	catch (error) {
		await failCacheAuditRun(id, error);

		throw error;
	}

	await finishCacheAuditRun(id, report);

	return { id, ...report };
}

/**
 * Open the run's row before the first entry is examined, so a run in flight
 * is one the page can see — and a run whose process dies leaves a row with no
 * `finished_at` rather than no trace.
 */
export async function startCacheAuditRun(
	trigger: CacheAuditTrigger,
	options: CacheAuditOptions,
): Promise<number> {
	const stored: CacheAuditRunOptions = {
		limit: options.limit ?? null,
		user: options.user ?? null,
		collection: options.collection ?? null,
		purge: options.purge === true,
	};

	const [row] = await getDatabase()('directus_cache_audits')
		.insert({
			started_at: new Date(),
			trigger,
			options: JSON.stringify(stored),
		})
		.returning('id');

	// A dialect answers `returning` with the value or with a `{ id }` record.
	return typeof row === 'object' && row !== null
		? Number((row as { id: number }).id)
		: Number(row);
}

/** Close the row with what the run found, and store each finding under it. */
export async function finishCacheAuditRun(
	id: number,
	report: CacheAuditReport,
): Promise<void> {
	const db = getDatabase();

	await db.transaction(async (trx) => {
		await trx('directus_cache_audits')
			.where({ id })
			.update({
				finished_at: new Date(),
				scanned: report.scanned,
				...report.counts,
				evicted: report.evicted,
				duration_ms: report.durationMs,
			});

		const rows = report.findings.map((finding) => findingRow(id, finding));

		if (rows.length > 0) {
			await trx.batchInsert('directus_cache_audit_findings', rows, FINDINGS_BATCH);
		}
	});

	// Once per run rather than on a schedule of its own: a history that is
	// only written by runs only needs pruning when one happens.
	await reapCacheAuditRuns();
}

/** Close the row with why the run stopped, keeping the failure in the history. */
export async function failCacheAuditRun(id: number, error: unknown): Promise<void> {
	await getDatabase()('directus_cache_audits')
		.where({ id })
		.update({
			finished_at: new Date(),
			error: error instanceof Error
				? error.message
				: String(error),
		});
}

function findingRow(audit: number, finding: CacheAuditFinding) {
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
		filled_at: finding.filledAt === null
			? null
			: new Date(finding.filledAt),
		age_ms: finding.ageMs,
		tags: JSON.stringify(finding.tags),
		replay_tags: jsonOrNull(finding.replayTags),
		diff: jsonOrNull(finding.diff),
		purges_since_filled: jsonOrNull(finding.purgesSinceFilled),
	};
}

function jsonOrNull(value: unknown): string | null {
	return value === null
		? null
		: JSON.stringify(value);
}

/**
 * The runs started in the window, newest first. Without findings: a listing
 * is what a trend reads off, and the findings are read per run.
 */
export async function listCacheAuditRuns(
	windowMs?: number,
): Promise<CacheAuditRun[]> {
	const since = new Date(Date.now() - clampWindow(windowMs));

	const db = getDatabase();

	const rows: Record<string, unknown>[] = await db('directus_cache_audits')
		.where('started_at', '>', since)
		.orderBy('started_at', 'desc')
		.limit(LIST_LIMIT);

	return rows.map(runOf);
}

/** One run with everything it found, or null where no run has that id. */
export async function readCacheAuditRun(
	id: number,
): Promise<CacheAuditRunWithFindings | null> {
	const db = getDatabase();

	const row: Record<string, unknown> | undefined = await db('directus_cache_audits')
		.where({ id })
		.first();

	if (row === undefined) {
		return null;
	}

	const findingRows: Record<string, unknown>[] = await db(
		'directus_cache_audit_findings',
	)
		.where({ audit: id })
		.orderBy('id', 'asc');

	return { ...runOf(row), findings: findingRows.map(findingOf) };
}

/** Drop the runs past retention; their findings go with them. */
export async function reapCacheAuditRuns(): Promise<number> {
	const cutoff = new Date(Date.now() - retentionMs());

	return getDatabase()('directus_cache_audits')
		.where('started_at', '<', cutoff)
		.delete();
}

// A window is bounded by what the reaper leaves: asking past retention reads
// rows that are gone.
function clampWindow(requested: number | undefined): number {
	if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
		return Math.min(DEFAULT_LIST_WINDOW_MS, retentionMs());
	}

	return Math.min(requested, retentionMs());
}

function runOf(row: Record<string, unknown>): CacheAuditRun {
	const counts = {} as Record<CacheAuditVerdict, number>;

	for (const verdict of CACHE_AUDIT_VERDICTS) {
		counts[verdict] = Number(row[verdict] ?? 0);
	}

	const finishedAt = row['finished_at'];

	return {
		id: Number(row['id']),
		startedAt: new Date(row['started_at'] as string).getTime(),
		finishedAt: finishedAt === null || finishedAt === undefined
			? null
			: new Date(finishedAt as string).getTime(),
		trigger: row['trigger'] as CacheAuditTrigger,
		options: json(row['options']) as CacheAuditRunOptions,
		scanned: Number(row['scanned'] ?? 0),
		counts,
		evicted: Number(row['evicted'] ?? 0),
		durationMs: nullableNumber(row['duration_ms']),
		error: (row['error'] as string | null) ?? null,
	};
}

function findingOf(row: Record<string, unknown>): CacheAuditFinding {
	const filledAt = row['filled_at'];

	return {
		verdict: row['verdict'] as CacheAuditVerdict,
		reason: (row['reason'] as string | null) ?? null,
		redisKey: row['redis_key'] as string,
		cacheKey: (row['cache_key'] as string | null) ?? null,
		method: (row['method'] as string | null) ?? null,
		url: (row['url'] as string | null) ?? null,
		query: (row['query'] as string | null) ?? null,
		user: (row['user_id'] as string | null) ?? null,
		collection: (row['collection'] as string | null) ?? null,
		filledAt: filledAt === null || filledAt === undefined
			? null
			: new Date(filledAt as string).getTime(),
		ageMs: nullableNumber(row['age_ms']),
		tags: (json(row['tags']) as string[] | null) ?? [],
		replayTags: json(row['replay_tags']) as string[] | null,
		diff: json(row['diff']) as string[] | null,
		purgesSinceFilled: json(
			row['purges_since_filled'],
		) as CacheEntryPurgeRecord[] | null,
	};
}

function nullableNumber(value: unknown): number | null {
	return value === null || value === undefined
		? null
		: Number(value);
}

// A JSON column comes back parsed on Postgres and as text on sqlite.
function json(value: unknown): unknown {
	if (value === null || value === undefined) {
		return null;
	}

	return typeof value === 'string'
		? parseJSON(value)
		: value;
}
