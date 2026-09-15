import { useRefreshInterval } from '@/composables/use-refresh-interval';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, test } from 'vitest';

const KEY = 'test-refresh-interval';

beforeEach(() => {
	localStorage.clear();
});

describe('useRefreshInterval', () => {
	// A page watched while a pool moves is reloaded all day, and an interval
	// that came back as the string '30' would leave the sidebar comparing it
	// with numbers and never arming the timer.
	test('comes back as the number the last visit was left on', () => {
		localStorage.setItem(KEY, '30');

		expect(useRefreshInterval(KEY).value).toBe(30);
	});

	test('is off where nothing was stored', () => {
		expect(useRefreshInterval(KEY).value).toBeNull();
	});

	test('stores the rate that was chosen', async () => {
		const interval = useRefreshInterval(KEY);

		interval.value = 60;
		await nextTick();

		expect(localStorage.getItem(KEY)).toBe('60');
	});
});
