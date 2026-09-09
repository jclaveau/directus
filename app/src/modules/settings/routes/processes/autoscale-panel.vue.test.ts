import type { AutoscaleNodeState, AutoscaleRunner } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return {
		default: {
			get: vi.fn(),
			patch: vi.fn(),
			post: vi.fn(),
			delete: vi.fn(),
		},
	};
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
		withoutOverride: {
			enabled: true,
			strategy: 'scalabus',
			appName: 'api',
			signal: 'average',
			sampleWindow: 5,
			scaleCpuThreshold: 60,
			releaseCpuThreshold: 40,
			minWorkers: 1,
			maxWorkers: 2,
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
			mounted: (el: any, binding: any) => el.setAttribute('title', binding.value),
			updated: (el: any, binding: any) => el.setAttribute('title', binding.value),
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

function answered(
	override: Record<string, unknown> | null,
	setByEmail: string | null = null,
) {
	const key = 'scalabus:autoscale:config';

	return { data: { data: { key, override, setByEmail } } };
}

/**
 * The panel reads two routes, and they answer different shapes: everything
 * here that is not the drill is the configuration.
 */
async function mounted(
	override: Record<string, unknown> | null,
	runners = [runner()],
	setByEmail: string | null = null,
	drill: { until: number | null; percent: number } | null = null,
) {
	vi.mocked(api.get).mockImplementation(async (url: string) => {
		if (url !== '/utils/autoscale/drill') {
			return answered(override, setByEmail);
		}

		if (drill === null) {
			throw { response: { status: 404 } };
		}

		return { data: { data: drill } };
	});

	const wrapper = mount(AutoscalePanel, { global, props: { runners } });
	await flushPromises();

	return wrapper;
}

beforeEach(() => {
	// `v-icon` reads a store, so the panel needs a pinia to mount at all.
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	vi.mocked(api.get).mockReset();
	vi.mocked(api.patch).mockReset();
	vi.mocked(api.post).mockReset();
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

		expect((ceiling?.find('input').element as HTMLInputElement).value).toBe('8');

		// Where a value came from is read inside the field it belongs to, under
		// the name the page gives that layer.
		expect(ceiling?.findAll('td')).toHaveLength(2);
		expect(ceiling?.find('.edit .source').text()).toBe('config');
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

	// One place to read a field and one to change it, rather than a column of
	// running values beside a column of inputs holding the same numbers.
	test('a field with no override still holds the running value', async () => {
		const wrapper = await mounted(null);

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith('maxWorkers'));

		expect((ceiling?.find('input').element as HTMLInputElement).value).toBe('4');
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

		expect((ceiling?.find('input').element as HTMLInputElement).value).toBe('8');
	});

	// A uuid names nobody to the person reading it, and the same override is
	// reachable from two surfaces — so both are read off the stamp.
	test('who set the config, and through what, rides along with it', async () => {
		const stamp = {
			maxWorkers: 8,
			setBy: '2bcde43c-dda4-4478-b2dd-138e18759c0c',
			setAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
			setFrom: 'mcp',
			note: 'the friday spike',
		};

		const wrapper = await mounted(stamp, [runner()], 'ann@example.com');

		// One sentence, spaces and all: assembled out of template fragments the
		// conditional ones lose the space that separates them.
		expect(wrapper.find('.stamp').text()).toBe(
			'Configured by ann@example.com from the system MCP 2d ago '
				+ '— the friday spike',
		);
	});

	// A user deleted since is still an answer to who left the override, so the
	// id the api could not name stands in for the address.
	test('an id the api could not name is shown as it stands', async () => {
		const wrapper = await mounted({
			maxWorkers: 8,
			setBy: 'gone-user',
			setAt: new Date().toISOString(),
			setFrom: 'admin',
		});

		expect(wrapper.find('.stamp').text())
			.toBe('Configured by gone-user from the admin 0d ago');
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

});

describe('the whole form at once', () => {
	function row(wrapper: any, field: string) {
		return wrapper.findAll('tbody tr')
			.find((candidate: any) => candidate.text().startsWith(field));
	}

	async function press(wrapper: any, label: string) {
		const button = wrapper.findAll('.bulk button')
			.find((candidate: any) => candidate.text().includes(label));

		await button.trigger('click');
		await flushPromises();
	}

	// Fields that only make sense together — a floor raised past the old
	// ceiling — reach the loop on one tick rather than through a refused write.
	test('every pending change is applied in one write', async () => {
		const wrapper = await mounted({});

		await row(wrapper, 'minWorkers').find('input')
			.setValue('6');

		await row(wrapper, 'maxWorkers').find('input')
			.setValue('8');

		await press(wrapper, 'Apply all');

		expect(api.patch).toHaveBeenCalledTimes(1);

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			minWorkers: 6,
			maxWorkers: 8,
		});
	});

	test('resetting the changes writes nothing and puts the values back', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });
		const input = row(wrapper, 'maxWorkers').find('input');

		await input.setValue('16');
		await press(wrapper, 'Reset all');

		expect(api.patch).not.toHaveBeenCalled();
		expect((input.element as HTMLInputElement).value).toBe('8');
	});

	test('both change buttons wait for a change to act on', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });

		function pending(): boolean[] {
			return wrapper.findAll('.bulk button')
				.slice(0, 2)
				.map((button: any) => button.attributes('disabled') !== undefined);
		}

		expect(pending()).toEqual([true, true]);

		await row(wrapper, 'maxWorkers').find('input')
			.setValue('16');

		expect(pending()).toEqual([false, false]);
	});

	test('resetting to env deletes the key and reloads the report', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });
		await press(wrapper, 'Reset to env');

		expect(api.delete).toHaveBeenCalledWith('/utils/autoscale');
		expect(wrapper.emitted('changed')).toHaveLength(1);
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

		// The third button resets the stored value, which needs no pending
		// change and is asserted with the rest of resetting.
		expect(untouched.findAllComponents(VButton)
			.slice(0, 2)
			.map((button: any) => button.props('disabled')))
			.toEqual([true, true]);

		await untouched.find('input').setValue('16');

		expect(row(wrapper, 'maxWorkers').findAllComponents(VButton)
			.slice(0, 2)
			.map((button: any) => button.props('disabled')))
			.toEqual([false, false]);
	});

	test('resetting one field writes a null for that field alone', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });

		await row(wrapper, 'maxWorkers').find('.reset button')
			.trigger('click');

		await flushPromises();

		expect(api.patch)
			.toHaveBeenCalledWith('/utils/autoscale', { maxWorkers: null });
	});

	// Resetting hands the field back to the env chain, and the value waiting
	// there is the deciding process's to report.
	test('the reset button names the value it would land on', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });

		const buttons = row(wrapper, 'maxWorkers').findAllComponents(VButton);

		expect(buttons[2].props('tooltip')).toBe('Reset to the environment: 2');

		// A field with nothing stored has nothing to reset.
		const floor = row(wrapper, 'minWorkers').findAllComponents(VButton);

		expect(floor[2].props('disabled')).toBe(true);
	});

	// The legacy rule reads its own window and its hottest worker, so leaving
	// these editable would offer changes that do nothing.
	test('the fields the running rule ignores are disabled', async () => {
		const legacy = state();
		legacy.config.strategy = 'legacy';

		const wrapper = await mounted({ strategy: 'legacy' }, [runner(legacy)]);
		const window = row(wrapper, 'sampleWindow');

		expect(window.classes()).toContain('inactive');
		expect(window.findComponent(VInput).props('disabled')).toBe(true);

		expect(window.findAllComponents(VButton)
			.map((button: any) => button.props('disabled')))
			.toEqual([true, true, true]);

		expect(row(wrapper, 'scaleCpuThreshold').classes()).not.toContain('inactive');
	});

	// Clearing a field is the third button's job, and a select offering the same
	// thing under a different word made two answers to one question.
	test('a select offers its values and nothing else', async () => {
		const wrapper = await mounted(null);

		const select = row(wrapper, 'strategy').findComponent(VSelect);

		expect(select.props('showDeselect')).toBe(false);
	});

	// Switching rule blinds four fields, and seeing which ones before applying
	// is part of deciding to.
	test('picking legacy greys what it would blind, before applying', async () => {
		const wrapper = await mounted(null);

		row(wrapper, 'strategy').findComponent(VSelect).vm
			.$emit('update:modelValue', 'legacy');

		await flushPromises();

		expect(row(wrapper, 'sampleWindow').classes()).toContain('inactive');
		expect(api.patch).not.toHaveBeenCalled();
	});

	// A number reads as one phrase with the unit that names it, and a name has
	// no unit to sit beside.
	test('a number sits against its unit', async () => {
		const wrapper = await mounted(null);

		const ceiling = row(wrapper, 'maxWorkers').find('.control');
		const name = row(wrapper, 'appName').find('.control');

		expect(ceiling.classes()).toContain('numeric');
		expect(name.classes()).not.toContain('numeric');
	});

	// Which layer holds a value is settled; whether the box still agrees with
	// it is the live question, so that is what the row colours.
	test('a typed value says which layer it would come from', async () => {
		const wrapper = await mounted(null);
		const threshold = row(wrapper, 'scaleCpuThreshold');

		expect(threshold.find('.source').text()).toBe('default');
		expect(threshold.find('.source').classes()).not.toContain('pending');
		expect(threshold.find('.control').classes()).not.toContain('pending');

		await threshold.find('input').setValue('75');

		const typed = row(wrapper, 'scaleCpuThreshold');

		expect(typed.find('.source').text()).toBe('config');
		expect(typed.find('.source').classes()).toContain('pending');
		expect(typed.find('.control').classes()).toContain('pending');
	});

	// Emptying a field hands it back to the environment, so naming the config
	// it is being taken out of would say the opposite of what is about to
	// happen.
	test('a field emptied back to the environment names no layer', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });

		await row(wrapper, 'maxWorkers').find('input')
			.setValue('');

		const emptied = row(wrapper, 'maxWorkers');

		expect(emptied.find('.source').text()).toBe('—');
	});

	test('a field says what it does to the pool on hover', async () => {
		const wrapper = await mounted(null);

		const name = row(wrapper, 'maxWorkers').find('td span');

		expect(name.attributes('title')).toContain('never grows past this');
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

describe('the load drill', () => {
	const drill = { until: null, percent: 80 };

	// The route only exists where the deployment asked for it, so its absence
	// is the answer to "can load be made here".
	test('a deployment without the drill is offered none', async () => {
		const wrapper = await mounted({});

		expect(wrapper.find('.drill').exists()).toBe(false);
	});

	test('a quiet pool is offered a drill', async () => {
		const wrapper = await mounted({}, [runner()], null, drill);

		expect(wrapper.find('.drill').exists()).toBe(true);

		const start = wrapper.findAll('.drill button')
			.find((button) => button.text().includes('Run a load drill'));

		expect(start?.attributes('disabled')).toBeUndefined();
	});

	// A drill laid over real traffic measures the traffic and the drill
	// together, and buys workers nobody asked for.
	test('a pool already working is not offered one, and is told why', async () => {
		const busy = state({ cpuPercents: [12, 55] });
		const wrapper = await mounted({}, [runner(busy)], null, drill);

		const start = wrapper.findAll('.drill button')
			.find((button) => button.text().includes('Run a load drill'));

		expect(start?.attributes('disabled')).toBeDefined();
		expect(wrapper.find('.drill').text()).toContain('already working');
	});

	test('starting one asks for the seconds and the share in the boxes', async () => {
		vi.mocked(api.post).mockResolvedValue({
			data: { data: { until: Date.now() + 60_000, percent: 80 } },
		});

		const wrapper = await mounted({}, [runner()], null, drill);
		const inputs = wrapper.findAll('.drill input');

		await inputs[0]!.setValue('45');
		await inputs[1]!.setValue('70');

		await wrapper.findAll('.drill button')
			.find((button) => button.text().includes('Run a load drill'))!
			.trigger('click');

		await flushPromises();

		expect(api.post).toHaveBeenCalledWith(
			'/utils/autoscale/drill',
			{ seconds: 45, percent: 70 },
		);

		expect(wrapper.find('.drill').text()).toContain('every worker busy');
		expect(wrapper.find('.drill').text()).toContain('60s left');
	});

	test('a running drill offers the way out of it', async () => {
		vi.mocked(api.delete).mockResolvedValue({
			data: { data: { until: null, percent: 80 } },
		});

		const running = { until: Date.now() + 30_000, percent: 80 };
		const wrapper = await mounted({}, [runner()], null, running);

		expect(wrapper.find('.drill').text()).toContain('30s left');

		await wrapper.findAll('.drill button')
			.find((button) => button.text().includes('Stop the drill'))!
			.trigger('click');

		await flushPromises();

		expect(api.delete).toHaveBeenCalledWith('/utils/autoscale/drill');
		expect(wrapper.find('.drill').text()).toContain('Run a load drill');
	});

	test('a refused drill is reported as the api put it', async () => {
		vi.mocked(api.post).mockRejectedValue({
			response: { data: { errors: [{ message: 'the pool is already working' }] } },
		});

		const wrapper = await mounted({}, [runner()], null, drill);

		await wrapper.findAll('.drill button')
			.find((button) => button.text().includes('Run a load drill'))!
			.trigger('click');

		await flushPromises();

		expect(wrapper.text()).toContain('the pool is already working');
	});
});
