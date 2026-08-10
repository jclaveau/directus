import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProcessesReportMessage } from '../types/messages.js';

const bus = vi.hoisted(() => {
	return { publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
});

vi.mock('../../bus/index.js', () => {
	return { useBus: () => bus };
});

const redis = vi.hoisted(() => {
	return { available: vi.fn() };
});

vi.mock('../../redis/index.js', () => {
	return { redisConfigAvailable: redis.available };
});

vi.mock('./processes-config.js', () => {
	return {
		processesCollectTimeoutMs: () => 5,
		reportedProcessDetails: () => ['stats', 'env'],
	};
});

import { buildProcessesTree, collectProcesses } from './collect-processes.js';

function reply(
	overrides: Partial<ProcessesReportMessage> = {},
): ProcessesReportMessage {
	return {
		requestId: 'r1',
		service: 'api',
		replicaId: 'replica-a',
		hostname: 'host-a',
		supervised: false,
		self: {
			nodeId: 'node-1',
			pid: 100,
			pmId: null,
			instance: null,
			name: 'directus',
			runtime: null,
			env: null,
		},
		supervisor: null,
		...overrides,
	};
}

function supervised(pid: number | null, instance: number | null, status = 'online') {
	return {
		pid,
		pmId: instance,
		name: 'directus',
		instance,
		stats: {
			status,
			restarts: 0,
			unstableRestarts: 0,
			uptimeMs: null,
			memoryBytes: null,
			cpuPercent: null,
			maxMemoryRestartBytes: null,
			execMode: 'cluster_mode',
			configuredInstances: 2,
		},
	};
}

beforeEach(() => {
	redis.available.mockReturnValue(true);
	bus.publish.mockReset();
	bus.subscribe.mockReset();
	bus.unsubscribe.mockReset();
});

/**
 * The collector subscribes before it asks, so the replies are delivered from the
 * publish — which is also where the request id it filters on comes from.
 */
function answerWith(build: (requestId: string) => ProcessesReportMessage[]) {
	let deliver: ((message: unknown) => void) | undefined;

	bus.subscribe.mockImplementation(
		async (_channel: string, handler: typeof deliver) => {
			deliver = handler;
		},
	);

	bus.publish.mockImplementation(
		async (_channel: string, query: { requestId: string }) => {
			build(query.requestId).forEach((message) => deliver!(message));
		},
	);
}

afterEach(() => {
	vi.clearAllMocks();
});

test('Groups the replies into services and replicas, both sorted', () => {
	const services = buildProcessesTree([
		reply({ service: 'worker', replicaId: 'w1' }),
		reply({ service: 'api', replicaId: 'replica-b' }),
		reply({ service: 'api', replicaId: 'replica-a' }),
	]);

	expect(services.map((service) => service.service)).toEqual(['api', 'worker']);

	expect(services[0]!.replicas.map((replica) => replica.replicaId))
		.toEqual(['replica-a', 'replica-b']);
});

test('Without a supervisor list the self-reports are all there is', () => {
	const [service] = buildProcessesTree([
		reply({ self: { ...reply().self, pid: 2, instance: 1 } }),
		reply({ self: { ...reply().self, pid: 1, instance: 0 } }),
	]);

	const replica = service!.replicas[0]!;

	expect(replica.supervisor).toBe('none');
	expect(replica.processes.map((process) => process.instance)).toEqual([0, 1]);
	expect(replica.processes.every((process) => process.responding)).toBe(true);

	const unsupervised = replica.processes
		.every((process) => process.supervisor === null);

	expect(unsupervised).toBe(true);
});

test('A supervised replica that answered nothing is unavailable', () => {
	const [service] = buildProcessesTree([reply({ supervised: true })]);

	expect(service!.replicas[0]!.supervisor).toBe('unavailable');
});

test('The supervisor list is the spine, and a silent process stays on it', () => {
	const answered = reply({
		supervised: true,
		self: { ...reply().self, pid: 10, pmId: 0, instance: 0, runtime: null },
		supervisor: [supervised(10, 0), supervised(0, 1, 'stopped')],
	});

	const [service] = buildProcessesTree([answered]);
	const replica = service!.replicas[0]!;

	expect(replica.supervisor).toBe('pm2');
	expect(replica.processes).toHaveLength(2);

	const [online, silent] = replica.processes;

	expect(online).toMatchObject({ pid: 10, responding: true, nodeId: 'node-1' });

	// Listed by the daemon, answered by nobody: reported, not dropped.
	expect(silent).toMatchObject({
		pid: 0,
		responding: false,
		nodeId: null,
		runtime: null,
		env: null,
	});

	expect(silent!.supervisor?.status).toBe('stopped');
});

test('A process that answered but is absent from the list is still shown', () => {
	const lister = reply({
		supervised: true,
		self: { ...reply().self, pid: 10, instance: 0 },
		supervisor: [supervised(10, 0)],
	});

	const stranger = reply({
		supervised: true,
		self: { ...reply().self, nodeId: 'node-2', pid: 99, instance: 1 },
	});

	const [service] = buildProcessesTree([lister, stranger]);
	const pids = service!.replicas[0]!.processes.map((process) => process.pid);

	expect(pids).toEqual([10, 99]);
});

test('A listed row with no pid cannot be matched to a reply', () => {
	const answered = reply({
		supervised: true,
		self: { ...reply().self, pid: 10, instance: 0 },
		supervisor: [supervised(null, 0)],
	});

	const [service] = buildProcessesTree([answered]);
	const processes = service!.replicas[0]!.processes;

	// The listed row, plus the reply it could not be matched to.
	expect(processes).toHaveLength(2);
	expect(processes[0]).toMatchObject({ pid: null, responding: false });
	expect(processes[1]).toMatchObject({ pid: 10, responding: true });
});

test('Asks every node, collects for the window, then stops listening', async () => {
	// Two answers to this query, and one to somebody else's.
	answerWith((requestId) => {
		return [
			reply({ requestId, replicaId: 'replica-a' }),
			reply({ requestId, replicaId: 'replica-b' }),
			reply({ requestId: 'someone-elses', replicaId: 'replica-c' }),
		];
	});

	const report = await collectProcesses();

	expect(bus.subscribe)
		.toHaveBeenCalledWith('processes:report', expect.any(Function));

	expect(bus.publish).toHaveBeenCalledWith('processes:query', {
		requestId: expect.any(String),
		details: ['stats', 'env'],
	});

	expect(bus.unsubscribe)
		.toHaveBeenCalledWith('processes:report', expect.any(Function));

	expect(report.collectedForMs).toBe(5);
	expect(report.details).toEqual(['stats', 'env']);
	expect(report.collectedAt).toBeGreaterThan(0);

	// The reply to another query is not folded into this report.
	const answered = report.services[0]!.replicas
		.map((replica) => replica.replicaId);

	expect(answered).toEqual(['replica-a', 'replica-b']);
});

test('Says so when the bus reaches no replica and none is supervised', async () => {
	redis.available.mockReturnValue(false);

	answerWith((requestId) => {
		return [reply({ requestId })];
	});

	const report = await collectProcesses();

	// Non-vacuous: a replica did answer, it just had no supervisor to quote.
	expect(report.services[0]!.replicas[0]!.processes).toHaveLength(1);
	expect(report.degraded).toEqual({ crossReplica: true, supervisor: true });
});

test('Nothing is degraded when a replica answered with its list', async () => {
	answerWith((requestId) => {
		return [
			reply({
				requestId,
				supervised: true,
				self: { ...reply().self, pid: 10, instance: 0 },
				supervisor: [supervised(10, 0)],
			}),
		];
	});

	const report = await collectProcesses();

	expect(report.services[0]!.replicas[0]!.supervisor).toBe('pm2');
	expect(report.degraded).toEqual({ crossReplica: false, supervisor: false });
});

test('Stops listening even when the ask itself fails', async () => {
	bus.publish.mockRejectedValue(new Error('redis is gone'));

	await expect(collectProcesses()).rejects.toThrow('redis is gone');
	expect(bus.unsubscribe).toHaveBeenCalledOnce();
});
