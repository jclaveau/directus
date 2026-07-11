import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return { default: { get: vi.fn(), delete: vi.fn() } };
});

vi.mock('@/utils/get-root-path', () => {
	return { getRootPath: () => '/admin/' };
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
		createdAt: Date.now() - 5000,
		expiresAt: Date.now() + 60000,
		lastHitAt: Date.now() - 1000,
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
		createdAt: Date.now(),
		expiresAt: null,
		lastHitAt: null,
	},
];

// Hyphenated Directus components (private-view, v-*, search-input, …) aren't
// registered here; treat them as custom elements so Vue renders their default
// slot — the `.cache-page` body and its table — without stubbing each one.
const global = {
	plugins: [i18n],
	directives: { tooltip: {} },
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => tag.includes('-'),
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

		// Expand the first endpoint so the row cells (and their formatters) render.
		await wrapper.find('.endpoint-header').trigger('click');
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
