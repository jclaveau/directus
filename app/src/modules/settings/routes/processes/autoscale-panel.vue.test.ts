import type { AutoscaleNodeState, AutoscaleRunner } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';

const notified = vi.hoisted(() => {
	return { notify: vi.fn() };
});

vi.mock('@/utils/notify', () => {
	return { notify: notified.notify };
});

// `v-dialog` traps focus inside itself while it is open, and hands it back on
// the way out. jsdom reports nothing as tabbable, so the trap has no node to
// hold and refuses the hand-back — a rejection raised while a browser is doing
// the one thing this file never asserts on.
vi.mock('@vueuse/integrations/useFocusTrap', () => {
	return {
		useFocusTrap: () => {
			return { activate: vi.fn(), deactivate: vi.fn() };
		},
	};
});

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
import VCard from '@/components/v-card.vue';
import VCardActions from '@/components/v-card-actions.vue';
import VCardText from '@/components/v-card-text.vue';
import VCardTitle from '@/components/v-card-title.vue';
import VChip from '@/components/v-chip.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VDialog from '@/components/v-dialog.vue';
import VInput from '@/components/v-input.vue';
import VNotice from '@/components/v-notice.vue';
import VSelect from '@/components/v-select/v-select.vue';
import { configRows } from './autoscale-panel';
import AutoscalePanel from './autoscale-panel.vue';

/** The name the page shows a field under, which is what a row starts with. */
function variableOf(field: string): string {
	return configRows(null, null).find((row) => row.field === field)!.variable;
}

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
		reload: { askedAt: null, running: false, finishedAt: null, error: null },
		supervisor: null,
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
	components: {
		VButton,
		VCard,
		VCardActions,
		VCardText,
		VCardTitle,
		VChip,
		VDialog,
		VIcon,
		VInput,
		VNotice,
		VSelect,
	},
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const real = [
					'v-button',
					'v-card',
					'v-card-actions',
					'v-card-text',
					'v-card-title',
					'v-chip',
					'v-dialog',
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
	const key = 'scalabus:config:pm2';

	return {
		data: {
			data: {
				key,
				override,
				setByEmail,
				supervisor: {
					key: 'scalabus:config:pm2:supervisor',
					override: supervisorOverride,
					setByEmail: null,
				},
			},
		},
	};
}

/** What the supervisor answer carries, set by the case that cares. */
let supervisorOverride: Record<string, unknown> | null = null;

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
	// The restart confirmation is a dialog, which the app teleports into an
	// outlet the layout owns.
	document.body.innerHTML = '<div id="dialog-outlet"></div>';

	// `v-icon` reads a store, so the panel needs a pinia to mount at all.
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	vi.mocked(api.get).mockReset();
	vi.mocked(api.patch).mockReset();
	vi.mocked(api.post).mockReset();
	vi.mocked(api.delete).mockReset();
	supervisorOverride = null;
	notified.notify.mockReset();
	vi.mocked(api.patch).mockResolvedValue(answered({}));
	vi.mocked(api.delete).mockResolvedValue(answered(null));
});

describe('what the panel shows', () => {
	test('reports the pool the loop runs, and its last decision', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });

		expect(wrapper.text()).toContain('3 workers');
		expect(wrapper.text()).toContain('average cpu 22% is in the band');

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith(variableOf('maxWorkers')));

		expect((ceiling?.find('input').element as HTMLInputElement).value).toBe('8');

		// Where a value came from is read inside the field it belongs to, under
		// the name the page gives that layer.
		expect(ceiling?.findAll('td')).toHaveLength(2);
		expect(ceiling?.find('.edit .source').text()).toBe('config');
	});

	// The route only exists where Redis does, so its absence is the answer to
	// "can this be changed here" rather than a failure to report.
	// The two numbers that both claim the pool size, on one page: a pool at four
	// workers under a declaration asking for two is the autoscaler's doing, and
	// nothing says so while only one of them is reported.
	test('the pm2 declaration is reported beside the config', async () => {
		const declared = state({
			supervisor: {
				instances: 2,
				execMode: 'cluster_mode',
				maxMemoryRestart: null,
				listenTimeout: 3000,
				killTimeout: 1600,
				minUptime: 1000,
				maxRestarts: 16,
				restartDelay: 0,
				autorestart: true,
				waitReady: true,
			},
		});

		const wrapper = await mounted(null, [runner(declared)]);

		const row = wrapper.findAll('.supervisor tbody tr')
			.find((line) => line.text().startsWith('PM2_INSTANCES'));

		expect((row?.find('input').element as HTMLInputElement).value).toBe('2');
	});

	// The six options a rolling restart can carry take a value here; the pool
	// size and its mode cannot be pushed to a running supervisor at all.
	test('a restart carries the options that take a value', async () => {
		const declared = state({
			supervisor: {
				instances: 2,
				execMode: 'cluster_mode',
				maxMemoryRestart: null,
				listenTimeout: 15000,
				killTimeout: 1600,
				minUptime: 1000,
				maxRestarts: 16,
				restartDelay: 0,
				autorestart: true,
				waitReady: true,
			},
		});

		const wrapper = await mounted(null, [runner(declared)]);
		const rows = wrapper.findAll('.supervisor tbody tr');

		const listen = rows.find((row) => row.text().startsWith('PM2_LISTEN_TIMEOUT'));
		const instances = rows.find((row) => row.text().startsWith('PM2_INSTANCES'));

		// An empty box is the environment answering, and what it answers with
		// is what the pool is running under.
		expect((listen?.find('input').element as HTMLInputElement).placeholder)
			.toBe('15000');

		// The pool size reads in the same box as the rest, with no way to type
		// into it: a restart cannot carry it.
		expect((instances?.find('input').element as HTMLInputElement).disabled)
			.toBe(true);

		// Nothing declares a memory ceiling by default, and an empty box has
		// to say so rather than read as a zero the option would refuse.
		const memory = rows.find((row) => row.text().startsWith('PM2_MAX_MEMORY'));

		expect((memory?.find('input').element as HTMLInputElement).placeholder)
			.toBe('off');
	});

	test('a stored option is shown in the box that would change it', async () => {
		supervisorOverride = { listenTimeout: 20000 };

		const declared = state({
			supervisor: {
				instances: 2,
				execMode: 'cluster_mode',
				maxMemoryRestart: null,
				listenTimeout: 15000,
				killTimeout: 1600,
				minUptime: 1000,
				maxRestarts: 16,
				restartDelay: 0,
				autorestart: true,
				waitReady: true,
			},
		});

		const wrapper = await mounted(null, [runner(declared)]);

		const listen = wrapper.findAll('.supervisor tbody tr')
			.find((row) => row.text().startsWith('PM2_LISTEN_TIMEOUT'));

		expect((listen?.find('input').element as HTMLInputElement).value)
			.toBe('20000');
	});

	// A pool nothing reported a declaration for gets no section rather than a
	// table of the values pm2 would have fallen back to.
	test('a pool with no declaration reported shows no supervisor', async () => {
		const wrapper = await mounted(null);

		expect(wrapper.find('.supervisor').exists()).toBe(false);
	});

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
			.find((row) => row.text().startsWith(variableOf('maxWorkers')));

		expect((ceiling?.find('input').element as HTMLInputElement).value).toBe('4');
	});

	test('a field neither reported nor overridden names no source', async () => {
		const wrapper = await mounted(null, []);

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith(variableOf('maxWorkers')));

		expect(ceiling?.find('.source').text()).toBe('—');
	});

	// An override applies to whichever process reads it next, so a stored one
	// with nothing running is worth saying rather than hiding.
	test('a stored override with no runner still says so', async () => {
		const wrapper = await mounted({ maxWorkers: 8 }, []);

		expect(wrapper.text()).toContain('No process reported');

		const ceiling = wrapper.findAll('tbody tr')
			.find((row) => row.text().startsWith(variableOf('maxWorkers')));

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

// A bare `scalabus:config:pm2` reads as an identifier of something, with no
// way to tell what holds it or what it is for.
test('the key says what it is a key to', async () => {
	const wrapper = await mounted(null);

	expect(wrapper.find('.key').text())
		.toBe('Stored in Redis under scalabus:config:pm2');
});

describe('the levers', () => {
	// The levers are icons in the title bar, so what each one offers is read
	// off the tooltip the test directive writes into `title`.
	async function lever(wrapper: any, name: string) {
		await wrapper.find(`.${name} button`).trigger('click');
		await flushPromises();
	}

	function offers(wrapper: any, name: string): string {
		return wrapper.find(`.${name}`).attributes('title');
	}

	test('pausing writes the one field that stops the loop', async () => {
		const wrapper = await mounted({});

		expect(offers(wrapper, 'pause')).toBe('Pause autoscaling');

		await lever(wrapper, 'pause');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			enabled: false,
			note: null,
		});

		// The values shown come from the process report, which the page holding
		// this panel re-reads.
		expect(wrapper.emitted('changed')).toHaveLength(1);
	});

	test('a paused pool offers to resume it', async () => {
		const paused = state();
		paused.config.enabled = false;

		const wrapper = await mounted({ enabled: false }, [runner(paused)]);

		expect(offers(wrapper, 'pause')).toBe('Resume autoscaling');

		await lever(wrapper, 'pause');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			enabled: true,
			note: null,
		});
	});

	test('pinning holds the pool at the size it reported', async () => {
		const wrapper = await mounted({});

		expect(offers(wrapper, 'pin')).toBe('Pin the pool where it is');

		await lever(wrapper, 'pin');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			minWorkers: 3,
			maxWorkers: 3,
			note: null,
		});
	});

	test('unpinning clears both bounds rather than guessing them', async () => {
		const pinned = state();
		pinned.config.minWorkers = 3;
		pinned.config.maxWorkers = 3;

		const bounds = { minWorkers: 3, maxWorkers: 3 };
		const wrapper = await mounted(bounds, [runner(pinned)]);

		expect(offers(wrapper, 'pin')).toBe('Unpin the pool');

		await lever(wrapper, 'pin');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			minWorkers: null,
			maxWorkers: null,
			note: null,
		});
	});

});

describe('restarting the pool', () => {
	// The confirmation is a dialog, which the layout teleports out of the
	// panel's own element — so it is reached through the component tree.
	function inDialog(wrapper: any, name: string) {
		return wrapper.findAllComponents(VButton)
			.find((candidate: any) => candidate.classes().includes(name))!
			.find('button');
	}

	// The page is served by a worker the restart replaces, so the ask goes to
	// the process that scales the pool rather than to this one.
	test('a restart is asked for once it has been confirmed', async () => {
		const wrapper = await mounted(null);

		await wrapper.find('.restart button').trigger('click');
		expect(api.post).not.toHaveBeenCalled();

		await inDialog(wrapper, 'restart-confirm').trigger('click');
		await flushPromises();

		expect(api.post).toHaveBeenCalledWith('/utils/autoscale/reload');
	});

	// What a restart costs is what the confirmation is for, so what it does to
	// the pool is said in the dialog rather than under the button that opens it.
	test('the confirmation says what a restart does to the pool', async () => {
		const wrapper = await mounted(null);

		await wrapper.find('.restart button').trigger('click');

		expect(document.querySelector('#dialog-outlet')!.textContent)
			.toContain('each one only once its replacement is serving');
	});

	// The drawer holding the panel is often closed by the time a restart ends,
	// and a line in it would be read by nobody.
	test('the end of a restart is announced, not left on the page', async () => {
		const asked = state({
			reload: { askedAt: 1000, running: true, finishedAt: null, error: null },
		});

		const wrapper = await mounted(null, [runner(asked)]);

		expect(notified.notify).not.toHaveBeenCalled();

		const ended = state({
			reload: { askedAt: 1000, running: false, finishedAt: 2000, error: null },
		});

		await wrapper.setProps({ runners: [runner(ended)] });

		expect(notified.notify)
			.toHaveBeenCalledWith({ title: 'The pool finished restarting' });

		expect(wrapper.find('.reload').exists()).toBe(false);
	});

	// The page renders this panel before the first report reaches it, so the
	// panel mounts on an empty pool and the report arrives as a change: any pool
	// that has ever finished a restart carries the end of one.
	test('a restart that ended before the page opened is not announced', async () => {
		const ended = state({
			reload: { askedAt: 1000, running: false, finishedAt: 2000, error: null },
		});

		const wrapper = await mounted(null, []);
		await wrapper.setProps({ runners: [runner(ended)] });

		expect(notified.notify).not.toHaveBeenCalled();
	});

	// A restart the supervisor refused is not an end worth congratulating, and
	// the failure stays on the page for as long as it is the last thing to have
	// happened.
	test('a restart that failed is not announced as one that ran', async () => {
		const asked = state({
			reload: { askedAt: 1000, running: true, finishedAt: null, error: null },
		});

		const wrapper = await mounted(null, [runner(asked)]);

		const failed = state({
			reload: {
				askedAt: 1000,
				running: false,
				finishedAt: 2000,
				error: 'Reload in progress',
			},
		});

		await wrapper.setProps({ runners: [runner(failed)] });

		expect(notified.notify).not.toHaveBeenCalled();
		expect(wrapper.find('.reload').text()).toContain('Reload in progress');
	});

	test('backing out of a restart asks for nothing', async () => {
		const wrapper = await mounted(null);

		await wrapper.find('.restart button').trigger('click');
		await inDialog(wrapper, 'restart-cancel').trigger('click');

		expect(wrapper.find('.restart').exists()).toBe(true);
		expect(api.post).not.toHaveBeenCalled();
	});

	// A second ask while the supervisor is mid-restart is one pm2 refuses, and
	// a button that offers it is a button that reports a failure.
	test('a pool already restarting is not offered another', async () => {
		const running = state({
			reload: { askedAt: 1, running: true, finishedAt: null, error: null },
		});

		const wrapper = await mounted(null, [runner(running)]);

		expect(wrapper.find('.restart button').attributes('disabled'))
			.toBeDefined();

		expect(wrapper.text()).toContain('restarting the pool, worker by worker');
	});

	test('a restart the supervisor refused is reported as it came', async () => {
		const failed = state({
			reload: {
				askedAt: 1,
				running: false,
				finishedAt: 2,
				error: 'Reload in progress',
			},
		});

		const wrapper = await mounted(null, [runner(failed)]);

		expect(wrapper.text())
			.toContain('the last restart failed: Reload in progress');
	});
});

describe('the whole form at once', () => {
	function row(wrapper: any, field: string) {
		return wrapper.findAll('tbody tr')
			.find((candidate: any) => candidate.text().startsWith(variableOf(field)));
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
			note: null,
		});
	});

	// The whole set is judged against the whole configuration, so this is the
	// write most likely to be refused — and the one whose typing costs most.
	test('a refused write keeps every pending change', async () => {
		vi.mocked(api.patch).mockRejectedValue({
			response: {
				data: { errors: [{ message: 'minWorkers is 6, above the ceiling of 4' }] },
			},
		});

		const wrapper = await mounted({});

		await row(wrapper, 'minWorkers').find('input')
			.setValue('6');

		await row(wrapper, 'maxWorkers').find('input')
			.setValue('8');

		await press(wrapper, 'Apply all');

		expect(wrapper.text()).toContain('above the ceiling');

		expect(row(wrapper, 'minWorkers').find('input').element.value).toBe('6');
		expect(row(wrapper, 'maxWorkers').find('input').element.value).toBe('8');
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
			.find((candidate: any) => candidate.text().startsWith(variableOf(field)));
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

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			strategy: 'legacy',
			note: null,
		});
	});

	test('a chosen boolean is written as a boolean', async () => {
		const wrapper = await mounted(null);

		row(wrapper, 'enabled').findComponent(VSelect).vm
			.$emit('update:modelValue', 'false');

		await applyRow(wrapper, 'enabled');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			enabled: false,
			note: null,
		});
	});

	async function apply(wrapper: any, field: string, typed: string) {
		const input = row(wrapper, field).find('input');

		await input.setValue(typed);
		await applyRow(wrapper, field);
	}

	test('a typed number is written as a number', async () => {
		const wrapper = await mounted({});
		await apply(wrapper, 'maxWorkers', '8');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			maxWorkers: 8,
			note: null,
		});
	});

	test('emptying a field clears it instead of writing an empty one', async () => {
		const wrapper = await mounted({ maxWorkers: 8 });
		await apply(wrapper, 'maxWorkers', '');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			maxWorkers: null,
			note: null,
		});
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

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			maxWorkers: null,
			note: null,
		});
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

	// The message says what is wrong with the value, and the value is what has
	// to be corrected: a box emptied under the operator leaves them retyping it
	// from the message alone.
	test('a refused write leaves the value there to correct', async () => {
		vi.mocked(api.patch).mockRejectedValue({
			response: { data: { errors: [{ message: 'maxWorkers is 400' }] } },
		});

		const wrapper = await mounted({});
		await apply(wrapper, 'maxWorkers', '400');

		expect(row(wrapper, 'maxWorkers').find('input').element.value).toBe('400');
	});

	// The override outlives the incident that justified it, and what it is then
	// asked is why — which no lever and no field can answer.
	test('the reason typed beside the fields is stored with the change', async () => {
		const wrapper = await mounted({});

		await wrapper.find('.note input').setValue('ceiling raised for the launch');
		await apply(wrapper, 'maxWorkers', '8');

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', {
			maxWorkers: 8,
			note: 'ceiling raised for the launch',
		});
	});

	// A reason left behind would date and attribute the next change with the
	// reason for the last one.
	test('a reason belongs to the change that carried it', async () => {
		const wrapper = await mounted({});

		await wrapper.find('.note input').setValue('pinned during the incident');
		await apply(wrapper, 'maxWorkers', '8');
		await apply(wrapper, 'minWorkers', '2');

		expect(api.patch).toHaveBeenLastCalledWith('/utils/autoscale', {
			minWorkers: 2,
			note: null,
		});
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

describe('the options a restart carries', () => {
	function declared() {
		return state({
			supervisor: {
				instances: 2,
				execMode: 'cluster_mode',
				maxMemoryRestart: null,
				listenTimeout: 15000,
				killTimeout: 1600,
				minUptime: 1000,
				maxRestarts: 16,
				restartDelay: 0,
				autorestart: true,
				waitReady: true,
			},
		});
	}

	function optionRow(wrapper: any, variable: string) {
		return wrapper.findAll('.supervisor tbody tr')
			.find((row: any) => row.text().startsWith(variable));
	}

	// The layer a box is showing, read the same way as on the configuration
	// above it rather than left to be guessed from whether the box is filled.
	test('a row names the layer its value comes from', async () => {
		supervisorOverride = { listenTimeout: 20000 };

		const wrapper = await mounted(null, [runner(declared())]);

		const stored = optionRow(wrapper, 'PM2_LISTEN_TIMEOUT').find('.source');
		const declaring = optionRow(wrapper, 'PM2_KILL_TIMEOUT').find('.source');

		expect(stored.text()).toBe('config');
		expect(declaring.text()).toBe('pm2');
	});

	// A change typed but not stored is the page's, and saying it comes from the
	// supervisor until it is applied would name the layer it is about to leave.
	test('a typed option reads as stored before it is', async () => {
		const wrapper = await mounted(null, [runner(declared())]);
		const row = optionRow(wrapper, 'PM2_KILL_TIMEOUT');

		await row.find('input').setValue('2000');

		expect(row.find('.source').text()).toBe('config');

		await row.find('.edit .cancel button').trigger('click');

		expect(row.find('.source').text()).toBe('pm2');
	});

	// Its own route because it lands somewhere else: nothing about the pool
	// changes until the restart below pushes it.
	test('a stored option goes to the supervisor, not to the loop', async () => {
		const wrapper = await mounted(null, [runner(declared())]);
		const row = optionRow(wrapper, 'PM2_LISTEN_TIMEOUT');

		await row.find('input').setValue('20000');
		await row.find('.edit .apply button').trigger('click');
		await flushPromises();

		expect(api.patch).toHaveBeenCalledWith(
			'/utils/autoscale/supervisor',
			{ listenTimeout: 20000, note: null },
		);
	});

	// Emptying the box is the same ask as the button, so both have to reach the
	// route as the null that releases the option rather than as a zero.
	test('an emptied option is handed back to the environment', async () => {
		supervisorOverride = { killTimeout: 5000 };

		const wrapper = await mounted(null, [runner(declared())]);
		const row = optionRow(wrapper, 'PM2_KILL_TIMEOUT');

		await row.find('input').setValue('');
		await row.find('.edit .apply button').trigger('click');
		await flushPromises();

		expect(api.patch).toHaveBeenCalledWith(
			'/utils/autoscale/supervisor',
			{ killTimeout: null, note: null },
		);
	});

	test('the reset button releases an option nobody retyped', async () => {
		supervisorOverride = { maxRestarts: 30 };

		const wrapper = await mounted(null, [runner(declared())]);
		const row = optionRow(wrapper, 'PM2_MAX_RESTARTS');

		await row.find('.edit .reset button').trigger('click');
		await flushPromises();

		expect(api.patch).toHaveBeenCalledWith(
			'/utils/autoscale/supervisor',
			{ maxRestarts: null, note: null },
		);
	});

	// One box for both tables: a restart option is changed during the same
	// incident, through the same page, and is worth the same sentence.
	test('the reason reaches the supervisor route too', async () => {
		const wrapper = await mounted(null, [runner(declared())]);

		await wrapper.find('.note input').setValue('listen timeout raised');

		const row = optionRow(wrapper, 'PM2_LISTEN_TIMEOUT');
		await row.find('input').setValue('20000');
		await row.find('.edit .apply button').trigger('click');
		await flushPromises();

		expect(api.patch).toHaveBeenCalledWith(
			'/utils/autoscale/supervisor',
			{ listenTimeout: 20000, note: 'listen timeout raised' },
		);
	});

	// The refusal is the supervisor's, and the page has no better answer than
	// the one it came with.
	test('a refused option is reported as it came', async () => {
		vi.mocked(api.patch).mockRejectedValue({
			response: {
				data: { errors: [{ message: 'kill_timeout has to be at least 100' }] },
			},
		});

		const wrapper = await mounted(null, [runner(declared())]);
		const row = optionRow(wrapper, 'PM2_KILL_TIMEOUT');

		await row.find('input').setValue('10');
		await row.find('.edit .apply button').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('kill_timeout has to be at least 100');
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

		expect(wrapper.find('.drill-start button').attributes('disabled'))
			.toBeUndefined();
	});

	// A drill laid over real traffic measures the traffic and the drill
	// together, and buys workers nobody asked for.
	test('a pool already working is not offered one, and is told why', async () => {
		const busy = state({ cpuPercents: [12, 55] });
		const wrapper = await mounted({}, [runner(busy)], null, drill);

		expect(wrapper.find('.drill-start button').attributes('disabled'))
			.toBeDefined();

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

		await wrapper.find('.drill-start button').trigger('click');

		await flushPromises();

		expect(api.post).toHaveBeenCalledWith(
			'/utils/autoscale/drill',
			{ seconds: 45, percent: 70 },
		);

		expect(wrapper.find('.drill').text()).toContain('60s left');
	});

	test('a running drill offers the way out of it', async () => {
		vi.mocked(api.delete).mockResolvedValue({
			data: { data: { until: null, percent: 80 } },
		});

		const running = { until: Date.now() + 30_000, percent: 80 };
		const wrapper = await mounted({}, [runner()], null, running);

		expect(wrapper.find('.drill').text()).toContain('30s left');

		await wrapper.find('.drill-stop button').trigger('click');

		await flushPromises();

		expect(api.delete).toHaveBeenCalledWith('/utils/autoscale/drill');
		expect(wrapper.find('.drill-start').exists()).toBe(true);
	});

	test('a refused drill is reported as the api put it', async () => {
		vi.mocked(api.post).mockRejectedValue({
			response: { data: { errors: [{ message: 'the pool is already working' }] } },
		});

		const wrapper = await mounted({}, [runner()], null, drill);

		await wrapper.find('.drill-start button').trigger('click');

		await flushPromises();

		expect(wrapper.text()).toContain('the pool is already working');
	});
});
