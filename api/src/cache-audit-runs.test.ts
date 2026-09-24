import { oneLine } from '@directus/utils';
import { ServiceUnavailableError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	auditCache,
	type CacheAuditFinding,
	type CacheAuditReport,
} from './cache-audit.js';
import {
	failCacheAuditRun,
	finishCacheAuditRun,
	listCacheAuditRuns,
	readCacheAuditFindings,
	readCacheAuditRun,
	isCacheAuditInFlight,
	reapCacheAuditRuns,
	runCacheAudit,
	startCacheAuditRun,
} from './cache-audit-runs.js';

vi.mock('./cache-audit.js', () => {
	return {
		auditCache: vi.fn(),
		CACHE_AUDIT_VERDICTS: [
			'fresh',
			'stale',
			'pin_drift',
			'raced',
			'time_varying',
			'expired',
			'unreplayable',
		],
	};
});

const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('./database/index.js', () => ({ default: vi.fn() }));

// The in-flight claim: a Keyv with a TTL, as the lock cache is.
const lockCache = vi.hoisted(() => {
	const held = new Map<string, unknown>();

	return {
		held,
		get: vi.fn(async (key: string) => held.get(key)),
		set: vi.fn(async (key: string, value: unknown) => {
			held.set(key, value);
		}),
		delete: vi.fn(async (key: string) => held.delete(key)),
	};
});

vi.mock('./cache.js', () => ({ getCache: () => ({ lockCache }) }));

import getDatabase from './database/index.js';

let db: Knex;
let tracker: Tracker;

beforeAll(() => {
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

beforeEach(() => {
	delete env['CACHE_AUDIT_RETENTION'];
	delete env['CACHE_AUDIT_LIMIT'];
	delete env['CACHE_AUDIT_MAX_DURATION'];
	delete env['CACHE_STORE'];
	env['CACHE_AUDIT_ENABLED'] = true;
	lockCache.held.clear();
	vi.mocked(getDatabase).mockReturnValue(db);
	vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date'] });
});

afterEach(() => {
	tracker.reset();
	vi.useRealTimers();
	vi.clearAllMocks();
});

const finding: CacheAuditFinding = {
	verdict: 'stale',
	reason: null,
	redisKey: 'scalabus_response::scalabus_response:abc',
	cacheKey: 'abc',
	method: 'GET',
	url: '/items/articles',
	query: 'fields=title',
	user: 'user-1',
	collection: 'articles',
	filledAt: 1_699_999_990_000,
	ageMs: 10_000,
	pins: ['articles', 'articles:1'],
	replayPins: ['articles'],
	diff: ['/data/0/title'],
	purgesSinceFilled: [],
};

const report: CacheAuditReport = {
	scanned: 3,
	counts: {
		fresh: 1,
		stale: 1,
		pin_drift: 1,
		raced: 0,
		time_varying: 0,
		expired: 0,
		unreplayable: 0,
	},
	findings: [finding, { ...finding, verdict: 'pin_drift', diff: null }],
	evicted: 2,
	durationMs: 120,
	timedOut: false,
};

function runRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		started_at: new Date(1_700_000_000_000),
		finished_at: new Date(1_700_000_000_120),
		trigger: 'rest',
		options: { limit: null, user: null, collection: null, purge: true },
		scanned: 3,
		fresh: 1,
		stale: 1,
		pin_drift: 1,
		raced: 0,
		time_varying: 0,
		expired: 0,
		unreplayable: 0,
		evicted: 2,
		duration_ms: 120,
		timed_out: false,
		error: null,
		...overrides,
	};
}

describe('startCacheAuditRun', () => {
	it('opens the row with the trigger and the narrowing asked for', async () => {
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);

		const id = await startCacheAuditRun('cli', {
			limit: 50,
			collection: 'articles',
			purge: true,
		});

		expect(id).toBe(7);

		const [insert] = tracker.history.insert;

		expect(insert!.bindings).toEqual([
			JSON.stringify({
				limit: 50,
				user: null,
				collection: 'articles',
				purge: true,
			}),
			new Date(1_700_000_000_000),
			'cli',
		]);
	});

	// sqlite answers `returning` with the bare value, Postgres with a record.
	it('reads the id back from a bare value too', async () => {
		tracker.on.insert('directus_cache_audits').response([9]);

		expect(await startCacheAuditRun('rest', {})).toBe(9);
	});
});

describe('finishCacheAuditRun', () => {
	it(oneLine`
		closes the row with the counts and stores one row per finding, clearing
		an error a listing wrote on it while its claim was lost
	`, async () => {
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.insert('directus_cache_audit_findings').response([]);

		await finishCacheAuditRun(7, report);

		const [update] = tracker.history.update;

		expect(update!.sql).toMatch(/.error. = \?/);

		expect(update!.bindings).toEqual([
			new Date(1_700_000_000_000),
			null,
			3,
			1,
			1,
			1,
			0,
			0,
			0,
			0,
			2,
			120,
			false,
			7,
		]);

		const [insert] = tracker.history.insert;

		expect(insert!.sql).toContain('directus_cache_audit_findings');

		// Both findings in one statement, the JSON columns serialised.
		expect(insert!.bindings).toContain(JSON.stringify(['articles', 'articles:1']));
		expect(insert!.bindings).toContain(JSON.stringify(['/data/0/title']));
		expect(insert!.bindings).toContain('pin_drift');
		expect(insert!.bindings).toContainEqual(new Date(1_699_999_990_000));
		expect(insert!.bindings.filter((b) => b === 7)).toHaveLength(2);

		// Pruning the history is the run's, so a failed run prunes too.
		expect(tracker.history.delete).toHaveLength(0);
	});

	it('stores no finding row for a clean run', async () => {
		tracker.on.update('directus_cache_audits').response(1);

		await finishCacheAuditRun(7, { ...report, findings: [] });

		expect(tracker.history.insert).toHaveLength(0);
	});
});

describe('failCacheAuditRun', () => {
	it('closes the row with why it stopped', async () => {
		tracker.on.update('directus_cache_audits').response(1);

		await failCacheAuditRun(7, new Error('redis is away'));

		expect(tracker.history.update[0]!.bindings)
			.toEqual([new Date(1_700_000_000_000), 'redis is away', 7]);
	});

	it('keeps a thrown non-error as text', async () => {
		tracker.on.update('directus_cache_audits').response(1);

		await failCacheAuditRun(7, 'boom');

		expect(tracker.history.update[0]!.bindings).toContain('boom');
	});
});

describe('runCacheAudit', () => {
	it(oneLine`
		records the run around the engine and answers the report with its id
	`, async () => {
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.insert('directus_cache_audit_findings').response([]);
		tracker.on.delete('directus_cache_audits').response(0);
		vi.mocked(auditCache).mockResolvedValue(report);

		const answered = await runCacheAudit('mcp', { limit: 5 });

		expect(answered).toEqual({ id: 7, ...report });

		expect(auditCache).toHaveBeenCalledWith({
			limit: 5,
			maxDurationMs: 600_000,
		});

		expect(tracker.history.insert[0]!.bindings).toContain('mcp');
		// The close, then the orphan sweep; then the history is pruned.
		expect(tracker.history.update).toHaveLength(2);
		expect(tracker.history.delete).toHaveLength(1);
	});

	it(oneLine`
		holds the run's claim for two minutes at a time, renewed every 30s while
		it runs whatever its budget, and lets it go after
	`, async () => {
		vi.useRealTimers();

		vi.useFakeTimers({
			now: 1_700_000_000_000,
			toFake: ['Date', 'setInterval', 'clearInterval'],
		});

		env['CACHE_AUDIT_MAX_DURATION'] = '2h';
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.insert('directus_cache_audit_findings').response([]);
		tracker.on.delete('directus_cache_audits').response(0);

		// A renewal takes a round trip: the release has to wait for it, or the
		// claim it renews outlives the run by a TTL.
		const landed: Array<() => void> = [];

		lockCache.set.mockImplementation(async (key, value) => {
			if (lockCache.held.has(key)) {
				await new Promise<void>((resolve) => landed.push(resolve));
			}

			lockCache.held.set(key, value);
		});

		vi.mocked(auditCache).mockImplementation(async () => {
			expect(lockCache.held.get('cache-audit:run')).toBe(1_700_000_000_000);
			expect(lockCache.set).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(90_000);

			expect(lockCache.set).toHaveBeenCalledTimes(4);

			return report;
		});

		const run = runCacheAudit('rest');
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(lockCache.delete).not.toHaveBeenCalled();

		for (const land of landed) {
			land();
		}

		await run;

		expect(lockCache.delete).toHaveBeenCalledWith('cache-audit:run');

		expect(auditCache).toHaveBeenCalledWith({
			limit: undefined,
			maxDurationMs: 7_200_000,
		});

		expect(lockCache.set)
			.toHaveBeenCalledWith('cache-audit:run', 1_700_000_000_000, 120_000);

		expect(lockCache.delete).toHaveBeenCalledWith('cache-audit:run');
		expect(lockCache.held.has('cache-audit:run')).toBe(false);

		// Let go with the claim: no renewal outlives the run.
		vi.advanceTimersByTime(90_000);
		expect(lockCache.set).toHaveBeenCalledTimes(4);
	});

	it('refuses a run while another is in flight, before any row', async () => {
		lockCache.held.set('cache-audit:run', 1_699_999_940_000);

		await expect(runCacheAudit('rest')).rejects.toThrow(
			'a cache audit is already running, since 2023-11-14T22:12:20.000Z',
		);

		expect(auditCache).not.toHaveBeenCalled();
		expect(tracker.history.insert).toHaveLength(0);
		// The refused ask leaves the claim to the run that holds it.
		expect(lockCache.delete).not.toHaveBeenCalled();
	});

	it(oneLine`
		lets the claim go when the engine throws, and takes the default budget
		over a zero
	`, async () => {
		env['CACHE_AUDIT_MAX_DURATION'] = '0';
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);
		tracker.on.update('directus_cache_audits').response(1);
		vi.mocked(auditCache).mockRejectedValue(new Error('redis is away'));

		await expect(runCacheAudit('cron')).rejects.toThrow('redis is away');

		expect(auditCache).toHaveBeenCalledWith({
			limit: undefined,
			maxDurationMs: 600_000,
		});

		expect(lockCache.held.has('cache-audit:run')).toBe(false);
	});

	it(oneLine`
		slices a run that names no limit by CACHE_AUDIT_LIMIT, and records the slice
	`, async () => {
		env['CACHE_AUDIT_LIMIT'] = 250;
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.insert('directus_cache_audit_findings').response([]);
		tracker.on.delete('directus_cache_audits').response(0);
		vi.mocked(auditCache).mockResolvedValue(report);

		await runCacheAudit('cron');

		expect(auditCache)
			.toHaveBeenCalledWith(expect.objectContaining({ limit: 250 }));

		expect(JSON.parse(tracker.history.insert[0]!.bindings[0] as string))
			.toMatchObject({ limit: 250 });
	});

	it(oneLine`
		leaves a run its own limit, and the whole queue when the env says 0
	`, async () => {
		env['CACHE_AUDIT_LIMIT'] = 250;
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.insert('directus_cache_audit_findings').response([]);
		tracker.on.delete('directus_cache_audits').response(0);
		vi.mocked(auditCache).mockResolvedValue(report);

		await runCacheAudit('rest', { limit: 5 });

		expect(auditCache)
			.toHaveBeenLastCalledWith(expect.objectContaining({ limit: 5 }));

		env['CACHE_AUDIT_LIMIT'] = 0;
		await runCacheAudit('rest');

		expect(auditCache)
			.toHaveBeenLastCalledWith(expect.objectContaining({ limit: undefined }));
	});

	it('refuses on a node with CACHE_AUDIT_ENABLED off, before any row', async () => {
		env['CACHE_AUDIT_ENABLED'] = false;

		await expect(runCacheAudit('rest')).rejects.toThrow(
			'CACHE_AUDIT_ENABLED is false on this node',
		);

		expect(auditCache).not.toHaveBeenCalled();
		expect(tracker.history.insert).toHaveLength(0);
	});

	it(oneLine`
		records the failure and rethrows when the engine throws, and still prunes
		the history
	`, async () => {
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.delete('directus_cache_audits').response(0);
		vi.mocked(auditCache).mockRejectedValue(new Error('redis is away'));

		await expect(runCacheAudit('cron')).rejects.toThrow('redis is away');

		expect(tracker.history.update[0]!.bindings).toContain('redis is away');
		expect(tracker.history.insert).toHaveLength(1);
		expect(tracker.history.delete).toHaveLength(1);
	});

	it(oneLine`
		records the failure when it is the close that fails, so a run that
		audited but could not store its findings is not left in flight
	`, async () => {
		tracker.on.insert('directus_cache_audits').response([{ id: 7 }]);
		tracker.on.update('directus_cache_audits').response(1);

		tracker.on.insert('directus_cache_audit_findings')
			.simulateError('disk full');

		tracker.on.delete('directus_cache_audits').response(0);
		vi.mocked(auditCache).mockResolvedValue(report);

		await expect(runCacheAudit('rest')).rejects.toThrow('disk full');

		// The close's update, then the failure's, then the orphan sweep.
		expect(tracker.history.update).toHaveLength(3);

		expect(tracker.history.update[1]!.bindings)
			.toContainEqual(expect.stringContaining('disk full'));

		expect(lockCache.held.has('cache-audit:run')).toBe(false);
	});
});

describe('isCacheAuditInFlight', () => {
	it('tells the refusal for a run in flight from any other failure', async () => {
		lockCache.held.set('cache-audit:run', 1_699_999_940_000);

		const refused = await runCacheAudit('rest').catch((error) => error);

		expect(isCacheAuditInFlight(refused)).toBe(true);
		expect(isCacheAuditInFlight(new Error('redis is away'))).toBe(false);

		expect(isCacheAuditInFlight(new ServiceUnavailableError({
			service: 'cache-audit',
			reason: 'something else',
		}))).toBe(false);
	});
});

describe('listCacheAuditRuns', () => {
	it('answers the runs of the last 7 days by default, newest first', async () => {
		tracker.on.select('directus_cache_audits').response([runRow()]);

		const runs = await listCacheAuditRuns();

		expect(runs).toEqual([
			{
				id: 7,
				startedAt: 1_700_000_000_000,
				finishedAt: 1_700_000_000_120,
				trigger: 'rest',
				options: { limit: null, user: null, collection: null, purge: true },
				scanned: 3,
				counts: {
					fresh: 1,
					stale: 1,
					pin_drift: 1,
					raced: 0,
					time_varying: 0,
					expired: 0,
					unreplayable: 0,
				},
				evicted: 2,
				durationMs: 120,
				timedOut: false,
				error: null,
			},
		]);

		const [select] = tracker.history.select;

		expect(select!.sql).toMatch(/order by .started_at. desc/);

		expect(select!.bindings)
			.toEqual([new Date(1_700_000_000_000 - 604_800_000), 200]);
	});

	it('clamps the window to retention', async () => {
		env['CACHE_AUDIT_RETENTION'] = '1d';
		tracker.on.select('directus_cache_audits').response([]);

		await listCacheAuditRuns(30 * 86_400_000);

		expect(tracker.history.select[0]!.bindings[0])
			.toEqual(new Date(1_700_000_000_000 - 86_400_000));
	});

	it('reads a run still in flight, and a failed one', async () => {
		tracker.on.select('directus_cache_audits').response([
			runRow({ finished_at: null, duration_ms: null, scanned: 0 }),
			runRow({ id: 6, error: 'redis is away' }),
		]);

		const runs = await listCacheAuditRuns();

		expect(runs[0])
			.toMatchObject({ finishedAt: null, durationMs: null, scanned: 0 });

		expect(runs[1]).toMatchObject({ id: 6, error: 'redis is away' });
	});

	it(oneLine`
		closes a run left open with no claim behind it before answering: its
		process died, and the page would otherwise wait on it for the reap's grace
	`, async () => {
		env['CACHE_STORE'] = 'redis';
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.select('directus_cache_audits').response([]);

		await listCacheAuditRuns();

		const [closed] = tracker.history.update;

		expect(closed!.sql).toMatch(/where .finished_at. is null/);
		expect(closed!.sql).toMatch(/.started_at. </);

		expect(closed!.bindings).toEqual([
			new Date(1_700_000_000_000),
			'The run did not finish: its process died',
			new Date(1_700_000_000_000 - 5000),
		]);
	});

	it('leaves an open run alone while its claim is held', async () => {
		env['CACHE_STORE'] = 'redis';
		lockCache.held.set('cache-audit:run', 1_699_999_999_000);
		tracker.on.select('directus_cache_audits').response([]);

		await listCacheAuditRuns();

		expect(tracker.history.update).toHaveLength(0);
	});

	it('leaves it to the reap where the claim is one per process', async () => {
		env['CACHE_STORE'] = 'memory';
		tracker.on.select('directus_cache_audits').response([]);

		await listCacheAuditRuns();

		expect(lockCache.get).not.toHaveBeenCalled();
		expect(tracker.history.update).toHaveLength(0);
	});

	// sqlite hands a JSON column back as text.
	it('parses the options stored as text', async () => {
		tracker.on.select('directus_cache_audits').response([
			runRow({
				options: JSON.stringify({
					limit: 5,
					user: null,
					collection: null,
					purge: false,
				}),
			}),
		]);

		const [run] = await listCacheAuditRuns();

		expect(run!.options)
			.toEqual({ limit: 5, user: null, collection: null, purge: false });
	});
});

describe('readCacheAuditRun', () => {
	it('answers the run as the listing carries it, without findings', async () => {
		tracker.on.select('directus_cache_audits').response([runRow()]);

		const run = await readCacheAuditRun(7);

		expect(run).toMatchObject({ id: 7, trigger: 'rest' });
		expect(run).not.toHaveProperty('findings');
		expect(tracker.history.select).toHaveLength(1);
		expect(tracker.history.select[0]!.bindings).toEqual([7, 1]);
	});

	// sqlite stores a boolean as 0/1.
	it('reads a timed-out run off either boolean spelling', async () => {
		tracker.on.select('directus_cache_audits')
			.response([runRow({ timed_out: 1 })]);

		expect((await readCacheAuditRun(7))?.timedOut).toBe(true);

		tracker.on.select('directus_cache_audits')
			.response([runRow({ timed_out: true })]);

		expect((await readCacheAuditRun(7))?.timedOut).toBe(true);
	});

	it('answers null where no run has the id', async () => {
		tracker.on.select('directus_cache_audits').response([]);

		expect(await readCacheAuditRun(404)).toBeNull();
		expect(tracker.history.select).toHaveLength(1);
	});
});

describe('readCacheAuditFindings', () => {
	it('answers a page of findings as the report carried them', async () => {
		// Narrower first: both statements read the findings table.
		tracker.on.select('count("id") as "total"').response([{ total: '41' }]);

		tracker.on.select('directus_cache_audit_findings').response([
			{
				id: 1,
				audit: 7,
				verdict: 'stale',
				reason: null,
				redis_key: finding.redisKey,
				cache_key: 'abc',
				method: 'GET',
				url: '/items/articles',
				query: 'fields=title',
				user_id: 'user-1',
				collection: 'articles',
				filled_at: new Date(1_699_999_990_000),
				age_ms: 10_000,
				tags: JSON.stringify(['articles', 'articles:1']),
				replay_pins: ['articles'],
				diff: JSON.stringify(['/data/0/title']),
				purges_since_filled: '[]',
			},
			{
				id: 2,
				audit: 7,
				verdict: 'unreplayable',
				reason: 'status_503',
				redis_key: 'def',
				cache_key: 'def',
				method: 'GET',
				url: '/server/info',
				query: '',
				user_id: null,
				collection: null,
				filled_at: new Date(1_699_999_990_000),
				age_ms: 10_000,
				tags: '[]',
				replay_pins: null,
				diff: null,
				purges_since_filled: null,
			},
		]);

		const page = await readCacheAuditFindings(7, { limit: 100, offset: 0 });

		expect(page.findingsTotal).toBe(41);

		expect(page.findings).toEqual([
			finding,
			{
				verdict: 'unreplayable',
				reason: 'status_503',
				redisKey: 'def',
				cacheKey: 'def',
				method: 'GET',
				url: '/server/info',
				query: '',
				user: null,
				collection: null,
				filledAt: 1_699_999_990_000,
				ageMs: 10_000,
				pins: [],
				replayPins: null,
				diff: null,
				purgesSinceFilled: null,
			},
		]);

		const [rows, count] = tracker.history.select;
		// Knex drops an offset of 0 from the statement.
		expect(rows!.sql).toContain('order by "id" asc limit ?');
		expect(rows!.bindings).toEqual([7, 100]);
		// The total counts what the page is cut from, under the same narrowing.
		expect(count!.sql).toContain('count("id") as "total"');
		expect(count!.bindings).toEqual([7, 1]);
	});

	it('walks the findings by offset, keeping to one verdict when asked', async () => {
		tracker.on.select('count("id") as "total"').response([{ total: 0 }]);
		tracker.on.select('directus_cache_audit_findings').response([]);

		const page = await readCacheAuditFindings(7, {
			limit: 10,
			offset: 30,
			verdict: 'pin_drift',
		});

		expect(page).toEqual({ findings: [], findingsTotal: 0 });

		const [rows, count] = tracker.history.select;
		expect(rows!.sql).toContain('"verdict" = ?');
		expect(rows!.bindings).toEqual([7, 'pin_drift', 10, 30]);
		expect(count!.bindings).toEqual([7, 'pin_drift', 1]);
	});
});

describe('reapCacheAuditRuns', () => {
	it('drops the runs started before retention, 30 days by default', async () => {
		tracker.on.update('directus_cache_audits').response(0);
		tracker.on.delete('directus_cache_audits').response(3);

		expect(await reapCacheAuditRuns()).toBe(3);

		expect(tracker.history.delete[0]!.bindings)
			.toEqual([new Date(1_700_000_000_000 - 2_592_000_000)]);
	});

	it(oneLine`
		closes a run left open twice its budget and an hour ago as one whose
		process died, before pruning
	`, async () => {
		env['CACHE_AUDIT_MAX_DURATION'] = '10m';
		tracker.on.update('directus_cache_audits').response(1);
		tracker.on.delete('directus_cache_audits').response(0);

		await reapCacheAuditRuns();

		const [sweep] = tracker.history.update;

		expect(sweep!.sql).toMatch(/finished_at. is null/);

		expect(sweep!.bindings).toEqual([
			new Date(1_700_000_000_000),
			'The run did not finish: its process died',
			new Date(1_700_000_000_000 - 2 * 600_000 - 3_600_000),
		]);
	});

	it('takes CACHE_AUDIT_RETENTION', async () => {
		env['CACHE_AUDIT_RETENTION'] = '2h';
		tracker.on.update('directus_cache_audits').response(0);
		tracker.on.delete('directus_cache_audits').response(0);

		await reapCacheAuditRuns();

		expect(tracker.history.delete[0]!.bindings)
			.toEqual([new Date(1_700_000_000_000 - 7_200_000)]);
	});
});
