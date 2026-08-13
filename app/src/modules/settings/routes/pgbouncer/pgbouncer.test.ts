import type { PgBouncerInstance, PgBouncerReport } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return { default: { get: vi.fn() } };
});

const apex = vi.hoisted(() => {
	return { render: vi.fn(), updateOptions: vi.fn(), destroy: vi.fn() };
});

// jsdom has no layout, so the chart is stubbed down to the calls the page makes
// — that it renders once and updates thereafter is the behaviour worth pinning.
vi.mock('apexcharts', () => {
	return {
		default: class {
			render = apex.render;
			updateOptions = apex.updateOptions;
			destroy = apex.destroy;
		},
	};
});

import { createMemoryHistory, createRouter } from 'vue-router';
import api from '@/api';
import VButton from '@/components/v-button.vue';
import VChip from '@/components/v-chip.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import PgBouncerPage from './pgbouncer.vue';

function instance(
	overrides: Partial<PgBouncerInstance> = {},
): PgBouncerInstance {
	return {
		id: 'pgbouncer:6432',
		host: 'pgbouncer',
		port: 6432,
		connections: ['free', 'premium'],
		reachable: true,
		error: null,
		version: 'PgBouncer 1.25.2',
		pools: [
			{
				database: 'directus_free',
				user: 'postgres',
				poolMode: 'transaction',
				clientsActive: 2,
				clientsWaiting: 3,
				serversActive: 1,
				serversIdle: 0,
				serversUsed: 0,
				serversLogin: 0,
				maxWaitMs: 1500,
				poolSize: 1,
				reservePoolSize: null,
				paused: false,
				disabled: false,
				connections: ['free'],
			},
			{
				database: 'directus_premium',
				user: 'postgres',
				poolMode: 'transaction',
				clientsActive: 1,
				clientsWaiting: 0,
				serversActive: 1,
				serversIdle: 3,
				serversUsed: 0,
				serversLogin: 0,
				maxWaitMs: 0,
				poolSize: 4,
				reservePoolSize: null,
				paused: false,
				disabled: false,
				connections: ['premium'],
			},
		],
		clients: [],
		servers: [],
		stats: [{
			database: 'directus_free',
			totalXactCount: 100,
			totalQueryCount: 200,
			totalReceivedBytes: 0,
			totalSentBytes: 0,
			totalWaitTimeUs: 0,
			avgXactCount: 6,
			avgQueryCount: 18,
			avgQueryTimeUs: 0,
			avgWaitTimeUs: 0,
		}],
		limits: [
			{
				key: 'pool_mode',
				value: 'transaction',
				default: 'session',
				isDefault: false,
			},
			{ key: 'max_client_conn', value: '100', default: '100', isDefault: true },
		],
		...overrides,
	};
}

function report(instances: PgBouncerInstance[] = [instance()]): PgBouncerReport {
	return {
		collectedAt: 1_700_000_000_000,
		details: ['pools', 'stats', 'limits'],
		instances,
	};
}

// `v-button` renders through a router link, so the page needs a router to mount.
const router = createRouter({ history: createMemoryHistory(), routes: [] });

const global = {
	plugins: [i18n, router],
	directives: {
		tooltip: {
			mounted: () => undefined,
			updated: () => undefined,
			unmounted: () => undefined,
		},
	},
	components: { VButton, VChip, VIcon },
	config: {
		compilerOptions: {
			isCustomElement: (tag: string) => {
				const real = ['v-button', 'v-chip', 'v-icon'];

				return tag.includes('-') && !real.includes(tag);
			},
		},
	},
};

async function mountLoaded(data: PgBouncerReport = report()) {
	vi.mocked(api.get).mockResolvedValue({ data: { data } } as any);

	const wrapper = mount(PgBouncerPage, { global });
	await flushPromises();

	return wrapper;
}

beforeEach(() => {
	// `v-icon` reads a store, so the page needs a pinia to mount at all.
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	vi.mocked(api.get).mockReset();
	apex.render.mockClear();
	apex.updateOptions.mockClear();
});

describe('the pools', () => {
	test('a row per pool, with its counts and its capacity', async () => {
		const wrapper = await mountLoaded();

		// The connection lists are not asked for until one is opened.
		expect(api.get).toHaveBeenCalledWith('/utils/pgbouncer', {
			params: { details: 'pools,stats,limits' },
		});

		const rows = wrapper.findAll('.pool-row');
		expect(rows).toHaveLength(2);

		expect(rows[0]!.text()).toContain('directus_free');
		expect(rows[0]!.text()).toContain('transaction');
		// One busy server of a size of one, and the queue behind it.
		expect(rows[0]!.text()).toContain('1 / 1');
		expect(rows[0]!.text()).toContain('100%');
		expect(rows[0]!.text()).toContain('3');
		expect(rows[0]!.text()).toContain('18/s');
		// The grant that routes to it, so the tier is named on its own row.
		expect(rows[0]!.text()).toContain('free');
	});

	test('a queueing pool is flagged, a quiet one is not', async () => {
		const wrapper = await mountLoaded();
		const rows = wrapper.findAll('.pool-row');

		expect(rows[0]!.classes()).toContain('danger');
		expect(rows[1]!.classes()).not.toContain('danger');
		expect(rows[1]!.classes()).not.toContain('warning');
	});

	test('a pool with an inherited size claims no percentage', async () => {
		const inherited = report();
		inherited.instances[0]!.pools[1]!.poolSize = null;

		const wrapper = await mountLoaded(inherited);
		const row = wrapper.findAll('.pool-row')[1]!;

		expect(row.text()).toContain('default');
		expect(row.text()).toContain('—');
		expect(row.classes()).not.toContain('warning');
	});

	test('a paused database says so rather than reading as idle', async () => {
		const paused = report();
		paused.instances[0]!.pools[1]!.paused = true;

		const wrapper = await mountLoaded(paused);

		expect(wrapper.findAll('.pool-row')[1]!.classes()).toContain('paused');
	});

	test('a database with no stats row shows no rate', async () => {
		const wrapper = await mountLoaded();

		expect(wrapper.findAll('.pool-row')[1]!.text()).toContain('—');
	});
});

describe('the header', () => {
	test('totals read the whole fleet', async () => {
		const wrapper = await mountLoaded();
		const totals = wrapper.find('.totals').text();

		expect(totals).toContain('3');
		// Both pools' busy servers over both pools' sizes.
		expect(totals).toContain('2 / 5');
		expect(totals).toContain('18/s');
		// The worst wait, kept legible below the seconds a timeout is counted in.
		expect(totals).toContain('1.5s');
	});

	test('the limits strip carries the knobs a queue is argued from', async () => {
		const wrapper = await mountLoaded();
		const limits = wrapper.find('.limits').text();

		expect(limits).toContain('pool_mode');
		expect(limits).toContain('max_client_conn');
	});

	test('an unreachable instance says why, in place of its pools', async () => {
		const wrapper = await mountLoaded(report([instance({
			reachable: false,
			error: 'connect ECONNREFUSED 10.0.0.9:6432',
			pools: [],
			stats: [],
			limits: [],
		})]));

		expect(wrapper.text()).toContain('connect ECONNREFUSED 10.0.0.9:6432');
		expect(wrapper.findAll('.pool-row')).toHaveLength(0);
	});

	test('a deployment with no pooler configured is told so', async () => {
		const wrapper = await mountLoaded(report([]));

		expect(wrapper.text()).toContain('PGBOUNCER_CONNECTIONS');
	});

	test('a failed read surfaces the API error', async () => {
		vi.mocked(api.get).mockRejectedValue({
			response: { data: { errors: [{ message: 'Forbidden' }] } },
		});

		const wrapper = mount(PgBouncerPage, { global });
		await flushPromises();

		expect(wrapper.text()).toContain('Forbidden');
		expect(wrapper.findAll('.pool-row')).toHaveLength(0);
	});
});

describe('the connections of a pool', () => {
	test('opening one asks for the lists, closing it stops', async () => {
		const wrapper = await mountLoaded();

		vi.mocked(api.get).mockClear();
		await wrapper.findAll('.pool-row')[0]!.trigger('click');
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/pgbouncer', {
			params: { details: 'pools,stats,limits,clients,servers' },
		});

		vi.mocked(api.get).mockClear();
		await wrapper.findAll('.pool-row')[0]!.trigger('click');
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/utils/pgbouncer', {
			params: { details: 'pools,stats,limits' },
		});
	});

	test('only the open pool\'s own connections are listed', async () => {
		const withConnections = report();

		withConnections.instances[0]!.clients = [
			{
				database: 'directus_free',
				user: 'postgres',
				state: 'waiting',
				addr: '10.0.0.4',
				port: 5100,
				applicationName: 'directus:abc123:free',
				waitMs: 900,
				connectedAt: '2026-08-13 14:02:11 UTC',
				tls: '',
				linked: false,
			},
			{
				database: 'directus_premium',
				user: 'postgres',
				state: 'active',
				addr: '10.0.0.4',
				port: 5101,
				applicationName: 'directus:abc123:premium',
				waitMs: 0,
				connectedAt: '2026-08-13 14:02:11 UTC',
				tls: '',
				linked: true,
			},
		];

		withConnections.instances[0]!.servers = [{
			database: 'directus_free',
			user: 'postgres',
			state: 'active',
			addr: '10.0.0.3',
			port: 5432,
			connectedAt: '2026-08-13 14:02:10 UTC',
			tls: '',
			remotePid: 4211,
		}];

		const wrapper = await mountLoaded(withConnections);

		await wrapper.findAll('.pool-row')[0]!.trigger('click');
		await flushPromises();

		const opened = wrapper.find('.connections').text();

		// The stamped application name is what makes a client attributable.
		expect(opened).toContain('directus:abc123:free');
		expect(opened).not.toContain('directus:abc123:premium');
		expect(opened).toContain('4211');
	});
});

describe('the chart', () => {
	test('renders once, then updates on the readings that follow', async () => {
		const wrapper = await mountLoaded();

		expect(apex.render).toHaveBeenCalledTimes(1);

		await wrapper.findAll('.pool-row')[0]!.trigger('click');
		await flushPromises();

		expect(apex.render).toHaveBeenCalledTimes(1);
		expect(apex.updateOptions).toHaveBeenCalled();
	});
});
