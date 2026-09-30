import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return {
		default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
	};
});

import { createMemoryHistory, createRouter } from 'vue-router';
import api from '@/api';
import VButton from '@/components/v-button.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VInput from '@/components/v-input.vue';
import VNotice from '@/components/v-notice.vue';
import VSelect from '@/components/v-select/v-select.vue';
import CacheSettingsPanel from './cache-settings-panel.vue';

const global = {
	plugins: [
		i18n,
		// `v-button` resolves a route whether or not it links anywhere.
		createRouter({
			history: createMemoryHistory(),
			routes: [{ path: '/', component: { template: '<div />' } }],
		}),
	],
	directives: {
		tooltip: {
			mounted: (el: any, binding: any) => el.setAttribute('title', binding.value),
			updated: (el: any, binding: any) => el.setAttribute('title', binding.value),
			unmounted: () => undefined,
		},
	},
	components: { VButton, VIcon, VInput, VNotice, VSelect },
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const real = ['v-button', 'v-icon', 'v-input', 'v-notice', 'v-select'];

				return tag.includes('-') && !real.includes(tag);
			},
		},
	},
};

/** The answer of a node whose settings hold `audit_limit: 40` alone. */
function answered(sharedSettings: Record<string, unknown> | null) {
	return {
		data: {
			data: {
				key: 'directus_settings.cache_settings',
				sharedSettings,
				resolved: {
					enabled: { value: true, source: 'env', fallback: true },
					value_max_size: { value: '2mb', source: 'env', fallback: '2mb' },
					stats_max_bytes: { value: null, source: 'env', fallback: null },
					audit_limit: { value: 40, source: 'settings', fallback: 0 },
					audit_max_duration: { value: '10m', source: 'env', fallback: '10m' },
					scoped_max_index_globs: { value: 64, source: 'default', fallback: 64 },
					scoped_index_scan_count: {
						value: 1000,
						source: 'default',
						fallback: 1000,
					},
					scoped_index_ttl_factor: { value: 2, source: 'default', fallback: 2 },
				},
			},
		},
	};
}

async function mounted() {
	vi.mocked(api.get).mockResolvedValue(answered({ audit_limit: 40 }));

	const wrapper = mount(CacheSettingsPanel, { global });
	await flushPromises();

	return wrapper;
}

function row(wrapper: any, name: string) {
	return wrapper.findAll('tbody tr')
		.find((candidate: any) => candidate.text().startsWith(name));
}

async function press(wrapper: any, selector: string) {
	await flushPromises();
	await wrapper.find(selector).trigger('click');
	await flushPromises();
}

beforeEach(() => {
	// `v-icon` reads a store, so the panel needs a pinia to mount at all.
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	vi.mocked(api.get).mockReset();
	vi.mocked(api.patch).mockReset();
	vi.mocked(api.delete).mockReset();
	vi.mocked(api.patch).mockResolvedValue(answered({}));
	vi.mocked(api.delete).mockResolvedValue(answered(null));
});

describe('what the panel shows', () => {
	test('a row is named by its variable, else by its field', async () => {
		const wrapper = await mounted();

		expect(wrapper.findAll('tbody tr > td:first-child')
			.map((cell: any) => cell.text()))
			.toEqual([
				'CACHE_ENABLED',
				'CACHE_VALUE_MAX_SIZE',
				'CACHE_STATS_MAX_BYTES',
				'CACHE_AUDIT_LIMIT',
				'CACHE_AUDIT_MAX_DURATION',
				'scoped_max_index_globs',
				'scoped_index_scan_count',
				'scoped_index_ttl_factor',
			]);
	});

	test('a row holds the value the node runs on and its layer', async () => {
		const wrapper = await mounted();

		expect(row(wrapper, 'CACHE_AUDIT_LIMIT').find('input').element.value)
			.toBe('40');

		expect(row(wrapper, 'CACHE_AUDIT_LIMIT').find('.source')
			.text())
			.toBe('shared settings');

		expect(row(wrapper, 'scoped_index_ttl_factor').find('.source')
			.text())
			.toBe('default');
	});

	test('a field says what it does on hover', async () => {
		const wrapper = await mounted();

		expect(row(wrapper, 'CACHE_ENABLED').find('td span')
			.attributes('title'))
			.toContain('clears the response cache first');
	});

	test('the panel says where the settings are kept', async () => {
		const wrapper = await mounted();

		expect(wrapper.find('.key')
			.text())
			.toBe('Stored in directus_settings.cache_settings');
	});

	test('a failed read is shown as it came', async () => {
		vi.mocked(api.get).mockRejectedValue({
			response: { data: { errors: [{ message: 'You don\'t have permission' }] } },
		});

		const wrapper = mount(CacheSettingsPanel, { global });
		await flushPromises();

		expect(wrapper.find('.v-notice')
			.text()).toBe('You don\'t have permission');
	});
});

describe('editing one field', () => {
	test('a typed number is written as a number, and reads as stored', async () => {
		const wrapper = await mounted();

		await row(wrapper, 'scoped_index_ttl_factor').find('input')
			.setValue('1.5');

		expect(row(wrapper, 'scoped_index_ttl_factor').find('.source')
			.text())
			.toBe('shared settings');

		await press(row(wrapper, 'scoped_index_ttl_factor'), '.apply button');

		expect(api.patch).toHaveBeenCalledWith('/utils/cache/settings', {
			scoped_index_ttl_factor: 1.5,
		});
	});

	test('a size typed as false lifts the cap', async () => {
		const wrapper = await mounted();

		await row(wrapper, 'CACHE_VALUE_MAX_SIZE').find('input')
			.setValue('false');

		await press(row(wrapper, 'CACHE_VALUE_MAX_SIZE'), '.apply button');

		expect(api.patch).toHaveBeenCalledWith('/utils/cache/settings', {
			value_max_size: false,
		});
	});

	test('switching the cache is chosen, and written as a boolean', async () => {
		const wrapper = await mounted();
		const select = row(wrapper, 'CACHE_ENABLED').findComponent(VSelect);

		expect(select.props('modelValue')).toBe('true');

		select.vm.$emit('update:modelValue', 'false');
		await press(row(wrapper, 'CACHE_ENABLED'), '.apply button');

		expect(api.patch).toHaveBeenCalledWith('/utils/cache/settings', {
			enabled: false,
		});

		expect(wrapper.emitted('changed')).toHaveLength(1);
	});

	test('a change is discarded without writing it', async () => {
		const wrapper = await mounted();
		const input = row(wrapper, 'CACHE_AUDIT_LIMIT').find('input');

		await input.setValue('80');
		await press(row(wrapper, 'CACHE_AUDIT_LIMIT'), '.cancel button');

		expect(api.patch).not.toHaveBeenCalled();
		expect(input.element.value).toBe('40');
	});

	test('resetting one field writes a null for that field alone', async () => {
		const wrapper = await mounted();

		await press(row(wrapper, 'CACHE_AUDIT_LIMIT'), '.reset button');

		expect(api.patch).toHaveBeenCalledWith('/utils/cache/settings', {
			audit_limit: null,
		});
	});

	test('the reset button names the value it would land on', async () => {
		const wrapper = await mounted();

		const stored = row(wrapper, 'CACHE_AUDIT_LIMIT').findAllComponents(VButton);

		expect(stored[2].props()).toMatchObject({
			tooltip: 'Reset to the environment: 0',
			disabled: false,
		});

		expect(row(wrapper, 'scoped_index_ttl_factor')
			.findAllComponents(VButton)[2]
			.props()).toMatchObject({
			tooltip: 'Reset to the default: 2',
			disabled: true,
		});
	});

	test('an unreadable number is refused, not written as a reset', async () => {
		const wrapper = await mounted();
		const input = row(wrapper, 'CACHE_AUDIT_LIMIT').find('input');

		Object.defineProperty(input.element, 'validity', {
			value: { badInput: true },
		});

		await input.setValue('');
		await press(row(wrapper, 'CACHE_AUDIT_LIMIT'), '.apply button');
		await press(wrapper, '.bulk .v-button:nth-child(1) button');

		expect(api.patch).not.toHaveBeenCalled();

		expect(wrapper.find('.v-notice')
			.text()).toBe('Not a number: CACHE_AUDIT_LIMIT');
	});

	test('a refused write is reported and leaves the value to correct', async () => {
		vi.mocked(api.patch).mockRejectedValue({
			response: {
				data: {
					errors: [{
						message: '\'cache_settings.scoped_index_ttl_factor\' '
							+ 'has to be a number from 1, or null',
					}],
				},
			},
		});

		const wrapper = await mounted();

		await row(wrapper, 'scoped_index_ttl_factor').find('input')
			.setValue('0.5');

		await press(row(wrapper, 'scoped_index_ttl_factor'), '.apply button');

		expect(wrapper.find('.v-notice')
			.text()).toBe(
			'\'cache_settings.scoped_index_ttl_factor\' has to be a number from 1, '
			+ 'or null',
		);

		expect(row(wrapper, 'scoped_index_ttl_factor').find('input').element.value)
			.toBe('0.5');
	});
});

describe('the whole form at once', () => {
	test('every pending change is applied in one write', async () => {
		const wrapper = await mounted();

		await row(wrapper, 'CACHE_AUDIT_LIMIT').find('input')
			.setValue('80');

		await row(wrapper, 'scoped_index_scan_count').find('input')
			.setValue('500');

		await press(wrapper, '.bulk .v-button:nth-child(1) button');

		expect(api.patch).toHaveBeenCalledTimes(1);

		expect(api.patch).toHaveBeenCalledWith('/utils/cache/settings', {
			audit_limit: 80,
			scoped_index_scan_count: 500,
		});
	});

	test('resetting the changes writes nothing and puts the values back', async () => {
		const wrapper = await mounted();
		const input = row(wrapper, 'CACHE_AUDIT_LIMIT').find('input');

		await input.setValue('80');
		await press(wrapper, '.bulk .v-button:nth-child(2) button');

		expect(api.patch).not.toHaveBeenCalled();
		expect(input.element.value).toBe('40');
	});

	test('resetting to the fallbacks deletes the settings', async () => {
		const wrapper = await mounted();

		await press(wrapper, '.bulk .v-button:nth-child(3) button');

		expect(api.delete).toHaveBeenCalledWith('/utils/cache/settings');
		expect(wrapper.find('.key').exists()).toBe(true);
		expect(wrapper.emitted('changed')).toHaveLength(1);
	});
});
