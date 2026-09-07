import type {
	ProcessNode,
	ProcessReplica,
	ProcessesReport,
	ResolvedEnvVariable,
} from '@directus/types';
import { describe, expect, test } from 'vitest';
import {
	appendProcessSample,
	capacitySeries,
	chartSeries,
	filterEnvVariables,
	hasMetric,
	isNearMemoryCap,
	memoryCapRatio,
	latestSample,
	PROCESS_SAMPLE_LIMIT,
	processLabel,
	processTotals,
	shareOfCapacity,
	type ProcessSample,
} from './processes-view';

function node(overrides: Partial<ProcessNode> = {}): ProcessNode {
	return {
		nodeId: 'n1',
		pid: 10,
		pmId: 0,
		name: 'directus',
		instance: 0,
		responding: true,
		runtime: null,
		supervisor: null,
		env: null,
		...overrides,
	};
}

function supervisor(overrides: Record<string, unknown> = {}) {
	return {
		status: 'online',
		restarts: 0,
		unstableRestarts: 0,
		uptimeMs: 1,
		memoryBytes: null,
		cpuPercent: null,
		maxMemoryRestartBytes: null,
		execMode: 'cluster_mode',
		configuredInstances: 2,
		...overrides,
	} as ProcessNode['supervisor'];
}

function runtime(rssBytes: number): ProcessNode['runtime'] {
	return {
		rssBytes,
		heapUsedBytes: 1,
		heapTotalBytes: 2,
		externalBytes: 3,
		uptimeMs: 4,
		nodeVersion: 'v22.0.0',
	};
}

describe('memoryCapRatio', () => {
	test('measures the supervisor memory against the recycling cap', () => {
		const process = node({
			supervisor: supervisor({ memoryBytes: 300, maxMemoryRestartBytes: 400 }),
		});

		expect(memoryCapRatio(process)).toBe(0.75);
	});

	test('falls back to what the process measured about itself', () => {
		const process = node({
			runtime: runtime(200),
			supervisor: supervisor({ memoryBytes: null, maxMemoryRestartBytes: 400 }),
		});

		expect(memoryCapRatio(process)).toBe(0.5);
	});

	test('answers null when there is no cap to measure against', () => {
		expect(memoryCapRatio(node({ runtime: runtime(200) }))).toBeNull();

		const zeroCap = node({
			runtime: runtime(200),
			supervisor: supervisor({ maxMemoryRestartBytes: 0 }),
		});

		expect(memoryCapRatio(zeroCap)).toBeNull();
	});

	test('answers null when nothing measured the memory', () => {
		const process = node({
			supervisor: supervisor({ maxMemoryRestartBytes: 400 }),
		});

		expect(memoryCapRatio(process)).toBeNull();
	});
});

describe('isNearMemoryCap', () => {
	test.each([
		[319, false],
		[320, true],
		[400, true],
	])('%i bytes of a 400 byte cap flags %s', (used, expected) => {
		const process = node({
			supervisor: supervisor({ memoryBytes: used, maxMemoryRestartBytes: 400 }),
		});

		expect(isNearMemoryCap(process)).toBe(expected);
	});

	test('does not flag a process with no cap', () => {
		expect(isNearMemoryCap(node({ runtime: runtime(999) }))).toBe(false);
	});
});

describe('filterEnvVariables', () => {
	const variables: ResolvedEnvVariable[] = [
		{
			key: 'DB_CLIENT', value: 'pg', redacted: false, isSet: true, source: 'process',
		},
		{
			key: 'SECRET', value: null, redacted: true, isSet: true, source: 'process',
		},
		{
			key: 'PORT', value: '8055', redacted: false, isSet: true, source: 'default',
		},
	];

	test('returns everything for an empty search', () => {
		expect(filterEnvVariables(variables, '   ')).toBe(variables);
	});

	test('matches the key, case-insensitively', () => {
		expect(filterEnvVariables(variables, 'db_cl').map((one) => one.key))
			.toEqual(['DB_CLIENT']);
	});

	test('matches the value too', () => {
		expect(filterEnvVariables(variables, '8055').map((one) => one.key))
			.toEqual(['PORT']);
	});

	test('a redacted variable matches on its key alone, never on a value', () => {
		expect(filterEnvVariables(variables, 'secret').map((one) => one.key))
			.toEqual(['SECRET']);

		expect(filterEnvVariables(variables, 'null')).toEqual([]);
	});
});

describe('processTotals', () => {
	test('counts every process, the ones answering, and the replicas', () => {
		const report = {
			collectedAt: 1,
			collectedForMs: 750,
			details: ['stats'],
			degraded: { crossReplica: false, supervisor: false },
			services: [
				{
					service: 'api',
					replicas: [
						{
							replicaId: 'a',
							hostname: 'a',
							supervisor: 'pm2',
							processes: [node(), node({ responding: false })],
						},
						{
							replicaId: 'b',
							hostname: 'b',
							supervisor: 'none',
							processes: [node()],
						},
					],
				},
				{
					service: 'worker',
					replicas: [
						{
							replicaId: 'c',
							hostname: 'c',
							supervisor: 'none',
							processes: [node()],
						},
					],
				},
			],
		} as ProcessesReport;

		expect(processTotals(report)).toEqual({
			processes: 4,
			responding: 3,
			replicas: 3,
		});
	});

	test('counts nothing when no node answered', () => {
		const report = {
			collectedAt: 1,
			collectedForMs: 750,
			details: [],
			degraded: { crossReplica: true, supervisor: true },
			services: [],
		} as unknown as ProcessesReport;

		expect(processTotals(report)).toEqual({
			processes: 0,
			responding: 0,
			replicas: 0,
		});
	});
});

/** A report of one service holding the processes given, as the page receives it. */
function reportOf(
	processes: ProcessNode[],
	collectedAt = 1,
	capacity: ProcessReplica['capacity'] = null,
): ProcessesReport {
	return {
		collectedAt,
		collectedForMs: 750,
		details: ['stats'],
		degraded: { crossReplica: false, supervisor: false },
		services: [
			{
				service: 'api',
				replicas: [
					{
						replicaId: 'a',
						hostname: 'a',
						supervisor: 'pm2',
						capacity,
						processes,
					},
				],
			},
		],
	} as ProcessesReport;
}

describe('processLabel', () => {
	test('names a process by the slot it holds, not by its pid', () => {
		expect(processLabel('api', node({ instance: 2, pmId: 3, pid: 99 })))
			.toBe('api #2');
	});

	test('falls back through the pm id to the pid', () => {
		expect(processLabel('api', node({ instance: null, pmId: 4 }))).toBe('api #4');

		expect(processLabel('api', node({ instance: null, pmId: null, pid: 7 })))
			.toBe('api #7');
	});

	test('is the service alone where a process holds no slot at all', () => {
		expect(processLabel('bo', node({ instance: null, pmId: null, pid: null })))
			.toBe('bo');
	});
});

describe('appendProcessSample', () => {
	test('takes a reading per process, stamped with the collection time', () => {
		const samples = appendProcessSample([], reportOf([
			node({
				instance: 0,
				supervisor: supervisor({ cpuPercent: 40, memoryBytes: 10 }),
			}),
			node({
				instance: 1,
				supervisor: supervisor({ cpuPercent: 12, memoryBytes: 20 }),
			}),
		], 1_000));

		expect(samples).toEqual([{
			at: 1_000,
			readings: [
				{ label: 'api #0', cpuPercent: 40, memoryBytes: 10 },
				{ label: 'api #1', cpuPercent: 12, memoryBytes: 20 },
			],
			memory: { used: 30, capacity: null },
			cpu: { used: 0.52, capacity: null },
		}]);
	});

	test('reads memory from the process itself where no supervisor answered', () => {
		const samples = appendProcessSample([], reportOf([
			node({ supervisor: null, runtime: runtime(4_096) }),
		]));

		expect(samples[0]?.readings[0])
			.toEqual({ label: 'api #0', cpuPercent: null, memoryBytes: 4_096 });
	});

	test('drops the oldest reading once the buffer is full', () => {
		let samples: ProcessSample[] = [];

		for (let taken = 0; taken < PROCESS_SAMPLE_LIMIT + 10; taken += 1) {
			samples = appendProcessSample(samples, reportOf([node()], taken));
		}

		expect(samples).toHaveLength(PROCESS_SAMPLE_LIMIT);
		expect(samples[0]?.at).toBe(10);
		expect(samples.at(-1)?.at).toBe(PROCESS_SAMPLE_LIMIT + 9);
	});
});

describe('chartSeries', () => {
	test('gives every process its own line across every sample', () => {
		let samples = appendProcessSample([], reportOf([
			node({ instance: 0, supervisor: supervisor({ cpuPercent: 10 }) }),
			node({ instance: 1, supervisor: supervisor({ cpuPercent: 20 }) }),
		], 1));

		samples = appendProcessSample(samples, reportOf([
			node({ instance: 0, supervisor: supervisor({ cpuPercent: 30 }) }),
			node({ instance: 1, supervisor: supervisor({ cpuPercent: 40 }) }),
		], 2));

		expect(chartSeries(samples, 'cpuPercent')).toEqual([
			{ name: 'api #0', data: [10, 30] },
			{ name: 'api #1', data: [20, 40] },
		]);
	});

	// A released worker plotted as zero reads as an idle process, which is the
	// opposite of what happened: it was gone, and the autoscaler is why.
	test('plots a process missing from a sample as a gap, never as zero', () => {
		let samples = appendProcessSample([], reportOf([
			node({ instance: 0, supervisor: supervisor({ cpuPercent: 10 }) }),
			node({ instance: 1, supervisor: supervisor({ cpuPercent: 20 }) }),
		], 1));

		samples = appendProcessSample(samples, reportOf([
			node({ instance: 0, supervisor: supervisor({ cpuPercent: 30 }) }),
		], 2));

		expect(chartSeries(samples, 'cpuPercent')).toEqual([
			{ name: 'api #0', data: [10, 30] },
			{ name: 'api #1', data: [20, null] },
		]);
	});

	test('keeps a process that only appears later', () => {
		let samples = appendProcessSample([], reportOf([node({ instance: 0 })], 1));

		samples = appendProcessSample(samples, reportOf([
			node({ instance: 0, supervisor: supervisor({ memoryBytes: 5 }) }),
			node({ instance: 1, supervisor: supervisor({ memoryBytes: 6 }) }),
		], 2));

		expect(chartSeries(samples, 'memoryBytes')).toEqual([
			{ name: 'api #0', data: [null, 5] },
			{ name: 'api #1', data: [null, 6] },
		]);
	});
});

describe('hasMetric', () => {
	test('is false where nothing measured the metric', () => {
		const samples = appendProcessSample([], reportOf([
			node({ supervisor: null, runtime: runtime(10) }),
		]));

		expect(hasMetric(samples, 'cpuPercent')).toBe(false);
		expect(hasMetric(samples, 'memoryBytes')).toBe(true);
	});

	test('is true as soon as one process carries it', () => {
		let samples = appendProcessSample([], reportOf([node({ supervisor: null })]));

		samples = appendProcessSample(samples, reportOf([
			node({ supervisor: supervisor({ cpuPercent: 0 }) }),
		], 2));

		expect(hasMetric(samples, 'cpuPercent')).toBe(true);
	});
});

describe('the deployment against its limits', () => {
	const capacity = { memoryBytes: 1_000, cpuCores: 4 };

	test('adds every process up and holds it against the ceiling', () => {
		const samples = appendProcessSample([], reportOf([
			node({
				instance: 0,
				supervisor: supervisor({ cpuPercent: 100, memoryBytes: 200 }),
			}),
			node({
				instance: 1,
				supervisor: supervisor({ cpuPercent: 300, memoryBytes: 300 }),
			}),
		], 1, capacity));

		expect(samples[0]?.memory).toEqual({ used: 500, capacity: 1_000 });
		expect(samples[0]?.cpu).toEqual({ used: 4, capacity: 4 });

		expect(capacitySeries(samples)).toEqual([
			{ name: 'Memory', data: [50] },
			{ name: 'CPU', data: [100] },
		]);
	});

	test('adds the capacity of every replica, not just the first', () => {
		const report = reportOf([node()], 1, capacity);
		const [service] = report.services;

		service!.replicas.push({ ...service!.replicas[0]!, replicaId: 'b' });

		expect(appendProcessSample([], report)[0]?.memory.capacity).toBe(2_000);
	});

	// A ceiling nobody reported is not a ceiling of zero, and dividing by it
	// would draw a full bar over a deployment that is barely working.
	test('plots no share at all where the ceiling is unknown', () => {
		const samples = appendProcessSample([], reportOf([
			node({ supervisor: supervisor({ cpuPercent: 10, memoryBytes: 10 }) }),
		]));

		expect(capacitySeries(samples)).toEqual([
			{ name: 'Memory', data: [null] },
			{ name: 'CPU', data: [null] },
		]);
	});

	test('reads a zero ceiling as no ceiling rather than dividing by it', () => {
		expect(shareOfCapacity({ used: 5, capacity: 0 })).toBeNull();
		expect(shareOfCapacity({ used: null, capacity: 10 })).toBeNull();
	});

	// Counting an unmeasured process as zero would report the deployment using
	// less than it does, which is the wrong way for a limits chart to be wrong.
	test('totals only what was measured', () => {
		const samples = appendProcessSample([], reportOf([
			node({ instance: 0, supervisor: supervisor({ memoryBytes: 400 }) }),
			node({ instance: 1, supervisor: null, runtime: null }),
		], 1, capacity));

		expect(samples[0]?.memory.used).toBe(400);
		expect(samples[0]?.cpu.used).toBeNull();
	});

	test('hands back the newest sample for the figures beside the chart', () => {
		let samples = appendProcessSample([], reportOf([node()], 1, capacity));
		samples = appendProcessSample(samples, reportOf([node()], 2, capacity));

		expect(latestSample(samples)?.at).toBe(2);
		expect(latestSample([])).toBeNull();
	});
});
