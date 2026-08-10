import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProcessesReportMessage } from '../types/messages.js';

const bus = vi.hoisted(() => {
	return { publish: vi.fn(), subscribe: vi.fn() };
});

vi.mock('../../bus/index.js', () => {
	return { useBus: () => bus };
});

const logger = vi.hoisted(() => {
	return { warn: vi.fn() };
});

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => logger };
});

const config = vi.hoisted(() => {
	return { enabled: vi.fn(), details: vi.fn() };
});

vi.mock('./processes-config.js', () => {
	return {
		processesReportEnabled: config.enabled,
		processesReplicaId: () => 'replica-a',
		processesServiceName: () => 'api',
		reportedProcessDetails: config.details,
	};
});

const supervisor = vi.hoisted(() => {
	return { available: vi.fn(), read: vi.fn() };
});

vi.mock('./supervisor-snapshot.js', () => {
	return {
		supervisorAvailable: supervisor.available,
		readSupervisedProcesses: supervisor.read,
	};
});

vi.mock('./redact-env.js', () => {
	return {
		resolveReportedEnv: () => {
			return [
				{
					key: 'PORT',
					value: '8055',
					redacted: false,
					isSet: true,
					source: 'process',
				},
			];
		},
	};
});

vi.mock('../../utils/node-id.js', () => {
	return { nodeId: 'node-1' };
});

import { initProcessReports } from './report-processes.js';

const platform = { ...process.env };

/** Boot the responder and hand it a query, the way the bus would. */
async function query(details = ['stats', 'env']) {
	await initProcessReports();

	const handler = bus.subscribe.mock.calls[0]?.[1];

	handler?.({ requestId: 'r1', details });
	await vi.waitFor(() => expect(bus.publish).toHaveBeenCalled());

	return bus.publish.mock.calls[0]![1] as ProcessesReportMessage;
}

beforeEach(() => {
	config.enabled.mockReturnValue(true);
	config.details.mockReturnValue(['stats', 'env']);
	supervisor.available.mockReturnValue(false);
	supervisor.read.mockResolvedValue(null);
	bus.publish.mockReset();
	bus.subscribe.mockReset();
	logger.warn.mockReset();
	delete process.env['NODE_APP_INSTANCE'];
	delete process.env['pm_id'];
	delete process.env['name'];
});

afterEach(() => {
	vi.clearAllMocks();
	process.env = { ...platform };
});

test('A node that is turned off never subscribes', async () => {
	config.enabled.mockReturnValue(false);

	await initProcessReports();

	expect(bus.subscribe).not.toHaveBeenCalled();
});

test('Answers with what this process is and what it measured', async () => {
	const message = await query();

	expect(bus.subscribe)
		.toHaveBeenCalledWith('processes:query', expect.any(Function));

	expect(bus.publish.mock.calls[0]![0]).toBe('processes:report');

	expect(message).toMatchObject({
		requestId: 'r1',
		service: 'api',
		replicaId: 'replica-a',
		supervised: false,
		supervisor: null,
	});

	expect(message.self).toMatchObject({
		nodeId: 'node-1',
		pid: process.pid,
		pmId: null,
		instance: null,
		name: 'directus',
	});

	expect(message.self.runtime?.rssBytes).toBeGreaterThan(0);
	expect(message.self.runtime?.nodeVersion).toBe(process.version);
	expect(message.self.env).toHaveLength(1);
});

test('Carries the identity PM2 gave it', async () => {
	process.env['NODE_APP_INSTANCE'] = '2';
	process.env['pm_id'] = '2';
	process.env['name'] = 'directus-worker';

	const message = await query();

	expect(message.self)
		.toMatchObject({ instance: 2, pmId: 2, name: 'directus-worker' });
});

test('A node narrows the query by what it is willing to report', async () => {
	config.details.mockReturnValue(['stats']);

	const message = await query(['stats', 'env']);

	// Asked for both, configured for one: the env half is absent, not empty.
	expect(message.self.env).toBeNull();
	expect(message.self.runtime).not.toBeNull();
});

test('A node configured for neither half still says where it is', async () => {
	config.details.mockReturnValue([]);

	const message = await query();

	expect(message.self.runtime).toBeNull();
	expect(message.self.env).toBeNull();
	expect(message.self.pid).toBe(process.pid);
});

test('Instance zero is the one that attaches the container-wide list', async () => {
	supervisor.available.mockReturnValue(true);
	supervisor.read.mockResolvedValue([{ pid: 1, pmId: 0, name: 'directus' }]);
	process.env['NODE_APP_INSTANCE'] = '0';

	const message = await query();

	expect(message.supervised).toBe(true);
	expect(message.supervisor).toHaveLength(1);
});

test('Every other instance answers for itself alone', async () => {
	supervisor.available.mockReturnValue(true);
	supervisor.read.mockResolvedValue([{ pid: 1, pmId: 0, name: 'directus' }]);
	process.env['NODE_APP_INSTANCE'] = '1';

	const message = await query();

	expect(message.supervised).toBe(true);
	expect(message.supervisor).toBeNull();
	expect(supervisor.read).not.toHaveBeenCalled();
});

test('The list is not read where stats were not asked for', async () => {
	supervisor.available.mockReturnValue(true);
	process.env['NODE_APP_INSTANCE'] = '0';
	config.details.mockReturnValue(['env']);

	const message = await query();

	expect(message.supervisor).toBeNull();
	expect(supervisor.read).not.toHaveBeenCalled();
});

test('A node that cannot answer says so in the log, not on the bus', async () => {
	bus.publish.mockRejectedValue(new Error('redis is gone'));

	await initProcessReports();
	bus.subscribe.mock.calls[0]![1]({ requestId: 'r1', details: ['stats'] });

	await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());

	expect(logger.warn.mock.calls[0]![1]).toContain('Could not report this process');
});
