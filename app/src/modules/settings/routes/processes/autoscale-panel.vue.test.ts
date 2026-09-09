import type { AutoscaleNodeState, AutoscaleRunner } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return { default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

import { createMemoryHistory, createRouter } from 'vue-router';
import api from '@/api';
import VButton from '@/components/v-button.vue';
import VChip from '@/components/v-chip.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VInput from '@/components/v-input.vue';
import VNotice from '@/components/v-notice.vue';
import VSelect from '@/components/v-select/v-select.vue';
import AutoscalePanel from './autoscale-panel.vue';

function state(overrides: Partial<AutoscaleNodeState> = {}): AutoscaleNodeState {
	return {
		at: Date.now(),
		config: {
			enabled: true,
			strategy: 'scalabus',
			appName: 'api',
			signal: 'average',
			sampleWindow: 5,
			scaleCpuThreshold: 60,
			releaseCpuThreshold: 40,
			minWorkers: 1,
			maxWorkers: 4,
			prewarmWorkers: 0,
			minSecondsToScaleUp: 10,
			minSecondsToScaleDown: 300,
			warmupSeconds: 30,
		},
		sources: {
			enabled: 'default',
			strategy: 'default',
			appName: 'env',
			signal: 'default',
			sampleWindow: 'default',
			scaleCpuThreshold: 'default',
			releaseCpuThreshold: 'default',
			minWorkers: 'default',
			maxWorkers: 'override',
			prewarmWorkers: 'default',
			minSecondsToScaleUp: 'default',
			minSecondsToScaleDown: 'default',
			warmupSeconds: 'default',
		},
		workers: 3,
		pendingWorkers: 0,
		warmingWorkers: 0,
		cpuPercents: [20, 24, 22],
		lastDecision: {
			at: Date.now(),
			workers: null,
			reason: 'average cpu 22% is in the band',
		},
		lastScale: null,
		...overrides,
	};
}

function runner(nodeState = state()): AutoscaleRunner {
	return {
		service: 'Api',
		replicaId: 'replica-1',
		nodeId: 'node-1',
		name: 'api',
		state: nodeState,
	};
}

// `v-button` resolves a route whether or not it links anywhere.
const router = createRouter({
	history: createMemoryHistory(),
	routes: [{ path: '/', component: { template: '<div />' } }],
});

const global = {
	plugins: [i18n, router],
	directives: {
		tooltip: {
			mounted: () => undefined,
			updated: () => undefined,
			unmounted: () => undefined,
		},
	},
	components: { VButton, VChip, VIcon, VInput, VNotice, VSelect },
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const real = [
					'v-button',
					'v-chip',
					'v-icon',
					'v-input',
					'v-notice',
					'v-select',
				];

				return tag.includes('-') && !real.includes(tag);
			},
		},
	},
};

function answered(override: Record<string, unknown> | null) {
	return { data: { data: { key: 'scalabus:autoscale:config', override } } };
}

async function mounted(
	override: Record<string, unknown> | null,
	runners = [runner()],
) {
	vi.mocked(api.get).mockResolvedValue(answered(override));

	const wrapper = mount(AutoscalePanel, { global, props: { runners } });
	await flushPromises();

	return wrapper;
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
	test('reports the pool the loop runs, and its last decision', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });

		expect(wrapper.text()).toContain('3 workers');
		expect(wrapper.text()).toContain('average cpu 22% is in the band');

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith('maxWorkers'));

		expect(ceiling?.text()).toContain('4');
		expect(ceiling?.text()).toContain('override');
	});

	// The route only exists where Redis does, so its absence is the answer to
	// "can this be changed here" rather than a failure to report.
	test('a 404 says the deployment is tuned by its environment', async () => {
		vi.mocked(api.get).mockRejectedValue({ response: { status: 404 } });

		const props = { runners: [runner()] };
		const wrapper = mount(AutoscalePanel, { global, props });
		await flushPromises();

		expect(wrapper.text()).toContain('tuned through its environment');
		expect(wrapper.find('table.fields').exists()).toBe(false);
	});

	test('an error from the route is shown as it came', async () => {
		vi.mocked(api.get).mockRejectedValue({
			response: { data: { errors: [{ message: 'You have to be an admin' }] } },
		});

		const props = { runners: [runner()] };
		const wrapper = mount(AutoscalePanel, { global, props });
		await flushPromises();

		expect(wrapper.text()).toContain('You have to be an admin');
	});

	// The value a field would keep is worth reading while typing the one that
	// would replace it.
	test('an empty row offers the running value as a placeholder', async () => {
		const wrapper = await mounted(null);

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith('maxWorkers'));

		expect(ceiling?.find('input').attributes('placeholder')).toBe('4');
	});

	test('a field neither reported nor overridden names no source', async () => {
		const wrapper = await mounted(null, []);

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith('maxWorkers'));

		expect(ceiling?.find('.source').text()).toBe('—');
	});

	// An override applies to whichever process reads it next, so a stored one
	// with nothing running is worth saying rather than hiding.
	test('a stored override with no runner still says so', async () => {
		const wrapper = await mounted({ maxWorkers: 8 }, []);

		expect(wrapper.text()).toContain('No process reported');

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith('maxWorkers'));

		expect(ceiling?.text()).toContain('8');
	});

	test('who set the override rides along with it', async () => {
		const wrapper = await mounted({
			maxWorkers: 8,
			setBy: 'ann',
			setAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
			note: 'the friday spike',
		});

		expect(wrapper.text()).toContain('by ann');
		expect(wrapper.text()).toContain('2d ago');
		expect(wrapper.text()).toContain('the friday spike');
	});
});

describe('the levers', () => {
	async function lever(wrapper: any, label: string) {
		const button = wrapper.findAll('.levers button')
			.find((candidate: any) => candidate.text().includes(label));

		await button.trigger('click');
		await flushPromises();
	}

	test('pausing writes the one field that stops the loop', async () => {
		const wrapper = await mounted({});
		await lever(wrapper, 'Pause');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', { enabled: false });

		// The values shown come from the process report, which the page holding
		// this panel re-reads.
		expect(wrapper.emitted('changed')).toHaveLength(1);
	});

	test('a paused pool offers to resume it', async () => {
		const paused = state();
		paused.config.enabled = false;

		const wrapper = await mounted({ enabled: false }, [runner(paused)]);
		await lever(wrapper, 'Resume');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', { enabled: true });
	});

	test('pinning holds the pool at the size it reported', async () => {
		const wrapper = await mounted({});
		await lever(wrapper, 'Pin');

		expect(api.patch)
			.toHaveBeenCalledWith('/utils/autoscale', { minWorkers: 3, maxWorkers: 3 });
	});

	test('unpinning clears both bounds rather than guessing them', async () => {
		const pinned = state();
		pinned.config.minWorkers = 3;
		pinned.config.maxWorkers = 3;

		const bounds = { minWorkers: 3, maxWorkers: 3 };
		const wrapper = await mounted(bounds, [runner(pinned)]);
		await lever(wrapper, 'Unpin');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			minWorkers: null,
			maxWorkers: null,
		});
	});

	test('the rule can be swapped for the one it replaced, and back', async () => {
		const wrapper = await mounted({});
		await lever(wrapper, 'legacy');

		expect(api.patch)
			.toHaveBeenCalledWith('/utils/autoscale', { strategy: 'legacy' });

		const legacy = state();
		legacy.config.strategy = 'legacy';

		const back = await mounted({ strategy: 'legacy' }, [runner(legacy)]);
		await lever(back, 'scalabus');

		expect(api.patch)
			.toHaveBeenCalledWith('/utils/autoscale', { strategy: 'scalabus' });
	});

	test('clearing the override deletes the key and reloads the report', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });
		await lever(wrapper, 'Clear');

		expect(api.delete).toHaveBeenCalledWith('/utils/autoscale');
		expect(wrapper.emitted('changed')).toHaveLength(1);
	});

	test('a note typed beside the levers is stored with the change', async () => {
		const wrapper = await mounted({});
		await wrapper.find('.note input').setValue('scaling for the demo');
		await lever(wrapper, 'Pause');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			enabled: false,
			note: 'scaling for the demo',
		});
	});
});

describe('editing one field', () => {
	function row(wrapper: any, field: string) {
		return wrapper.findAll('tbody tr')
			.find((candidate: any) => candidate.text().startsWith(field));
	}

	// The buttons only take a pending change, so let the one just made render
	// before pressing them.
	async function applyRow(wrapper: any, field: string) {
		await flushPromises();

		await row(wrapper, field).find('.apply button')
			.trigger('click');

		await flushPromises();
	}

	test('a number field is typed, bounded and says what it counts', async () => {
		const wrapper = await mounted(null);
		const input = row(wrapper, 'maxWorkers').findComponent(VInput);

		expect(input.props()).toMatchObject({
			type: 'number',
			min: 1,
			max: 64,
			step: 1,
			suffix: 'workers',
		});
	});

	test('a text field stays a text field', async () => {
		const wrapper = await mounted(null);

		const input = row(wrapper, 'appName').findComponent(VInput);

		expect(input.props('type')).toBe('text');
	});

	// Typing `scalabuss` into a rule that accepts two names is a silent
	// fallback, so the field offers the names instead of accepting any.
	test('a field with a fixed few values is chosen, not typed', async () => {
		const wrapper = await mounted(null);
		const select = row(wrapper, 'strategy').findComponent(VSelect);

		expect(select.props('items')).toEqual([
			{ text: 'scalabus', value: 'scalabus' },
			{ text: 'legacy', value: 'legacy' },
		]);

		// The same height as the fields it sits between.
		expect(select.props('small')).toBe(true);

		select.vm.$emit('update:modelValue', 'legacy');
		await applyRow(wrapper, 'strategy');

		expect(api.patch)
			.toHaveBeenCalledWith('/utils/autoscale', { strategy: 'legacy' });
	});

	test('a chosen boolean is written as a boolean', async () => {
		const wrapper = await mounted(null);

		row(wrapper, 'enabled').findComponent(VSelect).vm
			.$emit('update:modelValue', 'false');

		await applyRow(wrapper, 'enabled');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', { enabled: false });
	});

	async function apply(wrapper: any, field: string, typed: string) {
		const input = row(wrapper, field).find('input');

		await input.setValue(typed);
		await applyRow(wrapper, field);
	}

	test('a typed number is written as a number', async () => {
		const wrapper = await mounted({});
		await apply(wrapper, 'maxWorkers', '8');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', { maxWorkers: 8 });
	});

	test('emptying a field clears it instead of writing an empty one', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });
		await apply(wrapper, 'maxWorkers', '');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', { maxWorkers: null });
	});

	test('a change is discarded without writing it', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });
		const input = row(wrapper, 'maxWorkers').find('input');

		await input.setValue('16');

		await row(wrapper, 'maxWorkers').find('.cancel button')
			.trigger('click');

		await flushPromises();

		expect(api.patch).not.toHaveBeenCalled();
		expect((input.element as HTMLInputElement).value).toBe('8');
	});

	// Both buttons act on a pending change, and pressing one with nothing typed
	// would clear the field rather than do nothing.
	test('both buttons wait for a change to act on', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });
		const untouched = row(wrapper, 'maxWorkers');

		expect(untouched.findAllComponents(VButton)
			.map((button: any) => button.props('disabled')))
			.toEqual([true, true]);

		await untouched.find('input').setValue('16');

		expect(row(wrapper, 'maxWorkers').findAllComponents(VButton)
			.map((button: any) => button.props('disabled')))
			.toEqual([false, false]);
	});

	test('a failed write is reported and leaves the panel usable', async () => {
		vi.mocked(api.patch).mockRejectedValue({
			response: { data: { errors: [{ message: 'maxWorkers has to be a number' }] } },
		});

		const wrapper = await mounted({});
		await apply(wrapper, 'maxWorkers', 'eight');

		expect(wrapper.text()).toContain('maxWorkers has to be a number');
		expect(wrapper.emitted('changed')).toBeUndefined();
	});
});
