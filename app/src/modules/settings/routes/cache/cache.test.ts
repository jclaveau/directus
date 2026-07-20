import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return { default: { get: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

vi.mock('@/utils/get-root-path', () => {
	return { getRootPath: () => '/admin/' };
});

vi.mock('@/utils/notify', () => {
	return { notify: vi.fn() };
});

import api from '@/api';
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
	directives: { tooltip: {} },
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
	extra: { anomalies?: unknown; stats?: unknown } = {},
) {
	vi.mocked(api.get).mockImplementation(((url: string) => {
		if (url === '/utils/cache/anomalies') {
			return Promise.resolve({ data: { data: extra.anomalies ?? [] } });
		}

		if (url === '/utils/cache/stats') {
			return Promise.resolve({ data: { data: extra.stats ?? null } });
		}

		return Promise.resolve({ data: { data: entries } });
	}) as never);
}

describe('CachePage', () => {
	beforeEach(() => {
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
		expect(text).toContain('512 B / 2.0 KB raw (25%)'); // compressed vs raw
		expect(text).toContain('240 ms'); // miss compute cost
		expect(text).toContain('90s (lengthen)'); // recommended TTL + verdict
		expect(text).toContain('Key varies on');
		expect(text).toContain('"hello": "world"');
	});

	it('names a coarse-scope purge for an evicted coarse entry', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
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

	it('names a scoped purge / eviction for a non-coarse entry gone before its TTL', async () => {
		const evicted = [{ ...ENTRIES[1] }]; // non-coarse, future expiry

		vi.mocked(api.get).mockImplementation((url: string) => {
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

	it('refetches entries and anomalies when the window selector changes', async () => {
		mockCacheGet(ENTRIES);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		vi.mocked(api.get).mockClear();

		wrapper.findComponent(VSelect).vm.$emit('update:modelValue', '7d');
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

		const entriesTotalBefore = Number(wrapper.findAll('.summary .value')[0]!.text());

		wrapper.findComponent(SearchInput).vm.$emit('update:modelValue', 'bob@corp.io');
		await flushPromises();

		expect(wrapper.text()).toContain('/items/comments'); // bob matches on email
		expect(wrapper.text()).not.toContain('/items/articles');

		// The summary totals track the filtered list, not the full set.
		const entriesTotalAfter = Number(wrapper.findAll('.summary .value')[0]!.text());
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

		// bufferLength > 0 branch of statsTooltip renders the count.
		expect(wrapper.find('.stats-toggle').exists()).toBe(true);
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
});
