import { oneLine } from '@directus/utils';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';

const notified = vi.hoisted(() => {
	return { notify: vi.fn() };
});

vi.mock('@/utils/notify', () => {
	return { notify: notified.notify };
});

vi.mock('@/api', () => {
	return {
		default: {
			get: vi.fn(),
			patch: vi.fn(),
			post: vi.fn(),
		},
	};
});

// `v-drawer` traps focus while open; jsdom has nothing tabbable to hold.
vi.mock('@vueuse/integrations/useFocusTrap', () => {
	return {
		useFocusTrap: () => {
			return { activate: vi.fn(), deactivate: vi.fn() };
		},
	};
});

import { createMemoryHistory, createRouter } from 'vue-router';
import api from '@/api';
import VButton from '@/components/v-button.vue';
import VCheckbox from '@/components/v-checkbox.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VInput from '@/components/v-input.vue';
import VNotice from '@/components/v-notice.vue';
import VTable from '@/components/v-table/v-table.vue';
import type { CacheAuditRun, CacheAuditSchedule } from './cache-audit-panel';
import CacheAuditPanel from './cache-audit-panel.vue';

const router = createRouter({
	history: createMemoryHistory(),
	routes: [{ path: '/', component: { template: '<div />' } }],
});

const global = {
	plugins: [i18n, router],
	directives: {
		tooltip: {
			mounted: (el: any, binding: any) => el.setAttribute('title', binding.value),
			updated: (el: any, binding: any) => el.setAttribute('title', binding.value),
			unmounted: () => undefined,
		},
	},
	components: { VButton, VCheckbox, VIcon, VInput, VNotice, VTable },
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const real = [
					'v-button',
					'v-checkbox',
					'v-icon',
					'v-input',
					'v-notice',
					'v-table',
				];

				return tag.includes('-') && !real.includes(tag);
			},
		},
	},
};

function run(overrides: Partial<CacheAuditRun> = {}): CacheAuditRun {
	return {
		id: 7,
		startedAt: Date.UTC(2026, 8, 16, 3, 0, 0),
		finishedAt: Date.UTC(2026, 8, 16, 3, 0, 2),
		trigger: 'cron',
		options: { limit: null, user: null, collection: null, purge: false },
		scanned: 12,
		counts: {
			fresh: 10,
			stale: 1,
			tag_drift: 1,
			raced: 0,
			time_varying: 0,
			expired: 0,
			unreplayable: 0,
		},
		evicted: 0,
		durationMs: 2000,
		error: null,
		...overrides,
	};
}

const envSchedule: CacheAuditSchedule = {
	rule: '0 */10 * * * *',
	source: 'env',
	envRule: '0 */10 * * * *',
	nextRunAt: Date.UTC(2026, 8, 16, 4, 0, 0),
};

function answer(schedule: CacheAuditSchedule | null, runs: CacheAuditRun[]) {
	vi.mocked(api.get).mockImplementation(((url: string) => {
		if (url === '/utils/cache/audit/schedule') {
			return Promise.resolve({ data: { data: schedule } });
		}

		if (url === '/utils/cache/audits') {
			return Promise.resolve({ data: { data: runs } });
		}

		if (url.startsWith('/utils/cache/audits/')) {
			const id = Number(url.split('/').pop());
			const found = runs.find((candidate) => candidate.id === id)!;

			return Promise.resolve({
				data: {
					data: {
						...found,
						findings: [
							{
								verdict: 'stale',
								reason: null,
								redisKey: 'scalabus_response::scalabus_response:abc',
								cacheKey: 'abc',
								method: 'GET',
								url: '/items/articles?fields=title',
								query: 'fields=title',
								user: null,
								collection: 'articles',
								filledAt: found.startedAt - 60_000,
								ageMs: 60_000,
								tags: ['articles'],
								replayTags: ['articles'],
								diff: ['/data/0/title'],
								purgesSinceFilled: [],
							},
							{
								verdict: 'tag_drift',
								reason: null,
								redisKey: 'scalabus_response::scalabus_response:def',
								cacheKey: 'def',
								method: 'GET',
								url: '/items/articles?fields=author.name',
								query: 'fields=author.name',
								user: 'u-1',
								collection: 'articles',
								filledAt: found.startedAt - 60_000,
								ageMs: 60_000,
								tags: ['articles'],
								replayTags: ['articles', 'authors'],
								diff: null,
								purgesSinceFilled: null,
							},
						],
					},
				},
			});
		}

		return Promise.reject(new Error(`unexpected GET ${url}`));
	}) as never);
}

async function mounted() {
	const wrapper = mount(CacheAuditPanel, { global, attachTo: document.body });
	await flushPromises();

	return wrapper;
}

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('the schedule', () => {
	test('shows the env rule as the placeholder and when it next fires', async () => {
		answer(envSchedule, []);

		const wrapper = await mounted();
		const input = wrapper.find('.schedule-input input');

		expect((input.element as HTMLInputElement).value).toBe('');
		expect(input.attributes('placeholder')).toBe('Env: 0 */10 * * * *');
		expect(wrapper.find('.next-run').text()).toContain('Next run');

		wrapper.unmount();
	});

	test('starts on the stored rule when the setting is in force', async () => {
		answer(
			{ ...envSchedule, rule: '0 3 * * *', source: 'settings' },
			[],
		);

		const wrapper = await mounted();

		expect((wrapper.find('.schedule-input input').element as HTMLInputElement).value)
			.toBe('0 3 * * *');

		wrapper.unmount();
	});

	test('says so when nothing is scheduled', async () => {
		answer({ rule: null, source: null, envRule: null, nextRunAt: null }, []);

		const wrapper = await mounted();

		expect(wrapper.find('.schedule-input input').attributes('placeholder'))
			.toBe('Cron e.g. 0 3 * * *');

		expect(wrapper.find('.next-run').text()).toBe('No audit scheduled');

		wrapper.unmount();
	});

	test(oneLine`
		writes the rule through the schedule route and takes the answer
	`, async () => {
		answer(envSchedule, []);

		vi.mocked(api.patch).mockResolvedValue({
			data: {
				data: {
					rule: '0 4 * * *',
					source: 'settings',
					envRule: '0 */10 * * * *',
					nextRunAt: Date.UTC(2026, 8, 17, 4, 0, 0),
				},
			},
		});

		const wrapper = await mounted();
		const input = wrapper.find('.schedule-input input');

		await input.setValue('0 4 * * *');
		await input.trigger('keydown', { key: 'Enter' });
		await flushPromises();

		expect(api.patch).toHaveBeenCalledWith(
			'/utils/cache/audit/schedule',
			{ rule: '0 4 * * *' },
		);

		expect(wrapper.find('.next-run').text()).toContain('Next run');

		// Saved: the check is disabled again until the next edit.
		expect(wrapper.find('.schedule-input .append .v-icon').attributes('disabled'))
			.toBeDefined();

		wrapper.unmount();
	});

	test('a blank input clears the override', async () => {
		answer({ ...envSchedule, rule: '0 3 * * *', source: 'settings' }, []);
		vi.mocked(api.patch).mockResolvedValue({ data: { data: envSchedule } });

		const wrapper = await mounted();
		const input = wrapper.find('.schedule-input input');

		// Emptied, not blanked: `v-input` hands an empty field back as null,
		// which is what the browser sends when the rule is deleted.
		await input.setValue('');
		await input.trigger('keydown', { key: 'Enter' });
		await flushPromises();

		expect(api.patch).toHaveBeenCalledWith(
			'/utils/cache/audit/schedule',
			{ rule: null },
		);

		wrapper.unmount();
	});

	test('a refused rule is reported and the input keeps the draft', async () => {
		answer(envSchedule, []);

		vi.mocked(api.patch).mockRejectedValue({
			response: {
				data: {
					errors: [{ message: 'Invalid cache_audit_schedule "hourly"' }],
				},
			},
		});

		const wrapper = await mounted();
		const input = wrapper.find('.schedule-input input');

		await input.setValue('hourly');
		await input.trigger('keydown', { key: 'Enter' });
		await flushPromises();

		expect(notified.notify).toHaveBeenCalledWith({
			type: 'error',
			title: 'Invalid cache_audit_schedule "hourly"',
		});

		expect((input.element as HTMLInputElement).value).toBe('hourly');

		wrapper.unmount();
	});
});

describe('the runs', () => {
	test('lists each run with its status and counts', async () => {
		answer(envSchedule, [
			run(),
			run({
				id: 6,
				trigger: 'rest',
				counts: { ...run().counts, stale: 0, tag_drift: 0 },
				options: { limit: 20, user: null, collection: 'articles', purge: true },
			}),
			run({ id: 5, finishedAt: null, durationMs: null, scanned: 0 }),
			run({ id: 4, error: 'redis is away' }),
		]);

		const wrapper = await mounted();
		const statuses = wrapper.findAll('.status').map((node) => node.text());

		expect(statuses).toEqual(['Stale', 'Clean', 'Running', 'Failed']);

		// Every column between the start stamp and the trailing spacer cell.
		const cells = (row: number) => {
			return wrapper.findAll('.audit-table tbody tr')[row]!
				.findAll('td')
				.map((cell) => cell.text())
				.slice(0, -1);
		};

		expect(cells(0).slice(1)).toEqual([
			'Stale', 'cron', '12', '1', '1', '0', '2s', '—',
		]);

		expect(cells(1).slice(1)).toEqual([
			'Clean', 'rest', '12', '0', '0', '0', '2s', 'articles, first 20, purge',
		]);

		expect(cells(2).slice(1)).toEqual([
			'Running', 'cron', '0', '1', '1', '0', '—', '—',
		]);

		wrapper.unmount();
	});

	test('says so when nothing ran', async () => {
		answer(envSchedule, []);

		const wrapper = await mounted();

		expect(wrapper.find('.v-notice').text()).toContain('No audit ran');
		expect(wrapper.find('.audit-table').exists()).toBe(false);

		wrapper.unmount();
	});

	test('runs an audit now, with the purge asked for, and reloads', async () => {
		answer(envSchedule, []);
		vi.mocked(api.post).mockResolvedValue({ data: { data: { id: 8 } } });

		const wrapper = await mounted();

		await wrapper.find('.purge-toggle').trigger('click');
		await wrapper.find('.v-button button').trigger('click');
		await flushPromises();

		expect(api.post).toHaveBeenCalledWith('/utils/cache/audit', { purge: true });
		expect(wrapper.emitted('audited')).toHaveLength(1);

		// The listing is read again once the run answered.
		const reads = vi.mocked(api.get).mock.calls
			.filter(([url]) => url === '/utils/cache/audits');

		expect(reads)
			.toHaveLength(2);

		wrapper.unmount();
	});

	test('a run that fails is reported in place', async () => {
		answer(envSchedule, []);

		vi.mocked(api.post).mockRejectedValue({
			response: { data: { errors: [{ message: 'Redis is away' }] } },
		});

		const wrapper = await mounted();

		await wrapper.find('.v-button button').trigger('click');
		await flushPromises();

		expect(wrapper.find('.v-notice').text()).toBe('Redis is away');

		wrapper.unmount();
	});

	test('polls while a run is in flight, and stops once it ends', async () => {
		const inFlight = run({ id: 5, finishedAt: null, durationMs: null });
		answer(envSchedule, [inFlight]);

		const wrapper = await mounted();

		answer(envSchedule, [run({ id: 5 })]);
		vi.advanceTimersByTime(5000);
		await flushPromises();

		expect(wrapper.find('.status').text()).toBe('Stale');

		const reads = vi.mocked(api.get).mock.calls.length;
		vi.advanceTimersByTime(10_000);
		await flushPromises();

		expect(vi.mocked(api.get).mock.calls.length).toBe(reads);

		wrapper.unmount();
	});

	test('opens a run into its findings', async () => {
		answer(envSchedule, [run()]);

		const wrapper = await mounted();

		await wrapper.find('.audit-table tbody tr, .audit-table .table-row')
			.trigger('click');

		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache/audits/7');

		const findings = document.body.querySelectorAll('.finding');

		expect(findings).toHaveLength(2);
		expect(findings[0]!.textContent).toContain('stale');
		expect(findings[0]!.textContent).toContain('GET /items/articles?fields=title');
		expect(findings[0]!.textContent).toContain('Differs at: /data/0/title');
		expect(findings[0]!.textContent).toContain('No purge covered it since the fill');
		expect(findings[1]!.textContent).toContain('Tags: +authors');
		expect(findings[1]!.textContent).toContain('User: u-1');

		wrapper.unmount();
	});
});
