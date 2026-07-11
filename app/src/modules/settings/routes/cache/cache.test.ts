import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return { default: { get: vi.fn(), delete: vi.fn() } };
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
		createdAt: Date.now() - 5000,
		expiresAt: Date.now() + 60000,
		lastHitAt: Date.now() - 1000,
	},
	{
		key: 'bob-key-000000000000',
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
		createdAt: Date.now() - 8000,
		expiresAt: Date.now() + 30000,
		lastHitAt: Date.now() - 2000,
	},
	{
		key: 'sys-key-000000000000',
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

// Hyphenated Directus components (private-view, v-*, …) aren't registered here;
// treat them as custom elements so Vue renders their default slot — the
// `.cache-page` body and its table — without stubbing each one. search-input is
// the exception: it's a real stub so a test can drive its filter/search models.
const global = {
	plugins: [i18n],
	directives: { tooltip: {} },
	components: { SearchInput, PrivateView, VPagination },
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const stubbed = ['search-input', 'private-view', 'v-pagination'];
				return tag.includes('-') && !stubbed.includes(tag);
			},
		},
	},
};

describe('CachePage', () => {
	beforeEach(() => {
		vi.mocked(api.get).mockReset();
		vi.mocked(api.delete).mockReset();
		vi.mocked(api.delete).mockResolvedValue({} as never);
	});

	it('loads, groups and renders entries; evicts a path and an entry', async () => {
		vi.mocked(api.get).mockResolvedValue({ data: { data: ENTRIES } } as never);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/cache');
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
			params: { key: 'app-key-000000000000' },
		});
	});

	it('opens the query url and copies the query as pretty JSON', async () => {
		vi.mocked(api.get).mockResolvedValue({ data: { data: ENTRIES } } as never);
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
			params: { key: 'app-key-000000000000' },
		});

		const text = wrapper.text();
		// descriptor rows + Redis metadata + tags (with blast-radius) + value
		expect(text).toContain('ann@corp.io');
		expect(text).toContain('articles:id=5');
		expect(text).toContain('(12)'); // tag member count
		expect(text).toContain('512 B / 2.0 KB raw (25%)'); // compressed vs raw
		expect(text).toContain('240 ms'); // miss compute cost
		expect(text).toContain('Key varies on');
		expect(text).toContain('"hello": "world"');
	});

	it('paginates the item rows within a group at 25 per page', async () => {
		const many = Array.from({ length: 30 }, (_unused, index) => {
			return {
				key: `k-${String(index).padStart(3, '0')}`,
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
				createdAt: Date.now(),
				expiresAt: null,
				lastHitAt: null,
			};
		});

		vi.mocked(api.get).mockResolvedValue({ data: { data: many } } as never);

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
		vi.mocked(api.get).mockResolvedValue({ data: { data: ENTRIES } } as never);

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
		vi.mocked(api.get).mockResolvedValue({ data: { data: ENTRIES } } as never);

		const wrapper = mount(CachePage, { global });
		await flushPromises();

		wrapper.findComponent(SearchInput).vm.$emit('update:modelValue', 'bob@corp.io');
		await flushPromises();

		expect(wrapper.text()).toContain('/items/comments'); // bob matches on email
		expect(wrapper.text()).not.toContain('/items/articles');
	});

	it('shows the empty state when nothing is cached', async () => {
		vi.mocked(api.get).mockResolvedValue({ data: { data: [] } } as never);

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
});
