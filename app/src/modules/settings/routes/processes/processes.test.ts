import type { AutoscaleNodeState, ProcessesReport } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return { default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const clipboard = vi.hoisted(() => {
	return { copyToClipboard: vi.fn() };
});

const apex = vi.hoisted(() => {
	return { render: vi.fn(), updateOptions: vi.fn(), destroy: vi.fn() };
});

// jsdom has no layout, so the charts are stubbed down to the calls the page makes
// — that each renders once and updates thereafter is the behaviour worth pinning.
vi.mock('apexcharts', () => {
	return {
		default: class {
			render = apex.render;
			updateOptions = apex.updateOptions;
			destroy = apex.destroy;
		},
	};
});

vi.mock('@/composables/use-clipboard', () => {
	return {
		useClipboard: () => {
			return {
				copyToClipboard: clipboard.copyToClipboard,
				isCopySupported: true,
			};
		},
	};
});

import { createMemoryHistory, createRouter } from 'vue-router';
import api from '@/api';
import VButton from '@/components/v-button.vue';
import VChip from '@/components/v-chip.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import VInput from '@/components/v-input.vue';
import VTextOverflow from '@/components/v-text-overflow.vue';
import VTab from '@/components/v-tab.vue';
import VTable from '@/components/v-table/v-table.vue';
import VTabs from '@/components/v-tabs.vue';
import AutoRefresh from '@/views/private/components/refresh-sidebar-detail.vue';
import ProcessesPage from './processes.vue';

const ENV = [
	{ key: 'DB_CLIENT', value: 'pg', redacted: false, isSet: true, source: 'process' },
	{ key: 'SECRET', value: null, redacted: true, isSet: true, source: 'process' },
	{
		key: 'ADMIN_EMAIL',
		value: 'ann@corp.io',
		redacted: false,
		isSet: true,
		source: 'file',
	},
];

function report(overrides: Partial<ProcessesReport> = {}): ProcessesReport {
	return {
		collectedAt: 1_700_000_000_000,
		collectedForMs: 750,
		details: ['stats', 'env'],
		degraded: { crossReplica: false, supervisor: false },
		services: [
			{
				service: 'preview',
				replicas: [
					{
						replicaId: 'runner-1',
						hostname: 'runner-1',
						supervisor: 'pm2',
						capacity: { memoryBytes: 1_000_000_000, cpuCores: 2 },
						processes: [
							{
								nodeId: 'aaa',
								pid: 100,
								pmId: 0,
								name: 'directus',
								instance: 0,
								responding: true,
								runtime: {
									rssBytes: 350_000_000,
									heapUsedBytes: 200_000_000,
									heapTotalBytes: 300_000_000,
									externalBytes: 1_000,
									uptimeMs: 65_000,
									nodeVersion: 'v22.0.0',
								},
								supervisor: {
									status: 'online',
									restarts: 3,
									unstableRestarts: 0,
									uptimeMs: 1_700_000_000_000 - 65_000,
									memoryBytes: 350_000_000,
									cpuPercent: 2,
									maxMemoryRestartBytes: 400_000_000,
									execMode: 'cluster_mode',
									configuredInstances: 2,
								},
								env: ENV,
								autoscale: null,
							},
							{
								nodeId: null,
								pid: 0,
								pmId: 1,
								name: 'directus',
								instance: 1,
								responding: false,
								runtime: null,
								supervisor: {
									status: 'stopped',
									restarts: 0,
									unstableRestarts: 0,
									uptimeMs: null,
									memoryBytes: null,
									cpuPercent: null,
									maxMemoryRestartBytes: null,
									execMode: 'cluster_mode',
									configuredInstances: 2,
								},
								env: null,
								autoscale: null,
							},
						],
					},
				],
			},
		],
		...overrides,
	} as ProcessesReport;
}

// `v-button` renders through a router link, so the page needs a router to mount.
const router = createRouter({ history: createMemoryHistory(), routes: [] });

// The page hangs its own content off three of the layout's slots, and a layout
// left as an unknown element renders none of them.
const PrivateView = {
	props: ['sidebarWidth'],
	template: `<div class="private-view">
		<header><slot name="actions:prepend" /><slot name="actions" /></header>
		<main><slot /></main>
		<aside><slot name="sidebar" /></aside>
	</div>`,
};

const global = {
	plugins: [i18n, router],
	directives: {
		tooltip: {
			mounted: () => undefined,
			updated: () => undefined,
			unmounted: () => undefined,
		},
	},
	components: {
		PrivateView,
		VButton,
		VChip,
		VIcon,
		VInput,
		VTab,
		VTable,
		VTabs,
		VTextOverflow,
	},
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const real = [
					'private-view',
					'v-button',
					'v-chip',
					'v-icon',
					'v-input',
					'v-tab',
					'v-table',
					'v-tabs',
					'v-text-overflow',
				];

				return tag.includes('-') && !real.includes(tag);
			},
		},
	},
};

async function mountLoaded(data: ProcessesReport = report()) {
	// The autoscale panel reads its own route, which a deployment with no Redis
	// does not serve at all.
	vi.mocked(api.get).mockImplementation((url: string) => {
		return url === '/utils/autoscale'
			? Promise.reject({ response: { status: 404 } })
			: Promise.resolve({ data: { data } } as any);
	});

	const wrapper = mount(ProcessesPage, { global });
	await flushPromises();

	return wrapper;
}

beforeEach(() => {
	// `v-icon` reads a store, so the page needs a pinia to mount at all.
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	localStorage.clear();
	clipboard.copyToClipboard.mockClear();
	vi.mocked(api.get).mockReset();
	apex.render.mockClear();
	apex.updateOptions.mockClear();
	apex.destroy.mockClear();
});

describe('the tree', () => {
	test('reads the report and renders a row per process', async () => {
		const wrapper = await mountLoaded();

		expect(api.get).toHaveBeenCalledWith('/utils/processes');
		expect(wrapper.findAll('.process-row')).toHaveLength(2);
		expect(wrapper.text()).toContain('preview');
		expect(wrapper.text()).toContain('runner-1');

		// Totals, and the supervisor's own numbers rather than the self-report's.
		expect(wrapper.find('.totals').text()).toContain('2 processes');
		expect(wrapper.find('.totals').text()).toContain('1 responding');
		expect(wrapper.find('.totals').text()).toContain('1 replicas');

		const first = wrapper.findAll('.process-row')[0]!;

		expect(first.text()).toContain('directus');
		expect(first.text()).toContain('#0');
		expect(first.text()).toContain('online');
		expect(first.text()).toContain('pid 100');
		expect(first.text()).toContain('restarts');
		expect(first.text()).toContain('3');
		expect(first.text()).toContain('cluster_mode');
		// 350MB of a 400MB cap, so the row is flagged and shows both numbers.
		expect(first.text()).toContain('(88%)');
		expect(first.classes()).toContain('warning');
	});

	test('a process the supervisor lists but that never answered', async () => {
		const wrapper = await mountLoaded();
		const silent = wrapper.findAll('.process-row')[1]!;

		expect(silent.classes()).toContain('silent');
		expect(silent.text()).toContain('stopped');
		// No cap and no memory reading of its own: an em dash, not "null".
		expect(silent.text()).toContain('—');
		expect(silent.classes()).not.toContain('warning');
	});

	test('labels a replica by what its supervisor could answer', async () => {
		const unavailable = report();
		unavailable.services[0]!.replicas[0]!.supervisor = 'unavailable';

		expect((await mountLoaded(unavailable)).text())
			.toContain('supervisor unreachable');

		const none = report();
		const replica = none.services[0]!.replicas[0]!;
		replica.supervisor = 'none';

		replica.processes.forEach((process) => {
			process.supervisor = null;
		});

		const wrapper = await mountLoaded(none);

		expect(wrapper.text()).toContain('no supervisor');

		// With no supervisor to quote, answering is all the status can report.
		expect(wrapper.findAll('.process-row')[0]!.text()).toContain('online');
		expect(wrapper.findAll('.process-row')[1]!.text()).toContain('no answer');
	});

	test('says so when the bus could not reach the other replicas', async () => {
		const local = report({ degraded: { crossReplica: true, supervisor: false } });

		expect((await mountLoaded(local)).text()).toContain('No Redis bus configured');
	});

	test('says so when env reporting is off', async () => {
		const wrapper = await mountLoaded(report({ details: ['stats'] }));

		expect(wrapper.text()).toContain('Resolved environment reporting is off');
	});

	test('surfaces the API error rather than an empty page', async () => {
		vi.mocked(api.get).mockRejectedValue({
			response: { data: { errors: [{ message: 'Not an admin' }] } },
		});

		const wrapper = mount(ProcessesPage, { global });
		await flushPromises();

		expect(wrapper.text()).toContain('Not an admin');
		expect(wrapper.findAll('.process-row')).toHaveLength(0);
	});

	test('falls back to the raw error when the API sends no message', async () => {
		vi.mocked(api.get).mockRejectedValue(new Error('network down'));

		const wrapper = mount(ProcessesPage, { global });
		await flushPromises();

		expect(wrapper.text()).toContain('network down');
	});
});

describe('the env panel', () => {
	async function expanded() {
		const wrapper = await mountLoaded();
		await wrapper.findAll('.process-row')[0]!.trigger('click');
		await flushPromises();

		return wrapper;
	}

	test('opens on the row and closes again', async () => {
		const wrapper = await expanded();

		expect(wrapper.find('.detail').exists()).toBe(true);
		expect(wrapper.find('.runtime').text()).toContain('v22.0.0');

		await wrapper.findAll('.process-row')[0]!.trigger('click');
		expect(wrapper.find('.detail').exists()).toBe(false);
	});

	test('lists the variables, and never a redacted value', async () => {
		const wrapper = await expanded();
		const rows = wrapper.findAll('.v-table tbody tr');

		expect(rows).toHaveLength(3);
		expect(rows[0]!.text()).toContain('DB_CLIENT');
		expect(rows[0]!.text()).toContain('pg');
		expect(rows[0]!.text()).toContain('process');

		const secret = rows.find((row) => row.text().includes('SECRET'))!;

		expect(secret.text()).toContain('redacted');
		expect(secret.text()).not.toContain('null');
	});

	test('sorts the rows, both ways, on the column that was clicked', async () => {
		const wrapper = await expanded();

		const keys = () => {
			return wrapper.findAll('.v-table tbody tr td:first-child')
				.map((cell) => cell.text().trim());
		};

		// No sort is the order the API answered in, untouched.
		expect(keys()).toEqual(['DB_CLIENT', 'SECRET', 'ADMIN_EMAIL']);

		const header = wrapper.findAll('.v-table thead th .header-btn')[0]!;

		await header.trigger('click');
		await flushPromises();
		expect(keys()).toEqual(['ADMIN_EMAIL', 'DB_CLIENT', 'SECRET']);

		await header.trigger('click');
		await flushPromises();
		expect(keys()).toEqual(['SECRET', 'DB_CLIENT', 'ADMIN_EMAIL']);
	});

	test('sorts on the value column, with the redacted rows together', async () => {
		const wrapper = await expanded();
		const header = wrapper.findAll('.v-table thead th .header-btn')[1]!;

		await header.trigger('click');
		await flushPromises();

		const keys = wrapper.findAll('.v-table tbody tr td:first-child')
			.map((cell) => cell.text().trim());

		// A redacted value sorts as empty, so SECRET leads rather than landing
		// between the values starting with "a" and "p".
		expect(keys).toEqual(['SECRET', 'ADMIN_EMAIL', 'DB_CLIENT']);
	});

	test('opens a process the supervisor lists but that never answered', async () => {
		const wrapper = await mountLoaded();

		await wrapper.findAll('.process-row')[1]!.trigger('click');
		await flushPromises();

		// It answered nothing, so there is nothing of its own to show — and the
		// panel says why rather than rendering an empty table.
		expect(wrapper.find('.detail').text()).toContain('did not answer');
		expect(wrapper.find('.runtime').exists()).toBe(false);
		expect(wrapper.find('.v-table').exists()).toBe(false);
	});

	test('identifies a process the supervisor never named', async () => {
		const unnamed = report();
		const process = unnamed.services[0]!.replicas[0]!.processes[0]!;
		process.pmId = null;
		process.pid = null;
		process.nodeId = 'only-a-bus-id';

		const wrapper = await mountLoaded(unnamed);

		expect(wrapper.findAll('.process-row')[0]!.text()).toContain('pid —');

		// Keyed off the bus id when the supervisor gave it no numbers, so the row
		// still expands.
		await wrapper.findAll('.process-row')[0]!.trigger('click');
		await flushPromises();

		expect(wrapper.find('.detail').exists()).toBe(true);
		expect(wrapper.find('.runtime').text()).toContain('only-a-bus-id');
	});

	test('filters on the key and on the value', async () => {
		const wrapper = await expanded();
		const search = wrapper.find('.detail input');

		await search.setValue('ann@');
		await flushPromises();

		const keys = wrapper.findAll('.v-table tbody tr td:first-child')
			.map((cell) => cell.text().trim());

		expect(keys).toEqual(['ADMIN_EMAIL']);
	});

	test('copies a variable name and a value from their cells', async () => {
		const wrapper = await expanded();
		const copies = wrapper.findAll('.v-table tbody tr .copy');

		await copies[0]!.trigger('click');

		expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(
			'DB_CLIENT',
			expect.objectContaining({ success: expect.any(String) }),
		);

		await copies[1]!.trigger('click');

		expect(clipboard.copyToClipboard).toHaveBeenLastCalledWith(
			'pg',
			expect.objectContaining({ success: expect.any(String) }),
		);
	});

	test('copies the whole view as .env, redaction included', async () => {
		const wrapper = await expanded();

		await wrapper.findAll('.env-view .v-tab')[1]!.trigger('click');
		await flushPromises();

		await wrapper.find('.copy-all button').trigger('click');

		const [copied] = clipboard.copyToClipboard.mock.calls.at(-1)!;

		expect(copied).toBe([
			'DB_CLIENT=pg',
			'SECRET=<redacted>',
			'ADMIN_EMAIL=ann@corp.io',
		].join('\n'));
	});

	test('copies the whole view as JSON', async () => {
		const wrapper = await expanded();

		await wrapper.findAll('.env-view .v-tab')[2]!.trigger('click');
		await flushPromises();

		await wrapper.find('.copy-all button').trigger('click');

		const [copied] = clipboard.copyToClipboard.mock.calls.at(-1)!;

		expect(JSON.parse(copied as string)).toEqual(ENV);
	});
});

describe('the cpu and memory charts', () => {
	test('shows what the supervisor measured, a dash where it did not', async () => {
		const wrapper = await mountLoaded();
		const rows = wrapper.findAll('.process-row');

		expect(rows[0]?.find('.cpu').text()).toBe('cpu 2%');
		expect(rows[1]?.find('.cpu').text()).toBe('cpu —');
	});

	test('rounds the share of a core PM2 reports', async () => {
		const data = report();
		const process = data.services[0]!.replicas[0]!.processes[0]!;

		process.supervisor!.cpuPercent = 87.6;

		const wrapper = await mountLoaded(data);

		expect(wrapper.findAll('.process-row')[0]?.find('.cpu').text()).toBe('cpu 88%');
	});

	// One reading is a point, not a line, so a first load draws nothing. The page
	// offers no in-body way to refresh, which is why the accumulation itself is
	// pinned on appendProcessSample rather than here.
	test('stays hidden until a second sample gives it something to draw', async () => {
		const wrapper = await mountLoaded();

		expect(wrapper.find('.charts').attributes('style')).toBe('display: none;');
	});

	test('builds all three charts on the first load', async () => {
		await mountLoaded();

		expect(apex.render).toHaveBeenCalledTimes(3);
		expect(apex.updateOptions).not.toHaveBeenCalled();
	});

	// A refresh under the pointer is a reading lost: ApexCharts rebuilds the
	// tooltip on every update, so the chart being read waits for the pointer.
	test('holds the chart the pointer is over until it leaves', async () => {
		const wrapper = await mountLoaded();
		const canvases = wrapper.findAll('.canvas');

		wrapper.findComponent(AutoRefresh).vm.$emit('refresh');
		await flushPromises();

		expect(apex.updateOptions).toHaveBeenCalledTimes(3);

		await canvases[0]!.trigger('pointerenter');
		wrapper.findComponent(AutoRefresh).vm.$emit('refresh');
		await flushPromises();

		// The two nobody is reading redraw on the refresh they always did.
		expect(apex.updateOptions).toHaveBeenCalledTimes(5);

		await canvases[0]!.trigger('pointerleave');
		await flushPromises();

		expect(apex.updateOptions).toHaveBeenCalledTimes(8);

		// Nothing waited this time, so leaving asks for no redraw of its own.
		await canvases[1]!.trigger('pointerenter');
		await canvases[1]!.trigger('pointerleave');
		await flushPromises();

		expect(apex.updateOptions).toHaveBeenCalledTimes(8);
	});

	// ApexCharts attaches outside Vue's tree, so nothing else would clean it up.
	test('destroys every chart when the page goes away', async () => {
		const wrapper = await mountLoaded();

		wrapper.unmount();

		expect(apex.destroy).toHaveBeenCalledTimes(3);
	});

	test('says why the cpu chart is empty when no supervisor answered', async () => {
		const data = report();

		for (const process of data.services[0]!.replicas[0]!.processes) {
			process.supervisor = null;
		}

		const wrapper = await mountLoaded(data);

		expect(wrapper.text()).toContain('CPU is measured by the PM2 daemon');
	});
});

describe('the deployment chart', () => {
	test('shows the totals against what the container may use', async () => {
		const wrapper = await mountLoaded();
		const figures = wrapper.find('.usage-figures').text();

		// 350 MB of the replica's 1 GB, and PM2's 2% of one core out of the two
		expect(figures).toContain('350.0 MB');
		expect(figures).toContain('1.0 GB');
		expect(figures).toContain('35.0%');
		expect(figures).toContain('0.02');
		expect(figures).toContain('2 cores');
		expect(figures).toContain('1.0%');
	});

	// A ceiling nobody reported is not a ceiling of zero: saying so is better
	// than drawing a bar against a number the page invented.
	test('says when no replica reported a ceiling', async () => {
		const data = report();

		data.services[0]!.replicas[0]!.capacity = null;

		const wrapper = await mountLoaded(data);

		expect(wrapper.text())
			.toContain('No replica reported what its container may use');
	});
});

describe('the autoscale panel', () => {
	const state: AutoscaleNodeState = {
		at: 1_700_000_000_000,
		config: {
			enabled: true,
			strategy: 'scalabus',
			appName: 'directus',
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
			appName: 'directus',
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
		workers: 2,
		pendingWorkers: 0,
		warmingWorkers: 0,
		reload: { askedAt: null, running: false, finishedAt: null, error: null },
		supervisor: null,
		cpuPercents: [12, 14],
		lastDecision: {
			at: 1_700_000_000_000,
			workers: null,
			reason: 'average cpu 13% is in the band',
		},
		lastScale: null,
	};

	function scaling(): ProcessesReport {
		const data = report();

		data.services[0]!.replicas[0]!.processes[0]!.autoscale = state;

		return data;
	}

	// The configuration is resolved in the process that scales the pool, so it
	// arrives on that process's own report instead of on a second read.
	test('describes the pool from the report the page already read', async () => {
		const wrapper = await mountLoaded(scaling());

		expect(wrapper.text()).toContain('2 workers');
		expect(wrapper.text()).toContain('average cpu 13% is in the band');
	});

	test('re-reads the report once the panel has changed something', async () => {
		vi.mocked(api.patch).mockResolvedValue({
			data: {
				data: {
					key: 'scalabus:config:pm2',
					override: { enabled: false },
				},
			},
		} as any);

		// The levers are only offered where a change can be stored.
		vi.mocked(api.get).mockImplementation((url: string) => {
			return url === '/utils/autoscale'
				? Promise.resolve({ data: { data: { key: 'k', override: null } } } as any)
				: Promise.resolve({ data: { data: scaling() } } as any);
		});

		const wrapper = mount(ProcessesPage, { global });
		await flushPromises();

		await wrapper.find('.levers .pause button').trigger('click');

		await flushPromises();

		expect(api.patch).toHaveBeenCalledWith('/utils/autoscale', { enabled: false });

		const reads = vi.mocked(api.get).mock.calls
			.filter(([url]) => url === '/utils/processes');

		expect(reads).toHaveLength(2);
	});

	// The drawer holding the panel covers the page when it is open and hides it
	// when it is closed, so the levers are given a home the drawer never touches.
	test('the drawer keeps the tables and nothing else', async () => {
		vi.mocked(api.get).mockImplementation((url: string) => {
			return url === '/utils/autoscale'
				? Promise.resolve({ data: { data: { key: 'k', override: null } } } as any)
				: Promise.resolve({ data: { data: scaling() } } as any);
		});

		const wrapper = mount(ProcessesPage, { global });
		await flushPromises();

		expect(wrapper.find('header .autoscale-actions .levers').exists()).toBe(true);
		expect(wrapper.find('main .levers').exists()).toBe(false);
		expect(wrapper.find('main .autoscale-summary .summary').exists()).toBe(true);
		expect(wrapper.find('aside table.fields').exists()).toBe(true);
	});

	// The variable names the config table reads wrap at the drawer's own width.
	test('asks the layout for a drawer the tables fit in', async () => {
		const wrapper = await mountLoaded(scaling());

		expect(wrapper.findComponent(PrivateView).props('sidebarWidth')).toBe(720);
	});
});
