import { useLogger } from "../logger/index.js";
import { useBus } from "../bus/lib/use-bus.js";
import "../bus/index.js";
import { scheduleSynchronizedJob, validateCron } from "../utils/schedule.js";
import { cacheAuditEnabled } from "../utils/cache-audit-enabled.js";
import { isCacheAuditInFlight, runCacheAudit } from "../cache-audit-runs.js";
import { useEnv } from "@directus/env";
import { CronExpressionParser } from "cron-parser";

//#region src/schedules/cache-audit.ts
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
const SCHEDULE_CHANGED_CHANNEL = "cacheAuditScheduleChanged";
let override = null;
let job = null;
function normaliseRule(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function envRule() {
	return normaliseRule(useEnv()["CACHE_AUDIT_SCHEDULE"]);
}
/** The rule in force: the settings override when set, else the env one. */
function resolvedCacheAuditSchedule() {
	return override ?? envRule();
}
function scheduleSource(rule) {
	if (rule === null) return null;
	return override === null ? "env" : "settings";
}
function cacheAuditScheduleState() {
	const rule = resolvedCacheAuditSchedule();
	return {
		rule,
		source: scheduleSource(rule),
		envRule: envRule(),
		nextRunAt: nextFire(rule)
	};
}
function nextFire(rule) {
	if (rule === null || !validateCron(rule)) return null;
	return CronExpressionParser.parse(rule).next().getTime();
}
/** Re-read the durable override from `directus_settings`. */
async function refreshCacheAuditScheduleOverride() {
	const { default: getDatabase } = await import("../database/index.js");
	override = normaliseRule((await getDatabase().select("cache_audit_schedule").from("directus_settings").first())?.cache_audit_schedule);
}
async function runOnce() {
	const logger = useLogger();
	try {
		const report = await runCacheAudit("cron");
		const summary = `${report.scanned} entries in ${report.durationMs}ms: ${report.counts.stale} stale, ${report.counts.tag_drift} drifted, ${report.counts.unreplayable} unreplayable`;
		if (report.counts.stale > 0 || report.counts.tag_drift > 0) logger.warn(`[cache-audit] ${summary}`);
		else logger.info(`[cache-audit] ${summary}`);
	} catch (err) {
		if (isCacheAuditInFlight(err)) {
			logger.info(`[cache-audit] tick skipped: ${err.extensions.reason}`);
			return;
		}
		logger.warn(err, `[cache-audit] run failed. ${err.message}`);
	}
}
/**
* Put the resolved rule in force: drop whatever job runs, and schedule the
* rule if there is one. Returns whether an audit is now scheduled.
*/
async function applyCacheAuditSchedule() {
	const logger = useLogger();
	await job?.stop();
	job = null;
	const rule = resolvedCacheAuditSchedule();
	if (rule === null || !cacheAuditEnabled()) return false;
	if (!validateCron(rule)) {
		logger.warn(`[cache-audit] CACHE_AUDIT_SCHEDULE is not a cron rule (${rule}) — the audit stays off`);
		return false;
	}
	job = scheduleSynchronizedJob("cache-audit", rule, runOnce);
	return true;
}
async function schedule() {
	try {
		await refreshCacheAuditScheduleOverride();
	} catch {}
	useBus().subscribe(SCHEDULE_CHANGED_CHANNEL, async ({ rule }) => {
		override = normaliseRule(rule);
		await applyCacheAuditSchedule();
	});
	const { default: emitter } = await import("../emitter.js");
	emitter.onAction("settings.update", ({ payload }) => {
		if (!payload || "cache_audit_schedule" in payload === false) return;
		useBus().publish(SCHEDULE_CHANGED_CHANNEL, { rule: normaliseRule(payload["cache_audit_schedule"]) });
	});
	return applyCacheAuditSchedule();
}

//#endregion
export { cacheAuditScheduleState, schedule as default, refreshCacheAuditScheduleOverride, resolvedCacheAuditSchedule };