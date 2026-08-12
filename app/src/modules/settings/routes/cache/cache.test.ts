import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return { default: { get: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

// The timeseries chart pulls in apexcharts (SVG jsdom can't drive); stub it so
// mounting the page doesn't touch a real chart — the chart isn't what these test.
// Capture the options the component hands ApexCharts so a test can drive its
// callbacks (tooltip renderer, axis formatters) without a real SVG chart.
const chartMock = vi.hoisted(() => {
	return { configs: [] as any[], hidden: [] as string[] };
});

// The page mounts two charts (counts + latency); record every config so a test can
// pick the one it wants by series name.
vi.mock('apexcharts', () => {
	return {
		default: class {
			constructor(_el: unknown, config: any) {
				chartMock.configs.push(config);
			}

			render() {
				return Promise.resolve();
			}

			updateOptions(config: any) {
				chartMock.configs.push(config);

				return Promise.resolve();
			}

			hideSeries(name: string) {
				chartMock.hidden.push(name);
			}

			destroy() {}
		},
	};
});

// The page renders once before the timeseries lands and again after, so take the
// latest matching config — the earlier one carries empty series.
function chartConfigWithSeries(firstName: string) {
	return chartMock.configs.findLast((config) => {
		return config?.series?.[0]?.name === firstName;
	});
}

vi.mock('@/utils/get-root-path', () => {
	return { getRootPath: () => '/admin/' };
});

vi.mock('@/utils/notify', () => {
	return { notify: vi.fn() };
});

import api from '@/api';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import CachePage from './cache.vue';

const ENTRIES = [
	{
		key: 'app-key-000000000000',
		redisKey: 'app-redis-key',
		coarse: true,
		method: 'GET',
		path: '/items/articles',
		collection: 'articles',
		user: { id: 'u1', email: 'ann@corp.io' },
		query: '{"limit":5}',
		url: '/items/articles?limit=5',
		size: 2048,
		hits: 7,
		misses: 2,
		fills: 3,
		fillMs: 240,
		hitMs: 2,
		ttlMs: 60000,
		recommendedTtlMs: 90000,
		createdAt: Date.now() - 5000,
		expiresAt: Date.now() + 60000,
		lastHitAt: Date.now() - 1000,
	},
	{
		key: 'bob-key-000000000000',
		redisKey: 'bob-redis-key',
		coarse: false,
		method: 'GET',
		path: '/items/comments',
		collection: 'comments',
		user: { id: 'u2', email: 'bob@corp.io' },
		query: '{}',
		url: '/items/comments',
		size: 512,
		hits: 3,
		misses: 1,
		fills: 1,
		fillMs: 90,
		hitMs: 1,
		ttlMs: 30000,
		recommendedTtlMs: 10000,
		createdAt: Date.now() - 8000,
		expiresAt: Date.now() + 30000,
		lastHitAt: Date.now() - 2000,
	},
	{
		key: 'sys-key-000000000000',
		redisKey: 'sys-redis-key',
		coarse: false,
		method: 'GET',
		path: '/server/info',
		collection: null,
		user: null,
		query: '{}',
		url: '',
		size: 100,
		hits: 0,
		misses: 4,
		fills: 0,
		fillMs: null,
		hitMs: null,
		ttlMs: null,
		recommendedTtlMs: null,
		createdAt: Date.now(),
		expiresAt: null,
		lastHitAt: null,
	},
];

// Minimal stand-in for the real search-input: exposes the two v-models
// (free-text + filter) so a test can emit them and assert the list re-renders.
const SearchInput = {
	name: 'SearchInput',
	props: ['modelValue', 'filter', 'collection'],
	emits: ['update:modelValue', 'update:filter'],
	template: '<div class="search-input-stub" />',
};

// private-view is a custom element here, which wouldn't render its named slots;
// stub it so the `#actions` (search-input) and body slots mount.
const PrivateView = {
	name: 'PrivateView',
	template: '<div><slot /><slot name="actions" /><slot name="sidebar" /></div>',
};

// Real stub so a test can emit a page change and assert the rows re-slice.
const VPagination = {
	name: 'VPagination',
	props: ['modelValue', 'length', 'totalVisible'],
	emits: ['update:modelValue'],
	template: '<div class="v-pagination-stub" />',
};

// Real stub so a test can emit a window change and assert the refetch.
const VSelect = {
	name: 'VSelect',
	props: ['modelValue', 'items'],
	emits: ['update:modelValue'],
	template: '<div class="v-select-stub" />',
};

// Hyphenated Directus components (private-view, v-*, …) aren't registered here;
// treat them as custom elements so Vue renders their default slot — the
// `.cache-page` body and its table — without stubbing each one. search-input is
// the exception: it's a real stub so a test can drive its filter/search models.
const global = {
	plugins: [i18n],
	// Record the bound value so a test can assert the tooltip text (the real directive
	// renders it out-of-tree, invisible to wrapper.text()).
	directives: {
		tooltip: {
			mounted(el: HTMLElement, binding: { value: unknown }) {
				el.setAttribute('data-tooltip', String(binding.value));
			},
			updated(el: HTMLElement, binding: { value: unknown }) {
				el.setAttribute('data-tooltip', String(binding.value));
			},
		},
	},
	components: { SearchInput, PrivateView, VPagination, VSelect },
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const stubbed = ['search-input', 'private-view', 'v-pagination', 'v-select'];
				return tag.includes('-') && !stubbed.includes(tag);
			},
		},
	},
};

// api.get is URL-multiplexed (entries/stats/anomalies fetched on mount); default
// anomalies + stats to empty so an entries-only test doesn't leak them elsewhere.
function mockCacheGet(
	entries: unknown,
	extra: {
		anomalies?: unknown;
		stats?: unknown;
		timeseries?: unknown;
		latencies?: unknown;
	} = {},
) {
	vi.mocked(api.get).mockImplementation(((url: string) => {
		if (url === '/utils/cache/anomalies') {
			return Promise.resolve({ data: { data: extra.anomalies ?? [] } });
		}

		if (url === '/utils/cache/latencies') {
			return Promise.resolve({ data: { data: extra.latencies ?? [] } });
		}

		if (url === '/utils/cache/stats') {
			return Promise.resolve({ data: { data: extra.stats ?? null } });
		}

		if (url === '/utils/cache/timeseries') {
			return Promise.resolve({
				data: { data: extra.timeseries ?? { buckets: [], markers: [] } },
			});
		}

		return Promise.resolve({ data: { data: entries } });
	}) as never);
}

describe('CachePage', () => {
	beforeEach(() => {
		// The page reads the settings + user stores at setup (TTL field, per-user flush
		// selection), so an active Pinia must exist before mount.
		setActivePinia(createTestingPinia({ createSpy: vi.fn }));
		chartMock.configs = [];
		chartMock.hidden = [];

		vi.mocked(api.get).mockReset();
		vi.mocked(api.delete).mockReset();
		vi.mocked(api.delete).mockResolvedValue({} as never);
		vi.mocked(api.patch).mockReset();
		vi.mocked(api.patch).mockResolvedValue({} as never);
	});

	it('loads, groups and renders entries; evicts a path and an entry', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache', {
			params: { window: '24h' },
		});

		// Both sections render (app + system) with the summary counts.
		expect(wrapper.text()).toContain('/items/articles');
		expect(wrapper.text()).toContain('/server/info');

		// Expand the endpoint, then its method+query subgroup, so the row cells
		// (and their formatters) render.
		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');
		expect(wrapper.text()).toContain('ann@corp.io');

		// Evict the whole endpoint, then a single entry.
		await wrapper.find('.endpoint-header v-button').trigger('click');

		expect(api.delete).toHaveBeenCalledWith('/utils/cache', {
			params: { path: '/items/articles' },
		});

		await wrapper.find('tbody v-icon').trigger('click');

		expect(api.delete).toHaveBeenCalledWith('/utils/cache', {
			params: { key: 'app-redis-key' },
		});
	});

	it('shows count/median per funnel column, tail in the title', async () => {
		mockCacheGet(ENTRIES, {
			latencies: [
				{
					path: '/items/articles',
					method: null,
					query: null,
					response: { p50: 20, p95: 90, p99: 400 },
					miss: { p50: 110, p95: 240, p99: 900 },
					anomaly: { p50: null, p95: null, p99: null },
					fill: { p50: 120, p95: 250, p99: 910 },
					hit: { p50: 2, p95: 9, p99: 30 },
				},
			],
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache/latencies', {
			params: { window: '24h' },
		});

		const columns = wrapper.find('.endpoint-header').findAll('.stat.funnel');

		// One per funnel step, in funnel order. Count and median are separate cells
		// so each reads down its own edge; no metric name in the row itself, and no
		// percentile beyond the median.
		expect(columns.map((column) => column.find('.count').text())).toEqual([
			'9', // responses = 7 hits + 2 misses
			'2',
			'0',
			'3',
			'7',
		]);

		expect(columns.map((column) => column.find('.duration').text())).toEqual([
			'20ms',
			'110ms',
			'', // no anomaly, so no duration to pair with
			'120ms',
			'2ms',
		]);

		// The name and the whole tail live in the title.
		const missTitle = wrapper
			.find('.endpoint-header')
			.find('.stat.funnel.miss')
			.attributes('data-tooltip');

		expect(missTitle).toContain('Misses');
		expect(missTitle).toContain('Count  2');
		expect(missTitle).toContain('p50  110 ms');
		expect(missTitle).toContain('p95  240 ms');
		expect(missTitle).toContain('p99  900 ms');
	});

	it('keeps a column for a metric with no traffic', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// No latency rows at all: the counts still render, the durations don't.
		const columns = wrapper.find('.endpoint-header').findAll('.stat.funnel');
		expect(columns).toHaveLength(5);
		expect(columns[0]!.find('.count').text()).toBe('9');
		expect(columns[0]!.find('.duration').text()).toBe('—');
		expect(columns[2]!.find('.count').text()).toBe('0');
		expect(columns[2]!.find('.duration').text()).toBe('');
		expect(columns[2]!.attributes('data-tooltip')).toContain('p95  —');
	});

	it('falls back to Response when the stored metric no longer exists', async () => {
		mockCacheGet(ENTRIES, {
			latencies: [
				{
					path: '/items/articles',
					method: null,
					query: null,
					response: { p50: 20, p95: 90, p99: 400 },
					miss: { p50: 110, p95: 240, p99: 900 },
					anomaly: { p50: null, p95: null, p99: null },
					fill: { p50: 120, p95: 250, p99: 910 },
					hit: { p50: 2, p95: 9, p99: 30 },
				},
			],
		});

		// A preference written by a build that named its metrics differently.
		localStorage.setItem('cache-tree-latency-metric-anon', 'p50-of-something');

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// Renders rather than reading percentiles off an undefined metric.
		const columns = wrapper.find('.endpoint-header').findAll('.stat.funnel');
		expect(columns).toHaveLength(5);
		expect(columns[0]!.attributes('data-tooltip')).toContain('Response');

		localStorage.removeItem('cache-tree-latency-metric-anon');
	});

	it('drops a sort field the metric change stops offering', async () => {
		mockCacheGet(ENTRIES);
		localStorage.setItem('cache-tree-sort-field-anon', 'responseP95');

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		const metricSelect = wrapper
			.findAllComponents(VSelect)
			.find((select) => select.classes().includes('tree-metric-select'));

		metricSelect!.vm.$emit('update:modelValue', 'miss');
		await flushPromises();

		// `responseP95` is gone from the list, so ranking by it would be invisible.
		expect(localStorage.getItem('cache-tree-sort-field-anon')).toBe('hits');

		localStorage.removeItem('cache-tree-sort-field-anon');
		localStorage.removeItem('cache-tree-latency-metric-anon');
	});

	it('reads a median of a second or more as a duration', async () => {
		mockCacheGet(ENTRIES, {
			latencies: [
				{
					path: '/items/articles',
					method: null,
					query: null,
					response: { p50: 90_000, p95: 90_000, p99: 90_000 },
					miss: { p50: null, p95: null, p99: null },
					anomaly: { p50: null, p95: null, p99: null },
					fill: { p50: null, p95: null, p99: null },
					hit: { p50: null, p95: null, p99: null },
				},
			],
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		const response = wrapper.find('.endpoint-header').find('.stat.funnel.response');
		expect(response.find('.duration').text()).toBe('1m 30s');
		// The exact figure stays in the title, which is never abbreviated.
		expect(response.attributes('data-tooltip')).toContain('90000 ms');
	});

	it('toggles a latency series from the page legend and persists it', async () => {
		mockCacheGet(ENTRIES, {
			timeseries: {
				buckets: [{
					t: 1000,
					hits: 5,
					misses: 2,
					fills: 1,
					anomalies: 0,
					ttlMs: null,
					hitP50: 2,
					missP50: 4,
					bothP50: 3,
				}],
				markers: [],
			},
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		const hitsP50 = wrapper
			.findAll('.cache-chart-legend-row')
			.find((row) => row.text().includes('p50'))!
			.findAll('.cache-chart-legend-entry')
			.find((entry) => entry.text().includes('Hits'))!;

		expect(hitsP50.classes()).not.toContain('is-muted');

		await hitsP50.trigger('click');
		await flushPromises();

		expect(hitsP50.classes()).toContain('is-muted');
		expect(chartMock.hidden).toContain('Hits p50');

		expect(JSON.parse(localStorage.getItem('cache-latency-hidden-anon') ?? '[]'))
			.toContain('Hits p50');

		// Clicking again brings it back, and the store forgets it.
		await hitsP50.trigger('click');
		await flushPromises();

		expect(hitsP50.classes()).not.toContain('is-muted');

		expect(JSON.parse(localStorage.getItem('cache-latency-hidden-anon') ?? '[]'))
			.not.toContain('Hits p50');

		localStorage.removeItem('cache-latency-hidden-anon');
	});

	it('sorts the entries table by a clicked column', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');

		const hitsHeader = wrapper
			.findAll('.entries thead th')
			.find((th) => {
				return th.text()
					.toLowerCase()
					.includes('hits');
			})!;

		// First click sorts ascending.
		await hitsHeader.trigger('click');
		expect(hitsHeader.text()).toContain('↑');

		// Re-clicking flips it rather than starting over.
		await hitsHeader.trigger('click');
		expect(hitsHeader.text()).toContain('↓');

		// A third click clears the column's sort instead of cycling back to
		// ascending, so the table can return to its natural order.
		await hitsHeader.trigger('click');
		expect(hitsHeader.text()).not.toContain('↑');
		expect(hitsHeader.text()).not.toContain('↓');
	});

	it('cuts the tree to the slowest band', async () => {
		const slow = (path: string, p50: number) => {
			return {
				path,
				method: null,
				query: null,
				response: { p50, p95: p50, p99: p50 },
				miss: { p50, p95: p50, p99: p50 },
				anomaly: { p50: null, p95: null, p99: null },
				fill: { p50, p95: p50, p99: p50 },
				hit: { p50, p95: p50, p99: p50 },
			};
		};

		mockCacheGet(ENTRIES, {
			latencies: [
				slow('/items/articles', 300),
				slow('/items/comments', 20),
				slow('/server/info', 10),
			],
		});

		// Default is the whole tree.
		const all = mount(CachePage, { global });
		await flushPromises();
		expect(all.findAll('.endpoint-header')).toHaveLength(3);

		// p99 over three branches keeps the slowest one, and only that one.
		localStorage.setItem('cache-tree-band-anon', 'p99');

		const banded = mount(CachePage, { global });
		await flushPromises();

		expect(banded.findAll('.endpoint-header')).toHaveLength(1);
		expect(banded.text()).toContain('/items/articles');
		expect(banded.text()).not.toContain('/items/comments');

		localStorage.removeItem('cache-tree-band-anon');
	});

	it('renders the anomaly summary + an anomaly node in the tree', async () => {
		const anomalies = [
			{
				cacheKey: 'anom-key-000000000000',
				reason: 'missing_scope',
				path: '/graphql',
				method: 'POST',
				query: '{"query":"{ me }"}',
				url: '',
				count: 3,
				sample: null,
				lastSeen: Date.now(),
			},
		];

		mockCacheGet(ENTRIES, { anomalies });

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache/anomalies', {
			params: { window: '24h' },
		});

		// Summary strip above the tree (reason label + occurrence count).
		const summary = wrapper.find('.anomaly-summary').text();
		expect(summary).toContain('missing scope'); // anomalyLabel for missing_scope
		expect(summary).toContain('×3');

		// The anomaly forms its own endpoint node in the tree (no cached entry there).
		expect(wrapper.text()).toContain('/graphql');
	});

	it('labels a value_too_large anomaly distinctly from missing_scope', async () => {
		const anomalies = [
			{
				cacheKey: 'oversized-00000000000',
				reason: 'value_too_large',
				path: '/graphql',
				method: 'POST',
				query: '{"query":"{ big }"}',
				url: '',
				count: 1,
				sample: '2mb',
				lastSeen: Date.now(),
			},
		];

		mockCacheGet(ENTRIES, { anomalies });

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		const summary = wrapper.find('.anomaly-summary').text();
		expect(summary).toContain('too large'); // anomalyLabel for value_too_large
		expect(summary).not.toContain('missing scope');
	});

	it('renders an in-tree anomaly row + coarse badge', async () => {
		const anomalies = [
			{
				cacheKey: 'orphan-000000000000',
				reason: 'missing_scope',
				path: '/items/articles',
				method: 'GET',
				query: '{"limit":5}',
				url: '/items/articles?limit=5',
				count: 2,
				sample: 'no collection',
				lastSeen: Date.now(),
			},
		];

		mockCacheGet(ENTRIES, { anomalies });

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// /items/articles is hottest → the first endpoint header.
		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');

		// ENTRIES[0] is coarse → its row carries the inline coarse badge.
		const badge = wrapper.find('.entry-row .reason.inline.coarse');
		expect(badge.exists()).toBe(true);
		expect(badge.text()).toContain('coarse');

		// missing_scope stands as its own anomaly row under the same node.
		const anomalyRow = wrapper.find('.anomaly-row');
		expect(anomalyRow.exists()).toBe(true);
		expect(anomalyRow.text()).toContain('missing scope'); // missing_scope label
		expect(anomalyRow.text()).toContain('×2');
		expect(anomalyRow.text()).toContain('no collection'); // the sample
	});

	it('opens the query url and copies the query as pretty JSON', async () => {
		mockCacheGet(ENTRIES);
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const writeText = vi.fn().mockResolvedValue(undefined);

		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText },
			configurable: true,
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// Expand the endpoint so the method+query header (with the actions) renders.
		await wrapper.find('.endpoint-header').trigger('click');

		await wrapper.find('.query-header v-icon[name="open_in_new"]').trigger('click');

		expect(open).toHaveBeenCalledWith(
			expect.stringContaining('/items/articles?limit=5'),
			'_blank',
			'noopener',
		);

		await wrapper.find('.query-header v-icon[name="content_copy"]').trigger('click');
		await flushPromises();

		expect(writeText).toHaveBeenCalledWith('{\n  "limit": 5\n}');

		open.mockRestore();
	});

	it('opens a detail drawer with the live Redis state on row click', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/entry') {
				const data = {
					exists: true,
					value: { hello: 'world' },
					tags: ['articles', 'articles:id=5'],
					tagCounts: { 'articles': 4, 'articles:id=5': 12 },
					expiry: { exp: 0, createdAt: 0, ttlMs: 300000 },
					sizes: { uncompressed: 2048, compressed: 512 },
					tombstone: null,
				};

				return Promise.resolve({ data: { data } }) as never;
			}

			return Promise.resolve({ data: { data: ENTRIES } }) as never;
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');
		await wrapper.find('.entry-row').trigger('click');
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache/entry', {
			params: { key: 'app-redis-key' },
		});

		const text = wrapper.text();
		// descriptor rows + Redis metadata + tags (with blast-radius) + value
		expect(text).toContain('ann@corp.io');
		expect(text).toContain('articles:id=5');
		expect(text).toContain('(12)'); // tag member count
		expect(text).toContain('512 B / 2.0 kB raw (25%)'); // compressed vs raw
		expect(text).toContain('240 ms'); // miss compute cost
		expect(text).toContain('90s (lengthen)'); // recommended TTL + verdict
		expect(text).toContain('Key varies on');
		expect(text).toContain('"hello": "world"');
	});

	it('names a coarse-scope purge for an evicted coarse entry', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/entry') {
				return Promise.resolve({
					data: { data: { exists: false, value: null } },
				}) as never;
			}

			return Promise.resolve({ data: { data: ENTRIES } }) as never;
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');
		await wrapper.find('.entry-row').trigger('click');
		await flushPromises();

		// ENTRIES[0] is coarse with a future expiry → evicted early, not expired.
		expect(wrapper.text()).toContain('coarse-scope purge');
	});

	it('names an expired entry once its TTL has elapsed', async () => {
		const expired = [{ ...ENTRIES[1], expiresAt: Date.now() - 1000 }];

		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/entry') {
				return Promise.resolve({
					data: { data: { exists: false, value: null } },
				}) as never;
			}

			return Promise.resolve({ data: { data: expired } }) as never;
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');
		await wrapper.find('.entry-row').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('expired (TTL elapsed)');
	});

	it('names a scoped purge for a non-coarse entry gone early', async () => {
		const evicted = [{ ...ENTRIES[1] }]; // non-coarse, future expiry

		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/entry') {
				return Promise.resolve({
					data: { data: { exists: false, value: null } },
				}) as never;
			}

			return Promise.resolve({ data: { data: evicted } }) as never;
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');
		await wrapper.find('.entry-row').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('scoped purge or memory eviction');
	});

	it('refetches on a window-selector change', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		vi.mocked(api.get).mockClear();

		// The window selector, not the flush-target select (both render as v-select).
		wrapper.findComponent('.window-select').vm.$emit('update:modelValue', '7d');
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache', {
			params: { window: '7d' },
		});

		expect(api.get).toHaveBeenCalledWith('/utils/cache/anomalies', {
			params: { window: '7d' },
		});
	});

	it('fetches anomalies once on mount, not twice', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		const anomalyCalls = vi.mocked(api.get).mock.calls.filter(
			(call) => call[0] === '/utils/cache/anomalies',
		);

		expect(anomalyCalls).toHaveLength(1);
		expect(wrapper.exists()).toBe(true);
	});

	it('paginates the item rows within a group at 25 per page', async () => {
		const many = Array.from({ length: 30 }, (_unused, index) => {
			return {
				key: `k-${String(index).padStart(3, '0')}`,
				redisKey: `rk-${String(index).padStart(3, '0')}`,
				coarse: false,
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				user: null,
				query: '{}',
				url: '/items/articles',
				size: 10,
				hits: 1,
				fillMs: 5,
				hitMs: 1,
				ttlMs: null,
				recommendedTtlMs: null,
				createdAt: Date.now(),
				expiresAt: null,
				lastHitAt: null,
			};
		});

		mockCacheGet(many);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');

		expect(wrapper.findAll('tbody tr')).toHaveLength(25);

		wrapper.findComponent(VPagination).vm.$emit('update:modelValue', 2);
		await flushPromises();

		expect(wrapper.findAll('tbody tr')).toHaveLength(5);
	});

	it('resets paging to page 1 when the search changes', async () => {
		const many = Array.from({ length: 30 }, (_unused, index) => {
			return {
				key: `k-${String(index).padStart(3, '0')}`,
				redisKey: `rk-${String(index).padStart(3, '0')}`,
				coarse: false,
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				user: null,
				query: '{}',
				url: '/items/articles',
				size: 10,
				hits: 1,
				fillMs: 5,
				hitMs: 1,
				ttlMs: null,
				recommendedTtlMs: null,
				createdAt: Date.now(),
				expiresAt: null,
				lastHitAt: null,
			};
		});

		mockCacheGet(many);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');

		wrapper.findComponent(VPagination).vm.$emit('update:modelValue', 2);
		await flushPromises();
		expect(wrapper.findAll('tbody tr')).toHaveLength(5); // sitting on page 2

		// A search reshapes the group; paging must reset to page 1.
		wrapper.findComponent(SearchInput).vm.$emit('update:modelValue', 'items');
		await flushPromises();

		expect(wrapper.findAll('tbody tr')).toHaveLength(25); // back to the first page
	});

	it('closes the detail drawer when the open entry is evicted', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/entry') {
				return Promise.resolve({
					data: { data: { exists: false, value: null } },
				}) as never;
			}

			return Promise.resolve({ data: { data: ENTRIES } }) as never;
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');
		await wrapper.find('.entry-row').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('coarse-scope purge'); // drawer open on ENTRIES[0]

		await wrapper.find('tbody v-icon').trigger('click'); // evict that entry
		await flushPromises();

		// Drawer must close, not keep showing the now-gone value as live.
		expect(wrapper.text()).not.toContain('coarse-scope purge');
	});

	it('filters by the user_id.email m2o from the search-input', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// All three endpoints show before filtering.
		expect(wrapper.text()).toContain('/items/articles');
		expect(wrapper.text()).toContain('/items/comments');
		expect(wrapper.text()).toContain('/server/info');

		// The m2o drill-in the field-builder emits for "User → Email → Contains".
		wrapper.findComponent(SearchInput).vm.$emit('update:filter', {
			user_id: { email: { _contains: 'ann' } },
		});

		await flushPromises();

		expect(wrapper.text()).toContain('/items/articles'); // ann kept
		expect(wrapper.text()).not.toContain('/items/comments'); // bob dropped
		expect(wrapper.text()).not.toContain('/server/info'); // null user dropped
	});

	it('filters by the free-text search from the search-input', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// The Cached-entries total now lives in its own summary; find it by label
		// rather than a positional index (the count/latency summaries moved above
		// their charts).
		function cachedEntriesTotal() {
			const card = wrapper.findAll('.metric').find((m) => {
				return m.find('.label').text() === 'Cached entries';
			});

			return Number(card!.find('.value').text());
		}

		const entriesTotalBefore = cachedEntriesTotal();

		wrapper.findComponent(SearchInput).vm.$emit('update:modelValue', 'bob@corp.io');
		await flushPromises();

		expect(wrapper.text()).toContain('/items/comments'); // bob matches on email
		expect(wrapper.text()).not.toContain('/items/articles');

		// The summary totals track the filtered list, not the full set.
		const entriesTotalAfter = cachedEntriesTotal();
		expect(entriesTotalAfter).toBeLessThan(entriesTotalBefore);
	});

	it('shows the empty state when nothing is cached', async () => {
		mockCacheGet([]);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		expect(wrapper.text()).toContain('Nothing is cached yet');
	});

	it('surfaces the API error message', async () => {
		vi.mocked(api.get).mockRejectedValue({
			response: { data: { errors: [{ message: 'boom' }] } },
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		expect(wrapper.text()).toContain('boom');
	});

	it('toggles cache stats collection at runtime', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/stats') {
				return Promise.resolve({
					data: {
						data: {
							configured: true,
							enabled: true,
							killedReason: null,
							bufferLength: 0,
						},
					},
				} as never);
			}

			return Promise.resolve({ data: { data: ENTRIES } } as never);
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// The toggle only renders once the env opted in (configured).
		const toggle = wrapper.find('.stats-toggle');
		expect(toggle.exists()).toBe(true);

		await toggle.trigger('click');
		await flushPromises();

		// Enabled → PATCH flips it off, then the state is re-read.
		expect(api.patch).toHaveBeenCalledWith('/utils/cache/stats', {
			enabled: false,
		});
	});

	it('renders ∞ / tombstone / dash branches for a bare entry', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/entry') {
				const data = {
					exists: true,
					value: { x: 1 },
					tags: null,
					tagCounts: {},
					// ttlMs null → ∞; uncompressed 0 → 0% ratio; tombstone set.
					expiry: { exp: 111, createdAt: 222, ttlMs: null },
					sizes: { uncompressed: 0, compressed: 0 },
					tombstone: 1_700_000_000_000,
				};

				return Promise.resolve({ data: { data } }) as never;
			}

			return Promise.resolve({ data: { data: ENTRIES } }) as never;
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// The /server/info group is the system section's only endpoint.
		const headers = wrapper.findAll('.endpoint-header');
		await headers[headers.length - 1]!.trigger('click');
		await wrapper.find('.query-header').trigger('click');
		await wrapper.find('.entry-row').trigger('click');
		await flushPromises();

		const text = wrapper.text();
		expect(text).toContain('∞'); // ttlMs null
		expect(text).toContain('Last expired'); // tombstone row
		expect(text).toContain('(0%)'); // zero-size ratio guard
		expect(text).toContain('—'); // null collection / url / recommended TTL
	});

	it('swallows a detail-fetch error and marks the value absent', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/entry') {
				return Promise.reject(new Error('boom')) as never;
			}

			return Promise.resolve({ data: { data: ENTRIES } }) as never;
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header').trigger('click');
		await wrapper.find('.query-header').trigger('click');
		await wrapper.find('.entry-row').trigger('click');
		await flushPromises();

		// The drawer still opens (selectedEntry set); no unhandled rejection.
		expect(wrapper.find('.entry-detail').exists()).toBe(true);
	});

	it('surfaces a stats-toggle error', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/stats') {
				return Promise.resolve({
					data: {
						data: {
							configured: true,
							enabled: true,
							killedReason: null,
							bufferLength: 0,
						},
					},
				} as never);
			}

			return Promise.resolve({ data: { data: ENTRIES } } as never);
		});

		vi.mocked(api.patch).mockRejectedValue({
			response: { data: { errors: [{ message: 'nope' }] } },
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.stats-toggle').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('nope');
	});

	it('hides the stats toggle when collection is not configured', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/stats') {
				return Promise.resolve({
					data: {
						data: {
							configured: false,
							enabled: false,
							killedReason: null,
							bufferLength: 0,
						},
					},
				} as never);
			}

			return Promise.resolve({ data: { data: ENTRIES } } as never);
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		expect(wrapper.find('.stats-toggle').exists()).toBe(false);
	});

	it('shows the buffered backlog in the toggle tooltip', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			if (url === '/utils/cache/latencies') {
				return Promise.resolve({ data: { data: [] } }) as never;
			}

			if (url === '/utils/cache/stats') {
				return Promise.resolve({
					data: {
						data: {
							configured: true,
							enabled: true,
							killedReason: null,
							bufferLength: 7,
						},
					},
				} as never);
			}

			return Promise.resolve({ data: { data: ENTRIES } } as never);
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// The bufferLength > 0 branch appends the backlog clause; = 0 is the bare base.
		// Asserting the clause pins that the branch is actually taken.
		const tip = wrapper.find('.stats-toggle').attributes('data-tooltip');
		expect(tip).toContain('buffered');
		expect(tip).not.toBe('Disable cache stats collection');
	});

	it('surfaces an evict error instead of an unhandled rejection', async () => {
		mockCacheGet(ENTRIES);

		vi.mocked(api.delete).mockRejectedValue({
			response: { data: { errors: [{ message: 'evict failed' }] } },
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		await wrapper.find('.endpoint-header v-button').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('evict failed');
	});

	it('restores the persisted per-user window on mount', async () => {
		localStorage.clear();
		// The window is a plain string, so vueuse stores it raw (no JSON quotes).
		localStorage.setItem('cache-window-anon', '6h');
		mockCacheGet(ENTRIES);

		mount(CachePage, { global });
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache', {
			params: { window: '6h' },
		});
	});

	it('persists a window change to per-user localStorage', async () => {
		localStorage.clear();
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// Seeds the default on first mount, then follows the selection.
		expect(localStorage.getItem('cache-window-anon')).toBe('24h');

		wrapper.findComponent('.window-select').vm.$emit('update:modelValue', '7d');
		await flushPromises();

		expect(localStorage.getItem('cache-window-anon')).toBe('7d');
	});

	it('restores and persists the per-user refresh interval', async () => {
		localStorage.clear();
		// The interval is number|null, so vueuse uses the JSON serializer.
		localStorage.setItem('cache-refresh-anon', '30');
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		const autoRefresh = wrapper.findComponent(AutoRefresh);
		// A real number, not the raw string a null-default serializer would yield.
		expect(autoRefresh.props('modelValue')).toBe(30);

		autoRefresh.vm.$emit('update:modelValue', 5);
		await flushPromises();

		expect(localStorage.getItem('cache-refresh-anon')).toBe('5');
	});

	it('builds a compact tooltip + human TTL axis from the chart config', async () => {
		mockCacheGet(ENTRIES, {
			// A non-zero bucket so hasTimeseries is true and the chart is built.
			timeseries: {
				buckets: [{
					t: 1000,
					hits: 5,
					misses: 2,
					fills: 1,
					anomalies: 0,
					purges: 3,
					coarsePurges: 1,
					purgedEntries: 9,
					ttlMs: 60000,
					effectiveTtlMs: 3600000,
				}],
				markers: [],
			},
		});

		mount(CachePage, { global });
		await flushPromises();

		const config = chartConfigWithSeries('TTL');
		expect(config).toBeTruthy();

		// TTL leads: the config value the lines after it are a consequence of.
		expect(config.series[0].data).toEqual([[1000, 3600]]);
		expect(config.series[1].data).toEqual([[1000, 7]]);

		// The tooltip reads its values by position, so the order is the contract —
		// pinned whole rather than by one index, which is what let two series be
		// inserted after Hits without this test saying where they went. Row 1 is
		// the raw funnel plus its TTL; row 2 the metrics derived from them.
		expect(config.series.map((series: { name: string }) => series.name)).toEqual([
			'TTL',
			'Responses',
			'Misses',
			'Anomalies',
			'Fills',
			'Hits',
			'Purges',
			'Lifetime',
			'Hit Ratio',
			'Purge Ratio',
			'Coarse purges',
		]);

		// (hits − fills) / (hits + fills) = (5 − 1) / 6, as a percentage.
		expect(config.series[8].data[0]![1]).toBeCloseTo(66.7, 1);

		// (hits − purges) / (hits + purges) = (5 − 9) / 14: below zero, this
		// request was thrown away more often than it was served.
		expect(config.series[9].data[0]![1]).toBeCloseTo(-28.6, 1);

		// Tooltip: one tight "name: value" row per metric, each in its own unit.
		// Positional, in the order the series are declared in.
		const html = config.tooltip.custom({
			series: [[3600], [7], [2], [0], [1], [5], [9], [60], [66.7], [-28.6], [1]],
			dataPointIndex: 0,
			w: { globals: { seriesX: [[1000]] } },
		});

		expect(html).toContain('TTL: 1h');
		expect(html).toContain('Responses: 7');
		expect(html).toContain('Misses: 2');
		expect(html).toContain('Anomalies: 0');
		expect(html).toContain('Fills: 1');
		expect(html).toContain('Hits: 5');
		expect(html).toContain('Purges: 9');
		expect(html).toContain('Lifetime: 1m');
		// Signed: a bare "29%" would read as the winning case when it is the
		// losing one.
		expect(html).toContain('Hit Ratio: +67%');
		expect(html).toContain('Purge Ratio: -29%');
		expect(html).toContain('Coarse purges: 1');
		expect(html).toContain('cache-tt-row');

		// Dashes mark the lines that don't share the Count axis: the two balances,
		// and the lifetime — dashed apart from the TTL it trails so the config and
		// the lifetimes of the entries it produced can't be read as one line.
		expect(config.stroke.dashArray).toEqual([0, 0, 0, 0, 0, 0, 0, 4, 6, 6, 0]);

		// Count axis stays integer; TTL axis reads as a duration; the balances get
		// their own hidden axis, pinned to the form's bounds so zero sits at a
		// fixed height and the two lines stay comparable across windows.
		expect(config.yaxis[0].labels.formatter(5.4)).toBe('5');
		expect(config.yaxis[1].labels.formatter(3600)).toBe('1h');
		expect(config.yaxis[2].show).toBe(false);
		expect(config.yaxis[2].min).toBeLessThan(-100);
		expect(config.yaxis[2].max).toBeGreaterThan(100);

		expect(config.yaxis[2].seriesName)
			.toEqual(['Hit Ratio', 'Purge Ratio']);
	});

	it('splits the TTL in force from the lifetimes entries carry', async () => {
		// The reset that made this necessary: the config drops, but entries filled
		// under the old value keep being served, so `ttlMs` stays high for hours. Two
		// series, so the chart can't read the survivors as the current setting.
		const bucket = { hits: 1, misses: 0, fills: 0, anomalies: 0 };

		mockCacheGet(ENTRIES, {
			timeseries: {
				buckets: [
					// Before any recorded change the config is genuinely unknown, while
					// entries are already being served under some earlier lifetime.
					{ ...bucket, t: 1000, ttlMs: 86400000, effectiveTtlMs: null },
					{ ...bucket, t: 2000, ttlMs: null, effectiveTtlMs: 3600000 },
					{ ...bucket, t: 3000, ttlMs: 86400000, effectiveTtlMs: 3600000 },
				],
				markers: [],
			},
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		const config = chartConfigWithSeries('TTL');

		const ttl = config.series.find((s: { name: string }) => s.name === 'TTL');

		const lifetime = config.series
			.find((s: { name: string }) => s.name === 'Lifetime');

		// The config's own history, in seconds. The leading unknown stays unknown — it
		// is not back-filled with the 1h that had not been set yet.
		expect(ttl.data).toEqual([[1000, null], [2000, 3600], [3000, 3600]]);

		// The lifetime is sampled off whichever entries were served, so its gap carries
		// the previous reading rather than claiming nothing was cached.
		expect(lifetime.data).toEqual([[1000, 86400], [2000, 86400], [3000, 86400]]);

		// The shared fixture also renders the latency chart, whose default-hidden p95
		// bands persist per user. A page left mounted keeps writing that key back, so
		// the next test reads them as a restored choice and never re-hides — its own
		// assertion then finds nothing hidden.
		wrapper.unmount();
		localStorage.removeItem('cache-latency-hidden-anon');
	});

	it('builds the latency chart with p50/p95 series + ms axis', async () => {
		mockCacheGet(ENTRIES, {
			// A bucket with latency samples so hasLatency is true and the chart builds.
			timeseries: {
				buckets: [{
					t: 1000,
					hits: 5,
					misses: 2,
					anomalies: 0,
					ttlMs: null,
					hitP50: 2,
					hitP95: 5,
					fillP50: 20,
					fillP95: 60,
					anomalyP50: 80,
					anomalyP95: 200,
					missP50: 40,
					missP95: 120,
					bothP50: 3,
					bothP95: 100,
				}],
				markers: [],
			},
		});

		mount(CachePage, { global });
		await flushPromises();

		const config = chartConfigWithSeries('Response p50');
		expect(config).toBeTruthy();

		// Ten series: 5 categories × p50/p95, p95 dashed and hidden by default.
		expect(config.series.map((s: { name: string }) => s.name)).toEqual([
			'Response p50',
			'Response p95',
			'Misses p50',
			'Misses p95',
			'Anomalies p50',
			'Anomalies p95',
			'Fills p50',
			'Fills p95',
			'Hits p50',
			'Hits p95',
		]);

		expect(config.stroke.dashArray).toEqual([0, 4, 0, 4, 0, 4, 0, 4, 0, 4]);

		// ms axis + a compact ms tooltip.
		expect(config.yaxis.labels.formatter(40.6)).toBe('41ms');

		const html = config.tooltip.custom({ dataPointIndex: 0 });

		expect(html).toContain('Hits p50: 2ms');
		expect(html).toContain('Fills p50: 20ms');
		expect(html).toContain('Anomalies p95: 200ms');
		expect(html).toContain('Misses p95: 120ms');

		// `applyHiddenSeries` retries across animation frames until apex has registered
		// its series, which the stub never reports — so the hides land a dozen frames
		// after the mount's promises settle, not with them. Wait for the effect being
		// asserted instead of relying on whatever else happened to run first.
		for (let frame = 0; frame < 20 && chartMock.hidden.length === 0; frame++) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
		}

		// The p95 bands are hidden on first render; the p50 medians stay visible.
		expect(chartMock.hidden).toContain('Hits p95');
		expect(chartMock.hidden).toContain('Misses p95');
		expect(chartMock.hidden).not.toContain('Hits p50');
	});

	it('drops empty series, zero-fills gaps, marks only real samples', async () => {
		mockCacheGet(ENTRIES, {
			timeseries: {
				buckets: [
					{
						t: 1000,
						hits: 5,
						misses: 2,
						fills: 1,
						anomalies: null,
						ttlMs: null,
						hitP50: 10,
						hitP95: null,
						fillP50: null,
						fillP95: null,
						anomalyP50: null,
						anomalyP95: null,
						missP50: 8,
						missP95: null,
						bothP50: 9,
						bothP95: null,
					},
					{
						t: 2000,
						hits: null,
						misses: null,
						fills: null,
						anomalies: null,
						ttlMs: null,
						hitP50: null,
						hitP95: null,
						fillP50: null,
						fillP95: null,
						anomalyP50: null,
						anomalyP95: null,
						missP50: null,
						missP95: null,
						bothP50: null,
						bothP95: null,
					},
				],
				markers: [],
			},
		});

		mount(CachePage, { global });
		await flushPromises();

		const config = chartConfigWithSeries('Response p50');

		// Only series with a real sample survive — Fills/Anomalies (all-null) and
		// every p95 here are dropped.
		expect(config.series.map((s: { name: string }) => s.name)).toEqual([
			'Response p50',
			'Misses p50',
			'Hits p50',
		]);

		// The idle second bucket is zero-filled (continuous), not interpolated/null.
		expect(config.series[0].data).toEqual([[1000, 9], [2000, 0]]);

		// A marker only on the real sample (bucket 0), none on the zero-fill.
		const discrete = config.markers.discrete as {
			seriesIndex: number;
			dataPointIndex: number;
		}[];

		expect(discrete).toHaveLength(3);
		expect(discrete.map((m) => m.seriesIndex)).toEqual([0, 1, 2]);
		expect(discrete.map((m) => m.dataPointIndex)).toEqual([0, 0, 0]);

		// Tooltip skips no-sample rows: the empty bucket renders no row.
		const emptyBucketHtml = config.tooltip.custom({ dataPointIndex: 1 });
		expect(emptyBucketHtml).not.toContain('cache-tt-row');

		const html = config.tooltip.custom({ dataPointIndex: 0 });
		expect(html).toContain('Hits p50: 10ms');
		expect(html).not.toContain('Fills');
	});

	it('persists a counts legend toggle to per-user localStorage', async () => {
		localStorage.clear();

		mockCacheGet(ENTRIES, {
			timeseries: {
				buckets: [{
					t: 1000,
					hits: 5,
					misses: 2,
					fills: 1,
					anomalies: 0,
					ttlMs: null,
				}],
				markers: [],
			},
		});

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		// Apex's own legend is off — the page renders its own two rows — so the
		// toggle is a click on that, not a legendClick callback.
		const misses = wrapper.findAll('.cache-chart-legend-entry')
			.find((entry) => entry.text().trim() === 'Misses')!;

		expect(misses).toBeDefined();

		await misses.trigger('click');
		await flushPromises();

		expect(JSON.parse(localStorage.getItem('cache-counts-hidden-anon') ?? '[]'))
			.toContain('Misses');

		await misses.trigger('click');
		await flushPromises();

		expect(JSON.parse(localStorage.getItem('cache-counts-hidden-anon') ?? '[]'))
			.not.toContain('Misses');
	});
});
