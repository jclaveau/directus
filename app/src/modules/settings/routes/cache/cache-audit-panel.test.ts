import { oneLine } from '@directus/utils';
import { describe, expect, test } from 'vitest';
import {
	type CacheAuditFinding,
	type CacheAuditRun,
	describeOptions,
	findingRequest,
	findingVerdict,
	runStatus,
	scheduleDraft,
	scheduleRule,
	tagDrift,
} from './cache-audit-panel';

function run(overrides: Partial<CacheAuditRun> = {}): CacheAuditRun {
	return {
		id: 1,
		startedAt: 1_700_000_000_000,
		finishedAt: 1_700_000_000_500,
		trigger: 'rest',
		options: { limit: null, user: null, collection: null, purge: false },
		scanned: 10,
		counts: {
			fresh: 10,
			stale: 0,
			tag_drift: 0,
			raced: 0,
			time_varying: 0,
			expired: 0,
			unreplayable: 0,
		},
		evicted: 0,
		durationMs: 500,
		error: null,
		...overrides,
	};
}

function finding(overrides: Partial<CacheAuditFinding> = {}): CacheAuditFinding {
	return {
		verdict: 'stale',
		reason: null,
		redisKey: 'scalabus_response::scalabus_response:abc',
		cacheKey: 'abc',
		method: 'GET',
		url: '/items/articles?fields=title',
		query: 'fields=title',
		user: null,
		collection: 'articles',
		filledAt: 1_699_999_000_000,
		ageMs: 1_000_000,
		tags: ['articles', 'articles:1'],
		replayTags: ['articles', 'articles:1'],
		diff: ['/data/0/title'],
		purgesSinceFilled: [],
		...overrides,
	};
}

describe('runStatus', () => {
	test('a run with no end is running, whatever it has counted', () => {
		expect(runStatus(run({ finishedAt: null }))).toBe('running');
	});

	test('a run that stopped on an error is failed, whatever it counted', () => {
		const counts = { ...run().counts, stale: 3 };

		expect(runStatus(run({ error: 'redis is away', counts }))).toBe('failed');
	});

	test('a stale or drifted entry makes the run stale', () => {
		expect(runStatus(run({ counts: { ...run().counts, stale: 1 } }))).toBe('stale');

		expect(runStatus(run({ counts: { ...run().counts, tag_drift: 1 } })))
			.toBe('stale');
	});

	test('the other verdicts leave a run clean', () => {
		const counts = { ...run().counts, raced: 2, unreplayable: 1, expired: 1 };

		expect(runStatus(run({ counts }))).toBe('clean');
	});
});

describe('describeOptions', () => {
	test('says nothing for a run over the whole cache', () => {
		expect(describeOptions(run().options)).toBe('');
	});

	test('names each narrowing, collection first', () => {
		expect(describeOptions({
			limit: 50,
			user: 'u-1',
			collection: 'articles',
			purge: true,
		})).toBe('articles, user u-1, first 50, purge');
	});
});

describe('scheduleDraft / scheduleRule', () => {
	test(oneLine`
		the input starts on the stored rule only when it is the one in force
	`, () => {
		expect(scheduleDraft({
			rule: '0 3 * * *',
			source: 'settings',
			envRule: null,
			nextRunAt: 1,
		})).toBe('0 3 * * *');

		// The env rule is the placeholder's, not the input's: an empty input
		// is what says "no override".
		expect(scheduleDraft({
			rule: '0 3 * * *',
			source: 'env',
			envRule: '0 3 * * *',
			nextRunAt: 1,
		})).toBe('');

		expect(scheduleDraft(null)).toBe('');
	});

	test('a blank draft clears the override', () => {
		expect(scheduleRule('  ')).toBeNull();
		expect(scheduleRule(null)).toBeNull();
		expect(scheduleRule(' 0 4 * * * ')).toBe('0 4 * * *');
	});
});

describe('findingRequest / findingVerdict', () => {
	test('leads with the request, or the key where no descriptor says', () => {
		expect(findingRequest(finding())).toBe('GET /items/articles?fields=title');

		expect(findingRequest(finding({ method: null, url: null })))
			.toBe('scalabus_response::scalabus_response:abc');
	});

	test('qualifies the verdict with its reason', () => {
		expect(findingVerdict(finding())).toBe('stale');

		expect(findingVerdict(finding({ verdict: 'unreplayable', reason: 'user_gone' })))
			.toBe('unreplayable:user_gone');
	});
});

describe('tagDrift', () => {
	test('is unknown where the replay pinned nothing', () => {
		expect(tagDrift(finding({ replayTags: null }))).toBeNull();
	});

	test('splits a drift into what the replay added and what it dropped', () => {
		expect(tagDrift(finding({
			verdict: 'tag_drift',
			tags: ['articles', 'articles:1'],
			replayTags: ['articles', 'authors'],
		}))).toEqual({ added: ['authors'], dropped: ['articles:1'] });
	});
});
