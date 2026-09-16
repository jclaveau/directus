import { useEnv } from '@directus/env';
import { CronExpressionParser } from 'cron-parser';
import { useBus } from '../bus/index.js';
import { runCacheAudit } from '../cache-audit-runs.js';
import { useLogger } from '../logger/index.js';
import {
	type ScheduledJob,
	scheduleSynchronizedJob,
	validateCron,
} from '../utils/schedule.js';

/**
 * A recurring cache audit over real traffic — dev and preview only, since a run
 * costs one uncached read per live entry. Each run lands in the audit history
 * and its `stale_entry`/`tag_drift` findings on the cache dashboard as
 * anomalies, so a missed invalidation shows up without anyone reading a log.
 *
 * The rule is `directus_settings.cache_audit_schedule` when set, else
 * `CACHE_AUDIT_SCHEDULE`, else nothing runs. The settings one is live: the
 * cache page edits it, the `settings.update` action announces it on the bus,
 * and every node drops its job and schedules the new rule (the same shape as
 * `cache-config.ts`). A node that missed the announcement re-seeds on boot.
 */

const SCHEDULE_CHANGED_CHANNEL = 'cacheAuditScheduleChanged';

interface CacheAuditScheduleChange {
	rule: string | null;
}

export interface CacheAuditScheduleState {
	/** The rule in force, or null when no audit is scheduled. */
	rule: string | null;
	/** Where that rule came from. */
	source: 'settings' | 'env' | null;
	/** What `CACHE_AUDIT_SCHEDULE` says: what a cleared setting falls back to. */
	envRule: string | null;
	nextRunAt: number | null;
}

let override: string | null = null;
let job: ScheduledJob | null = null;

// An empty or whitespace rule is "unset", so a cleared input falls through to env.
function normaliseRule(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== ''
		? value.trim()
		: null;
}

function envRule(): string | null {
	return normaliseRule(useEnv()['CACHE_AUDIT_SCHEDULE']);
}

/** The rule in force: the settings override when set, else the env one. */
export function resolvedCacheAuditSchedule(): string | null {
	return override ?? envRule();
}

function scheduleSource(rule: string | null): CacheAuditScheduleState['source'] {
	if (rule === null) {
		return null;
	}

	return override === null
		? 'env'
		: 'settings';
}

export function cacheAuditScheduleState(): CacheAuditScheduleState {
	const rule = resolvedCacheAuditSchedule();

	return {
		rule,
		source: scheduleSource(rule),
		envRule: envRule(),
		nextRunAt: nextFire(rule),
	};
}

// Off the rule rather than the job: the job is rescheduled when the bus
// message lands, and the node answering a write has not necessarily seen its
// own yet. The rule says when the next tick is whichever node wins it.
function nextFire(rule: string | null): number | null {
	if (rule === null || !validateCron(rule)) {
		return null;
	}

	return CronExpressionParser.parse(rule)
		.next()
		.getTime();
}

/** Re-read the durable override from `directus_settings`. */
export async function refreshCacheAuditScheduleOverride(): Promise<void> {
	const { default: getDatabase } = await import('../database/index.js');

	const row = await getDatabase()
		.select('cache_audit_schedule')
		.from('directus_settings')
		.first();

	override = normaliseRule(row?.cache_audit_schedule);
}

async function runOnce(): Promise<void> {
	const logger = useLogger();

	try {
		const report = await runCacheAudit('cron');

		const summary = `${report.scanned} entries in ${report.durationMs}ms: `
			+ `${report.counts.stale} stale, ${report.counts.tag_drift} drifted, `
			+ `${report.counts.unreplayable} unreplayable`;

		if (report.counts.stale > 0 || report.counts.tag_drift > 0) {
			logger.warn(`[cache-audit] ${summary}`);
		}
		else {
			logger.info(`[cache-audit] ${summary}`);
		}
	}
	catch (err: any) {
		logger.warn(err, `[cache-audit] run failed. ${err.message}`);
	}
}

/**
 * Put the resolved rule in force: drop whatever job runs, and schedule the
 * rule if there is one. Returns whether an audit is now scheduled.
 */
async function applyCacheAuditSchedule(): Promise<boolean> {
	const logger = useLogger();

	await job?.stop();
	job = null;

	const rule = resolvedCacheAuditSchedule();

	if (rule === null) {
		return false;
	}

	// The settings rule is validated before it is written; only the env one can
	// arrive malformed.
	if (!validateCron(rule)) {
		logger.warn(
			`[cache-audit] CACHE_AUDIT_SCHEDULE is not a cron rule (${rule}) `
			+ '— the audit stays off',
		);

		return false;
	}

	job = scheduleSynchronizedJob('cache-audit', rule, runOnce);

	return true;
}

export default async function schedule(): Promise<boolean> {
	// Best-effort seed: a not-yet-migrated settings table must not crash boot —
	// the env rule runs until the next change.
	try {
		await refreshCacheAuditScheduleOverride();
	}
	catch {
		// leave the override unset → the env rule
	}

	// Self-delivered too, so the node that took the write reschedules through
	// the same path as its peers.
	useBus().subscribe<CacheAuditScheduleChange>(
		SCHEDULE_CHANGED_CHANNEL,
		async ({ rule }) => {
			override = normaliseRule(rule);
			await applyCacheAuditSchedule();
		},
	);

	// Off the action rather than the settings service, so a writer that bypasses
	// the service (a config import, a seed) still reaches every node.
	const { default: emitter } = await import('../emitter.js');

	emitter.onAction('settings.update', ({ payload }) => {
		if (!payload || 'cache_audit_schedule' in payload === false) {
			return;
		}

		useBus().publish<CacheAuditScheduleChange>(SCHEDULE_CHANGED_CHANNEL, {
			rule: normaliseRule(payload['cache_audit_schedule']),
		});
	});

	return applyCacheAuditSchedule();
}
