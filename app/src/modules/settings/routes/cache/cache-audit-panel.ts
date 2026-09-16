export type CacheAuditVerdict =
	| 'fresh'
	| 'stale'
	| 'tag_drift'
	| 'raced'
	| 'time_varying'
	| 'expired'
	| 'unreplayable';

export type CacheAuditTrigger = 'rest' | 'cli' | 'cron' | 'mcp';

/** One recorded run, as `GET /utils/cache/audits` answers it. */
export interface CacheAuditRun {
	id: number;
	startedAt: number;
	finishedAt: number | null;
	trigger: CacheAuditTrigger;
	options: {
		limit: number | null;
		user: string | null;
		collection: string | null;
		purge: boolean;
	};
	scanned: number;
	counts: Record<CacheAuditVerdict, number>;
	evicted: number;
	durationMs: number | null;
	error: string | null;
}

/** A purge that covered a finding's entry since it was filled. */
export interface CacheAuditPurge {
	time: number;
	mode: string;
	collection: string | null;
}

/** One entry a run did not judge fresh, as `GET /utils/cache/audits/:id` answers. */
export interface CacheAuditFinding {
	verdict: CacheAuditVerdict;
	reason: string | null;
	redisKey: string;
	cacheKey: string | null;
	method: string | null;
	url: string | null;
	query: string | null;
	user: string | null;
	collection: string | null;
	filledAt: number | null;
	ageMs: number | null;
	tags: string[];
	replayTags: string[] | null;
	diff: string[] | null;
	purgesSinceFilled: CacheAuditPurge[] | null;
}

export interface CacheAuditRunWithFindings extends CacheAuditRun {
	findings: CacheAuditFinding[];
}

/** The schedule, as `GET /utils/cache/audit/schedule` answers it. */
export interface CacheAuditSchedule {
	rule: string | null;
	source: 'settings' | 'env' | null;
	envRule: string | null;
	nextRunAt: number | null;
}

/**
 * What a run row leads with. `running` outranks everything (nothing is known
 * yet), `failed` outranks the counts (they are what the run got to before it
 * stopped), and a run that found nothing wrong is `clean`.
 */
export type CacheAuditRunStatus = 'running' | 'failed' | 'stale' | 'clean';

export function runStatus(run: CacheAuditRun): CacheAuditRunStatus {
	if (run.finishedAt === null) {
		return 'running';
	}

	if (run.error !== null) {
		return 'failed';
	}

	return run.counts.stale > 0 || run.counts.tag_drift > 0
		? 'stale'
		: 'clean';
}

/** The verdicts a run row reports beside its status, non-fresh only. */
export const REPORTED_VERDICTS: Exclude<CacheAuditVerdict, 'fresh'>[] = [
	'stale',
	'tag_drift',
	'raced',
	'time_varying',
	'expired',
	'unreplayable',
];

/**
 * The narrowing a run was asked for, as one short line — empty for a run over
 * the whole cache, so the table's column stays quiet for the common case.
 */
export function describeOptions(options: CacheAuditRun['options']): string {
	const parts: string[] = [];

	if (options.collection !== null) {
		parts.push(options.collection);
	}

	if (options.user !== null) {
		parts.push(`user ${options.user}`);
	}

	if (options.limit !== null) {
		parts.push(`first ${options.limit}`);
	}

	if (options.purge) {
		parts.push('purge');
	}

	return parts.join(', ');
}

/**
 * The schedule input's draft: the stored setting when one is in force, else
 * empty so the placeholder shows what the environment says.
 */
export function scheduleDraft(schedule: CacheAuditSchedule | null): string {
	return schedule?.source === 'settings'
		? schedule.rule ?? ''
		: '';
}

/** The rule a saved draft stores: a trimmed cron, or null to clear the override. */
export function scheduleRule(draft: string): string | null {
	const trimmed = draft.trim();

	return trimmed === ''
? null
: trimmed;
}

/**
 * A finding's request, the way the CLI prints it: what was asked, or the key
 * where nothing says (an entry filled while stats were off has no descriptor).
 */
export function findingRequest(finding: CacheAuditFinding): string {
	if (finding.method === null || finding.url === null) {
		return finding.redisKey;
	}

	return `${finding.method} ${finding.url}`;
}

/** The verdict, with its reason where one qualifies it: `unreplayable:user_gone`. */
export function findingVerdict(finding: CacheAuditFinding): string {
	return finding.reason === null
		? finding.verdict
		: `${finding.verdict}:${finding.reason}`;
}

/**
 * The tags a replay pinned that the fill did not, and the other way round —
 * the two halves a tag drift is made of.
 */
export function tagDrift(
	finding: CacheAuditFinding,
): { added: string[]; dropped: string[] } | null {
	if (finding.replayTags === null) {
		return null;
	}

	const filled = new Set(finding.tags);
	const replayed = new Set(finding.replayTags);

	return {
		added: finding.replayTags.filter((tag) => !filled.has(tag)),
		dropped: finding.tags.filter((tag) => !replayed.has(tag)),
	};
}
