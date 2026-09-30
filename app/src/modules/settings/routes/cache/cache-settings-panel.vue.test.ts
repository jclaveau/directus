import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';
import { oneLine } from '@directus/utils';

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
					response: { value: true, source: 'env', fallback: true },
					value_max_size: { value: '2mb', source: 'env', fallback: '2mb' },
					stats_max_bytes: { value: null, source: 'env', fallback: null },
					audit_limit: { value: 40, source: 'settings', fallback: 0 },
					audit_max_duration: { value: '10m', source: 'env', fallback: '10m' },
					scoped_index_scan_count: {
						value: 1000,
						source: 'env',
						fallback: 1000,
					},
					scoped_index_ttl_factor: { value: 2, source: 'env', fallback: 2 },
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

function row(wrapper: any, variable: string) {
	return wrapper.find(`tbody tr[data-variable="${variable}"]`);
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
	test('a row is named by its variable', async () => {
		const wrapper = await mounted();

		expect(wrapper.findAll('tbody tr > td:first-child')
			.map((cell: any) => cell.text()))
			.toEqual([
				'CACHE_RESPONSE',
				'CACHE_VALUE_MAX_SIZE',
				'CACHE_STATS_MAX_BYTES',
				'CACHE_AUDIT_LIMIT',
				'CACHE_AUDIT_MAX_DURATION',
				'CACHE_SCOPED_INDEX_SCAN_COUNT',
				'CACHE_SCOPED_INDEX_TTL_FACTOR',
			]);
	});

	test('a row holds the value the node runs on and its layer', async () => {
		const wrapper = await mounted();

		expect(row(wrapper, 'CACHE_AUDIT_LIMIT').find('input').element.value)
			.toBe('40');

		expect(row(wrapper, 'CACHE_AUDIT_LIMIT').find('.source')
			.text())
			.toBe('shared settings');

		expect(row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR').find('.source')
			.text())
			.toBe('environment');
	});

	test('a layer is named in words, not by its code', async () => {
		const wrapper = await mounted();

		expect(row(wrapper, 'CACHE_AUDIT_MAX_DURATION').find('.source')
			.text())
			.toBe('environment');
	});

	test.each([
		'cache_settings',
		'cache_settings_field',
		'cache_settings_value',
		'cache_settings_source_settings',
		'cache_settings_source_env',
		'cache_settings_set_by',
		'cache_settings_from_admin',
		'cache_settings_from_mcp',
		'cache_settings_days_ago',
		'cache_settings_cancel',
		'cache_settings_apply',
		'cache_settings_reset_env',
		'cache_settings_apply_all',
		'cache_settings_reset_all',
		'cache_settings_reset_fallbacks',
		'cache_settings_key',
	])('%s is translated', (translationKey) => {
		expect(i18n.global.te(translationKey, 'en-US')).toBe(true);
	});

	// Named for a screen reader, which reads neither an icon nor a tooltip.
	test('every input and row button says what it is for', async () => {
		const wrapper = await mounted();
		const auditRow = row(wrapper, 'CACHE_AUDIT_LIMIT');

		expect(auditRow.find('input').attributes('aria-label'))
			.toBe('CACHE_AUDIT_LIMIT');

		expect(auditRow.find('.cancel button').attributes('aria-label'))
			.toBe('Discard this change');

		expect(auditRow.find('.apply button').attributes('aria-label'))
			.toBe('Apply this change');

		expect(auditRow.find('.reset button').attributes('aria-label'))
			.toBe('Reset to the environment: 0');
	});

	test('the switch is named by its variable', async () => {
		const wrapper = await mounted();

		expect(row(wrapper, 'CACHE_RESPONSE')
			.find('.choice')
			.attributes('aria-label'))
			.toBe('CACHE_RESPONSE');
	});

	test('a field says what it does on hover', async () => {
		const wrapper = await mounted();

		expect(row(wrapper, 'CACHE_RESPONSE').find('td span')
			.attributes('title'))
			.toContain('clears the response cache first');
	});

	test('the panel says where the settings are kept', async () => {
		const wrapper = await mounted();

		expect(wrapper.find('.key')
			.text())
			.toBe('Stored in directus_settings.cache_settings');
	});

	test('the panel names who last wrote the settings, from where', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-30T09:00:00.000Z'));

		vi.mocked(api.get).mockResolvedValue({
			data: {
				data: {
					key: 'directus_settings.cache_settings',
					sharedSettings: {
						audit_limit: 40,
						setBy: 'writer-id',
						setAt: '2026-09-28T08:00:00.000Z',
						setFrom: 'mcp',
					},
					setByEmail: 'ann@example.com',
					resolved: {},
				},
			},
		});

		const wrapper = mount(CacheSettingsPanel, { global });
		await flushPromises();
		vi.useRealTimers();

		expect(wrapper.find('.stamp').text())
			.toBe('Configured by ann@example.com from the system MCP 2d ago');
	});

	test('the panel names no writer where no write stamped one', async () => {
		expect((await mounted()).find('.stamp').exists()).toBe(false);
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

		await row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR').find('input')
			.setValue('1.5');

		expect(row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR').find('.source')
			.text())
			.toBe('shared settings');

		await press(row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR'), '.apply button');

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
		const select = row(wrapper, 'CACHE_RESPONSE').findComponent(VSelect);

		expect(select.props('modelValue')).toBe('true');

		select.vm.$emit('update:modelValue', 'false');
		await press(row(wrapper, 'CACHE_RESPONSE'), '.apply button');

		expect(api.patch).toHaveBeenCalledWith('/utils/cache/settings', {
			response: false,
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

		expect(row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR')
			.findAllComponents(VButton)[2]
			.props()).toMatchObject({
			tooltip: 'Reset to the environment: 2',
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
			.text()).toBe('Not a Number: CACHE_AUDIT_LIMIT');
	});

	test('enter on a field nobody typed into writes nothing', async () => {
		const wrapper = await mounted();

		await row(wrapper, 'CACHE_AUDIT_LIMIT').find('input')
			.trigger('keyup.enter');

		await flushPromises();

		expect(api.patch).not.toHaveBeenCalled();

		expect(row(wrapper, 'CACHE_AUDIT_LIMIT').find('input').element.value)
			.toBe('40');
	});

	// The arrows step the value without an input event, and what they leave is
	// a number the browser reads.
	test('a number stepped to after an unreadable one is written', async () => {
		const wrapper = await mounted();
		const limitInput = row(wrapper, 'CACHE_AUDIT_LIMIT').find('input');

		Object.defineProperty(limitInput.element, 'validity', {
			value: { badInput: true },
			configurable: true,
		});

		await limitInput.setValue('');

		Object.defineProperty(limitInput.element, 'validity', {
			value: { badInput: false },
		});

		row(wrapper, 'CACHE_AUDIT_LIMIT').findComponent(VInput).vm
			.$emit('update:modelValue', 41);

		await press(row(wrapper, 'CACHE_AUDIT_LIMIT'), '.apply button');

		expect(api.patch).toHaveBeenCalledWith('/utils/cache/settings', {
			audit_limit: 41,
		});
	});

	// The browser reads an unreadable number as empty, so a box whose value is
	// null renders the same '' before and after, and only a new box drops the
	// text still showing in it.
	test(oneLine`
		discarding an unreadable number gives a field with no value a new box
	`, async () => {
		vi.mocked(api.get).mockResolvedValue({
			data: {
				data: {
					key: 'directus_settings.cache_settings',
					sharedSettings: null,
					resolved: {},
				},
			},
		});

		const wrapper = mount(CacheSettingsPanel, { global });
		await flushPromises();

		const scanCountInput = row(wrapper, 'CACHE_SCOPED_INDEX_SCAN_COUNT')
			.find('input');

		Object.defineProperty(scanCountInput.element, 'validity', {
			value: { badInput: true },
		});

		await scanCountInput.setValue('');
		await press(row(wrapper, 'CACHE_SCOPED_INDEX_SCAN_COUNT'), '.cancel button');

		expect(row(wrapper, 'CACHE_SCOPED_INDEX_SCAN_COUNT').find('input').element)
			.not.toBe(scanCountInput.element);
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

		await row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR').find('input')
			.setValue('0.5');

		await press(row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR'), '.apply button');

		expect(wrapper.find('.v-notice')
			.text()).toBe(
			'\'cache_settings.scoped_index_ttl_factor\' has to be a number from 1, '
			+ 'or null',
		);

		expect(row(wrapper, 'CACHE_SCOPED_INDEX_TTL_FACTOR').find('input').element.value)
			.toBe('0.5');
	});
});

describe('a refresh of the page', () => {
	test('re-reads the settings and keeps what is being typed', async () => {
		const wrapper = await mounted();

		await row(wrapper, 'CACHE_AUDIT_LIMIT').find('input')
			.setValue('80');

		await wrapper.setProps({ refreshKey: 1 });
		await flushPromises();

		expect(api.get).toHaveBeenCalledTimes(2);

		expect(row(wrapper, 'CACHE_AUDIT_LIMIT').find('input').element.value)
			.toBe('80');
	});

	// Sent before the write committed, it holds the row the write replaced.
	test('a read answering after a write leaves what the write showed', async () => {
		const wrapper = await mounted();
		let answerRead: (value: unknown) => void = () => undefined;

		vi.mocked(api.get).mockReturnValueOnce(new Promise((resolve) => {
			answerRead = resolve;
		}) as never);

		vi.mocked(api.patch).mockResolvedValue({
			data: {
				data: {
					key: 'directus_settings.cache_settings',
					sharedSettings: {
						audit_limit: 80,
						setBy: 'writer-id',
						setAt: '2026-09-30T08:00:00.000Z',
						setFrom: 'admin',
					},
					setByEmail: 'ann@example.com',
					resolved: {},
				},
			},
		});

		await wrapper.setProps({ refreshKey: 1 });

		await row(wrapper, 'CACHE_AUDIT_LIMIT').find('input')
			.setValue('80');

		await press(row(wrapper, 'CACHE_AUDIT_LIMIT'), '.apply button');
		answerRead(answered({ audit_limit: 40 }));
		await flushPromises();

		expect(wrapper.find('.stamp').exists()).toBe(true);
	});

	test('a read that succeeds takes down the error of one that failed', async () => {
		vi.mocked(api.get).mockRejectedValueOnce({
			response: { data: { errors: [{ message: 'Service Unavailable' }] } },
		});

		vi.mocked(api.get).mockResolvedValue(answered({ audit_limit: 40 }));
		const wrapper = mount(CacheSettingsPanel, { global });
		await flushPromises();

		await wrapper.setProps({ refreshKey: 1 });
		await flushPromises();

		expect(wrapper.find('.v-notice').exists()).toBe(false);
	});
});

describe('the whole form at once', () => {
	test('every pending change is applied in one write', async () => {
		const wrapper = await mounted();

		await row(wrapper, 'CACHE_AUDIT_LIMIT').find('input')
			.setValue('80');

		await row(wrapper, 'CACHE_SCOPED_INDEX_SCAN_COUNT').find('input')
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
