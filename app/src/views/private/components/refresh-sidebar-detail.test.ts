import type { GlobalMountOptions } from '@/__utils__/types';
import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import RefreshSidebarDetail from './refresh-sidebar-detail.vue';

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	messages: {
		en: {
			no_refresh: 'No refresh',
			refresh_interval_seconds: '{seconds}s',
			refresh_interval_minutes: '{minutes}m',
			auto_refresh: 'Auto refresh',
			refresh_interval: 'Refresh interval',
		},
	},
});

// Stub v-select so the dropdown's `items` prop can be read back; stub sidebar-detail
// down to its default slot so the field (and the select) still render.
const VSelectStub = {
	props: ['items', 'modelValue'],
	emits: ['update:modelValue'],
	template: '<div class="v-select-stub" />',
};

const global: GlobalMountOptions = {
	stubs: {
		'v-select': VSelectStub,
		'sidebar-detail': { template: '<div><slot /></div>' },
	},
	plugins: [i18n],
};

function itemsFor(intervals?: (number | null)[]) {
	const props = intervals === undefined
		? { modelValue: null }
		: { modelValue: null, intervals };

	const wrapper = mount(RefreshSidebarDetail, { props, global });

	return wrapper.findComponent(VSelectStub).props('items') as {
		text: string;
		value: number | null;
	}[];
}

test('the cache page intervals expose the sub-10s options', () => {
	const items = itemsFor([null, 1, 3, 5, 10, 30, 60, 300]);

	expect(items.map((i) => i.value)).toEqual([null, 1, 3, 5, 10, 30, 60, 300]);
});

test('null renders as off; seconds and whole-minutes get their own label', () => {
	const items = itemsFor([null, 3, 60, 300]);

	expect(items).toEqual([
		{ text: 'No refresh', value: null },
		{ text: '3s', value: 3 },
		{ text: '1m', value: 60 },
		{ text: '5m', value: 300 },
	]);
});

test('default intervals stay the upstream set when no prop is passed', () => {
	const items = itemsFor();

	expect(items.map((i) => i.value)).toEqual([null, 10, 30, 60, 300]);
});

test('a positive interval emits refresh once per period', () => {
	vi.useFakeTimers();

	try {
		const wrapper = mount(RefreshSidebarDetail, {
			props: { modelValue: 3 },
			global,
		});

		vi.advanceTimersByTime(3000);
		vi.advanceTimersByTime(3000);

		expect(wrapper.emitted('refresh')).toHaveLength(2);
	}
	finally {
		vi.useRealTimers();
	}
});

test('switching to off (null) stops the timer', async () => {
	vi.useFakeTimers();

	try {
		const wrapper = mount(RefreshSidebarDetail, {
			props: { modelValue: 3 },
			global,
		});

		vi.advanceTimersByTime(3000);
		await wrapper.setProps({ modelValue: null });
		vi.advanceTimersByTime(9000);

		// Only the pre-switch tick — nothing fires after it goes to off.
		expect(wrapper.emitted('refresh')).toHaveLength(1);
	}
	finally {
		vi.useRealTimers();
	}
});
