import type {
	ProcessNode,
	ProcessesReport,
	ResolvedEnvVariable,
} from '@directus/types';
import { describe, expect, test } from 'vitest';
import {
	appendProcessSample,
	chartSeries,
	filterEnvVariables,
	hasMetric,
	isNearMemoryCap,
	memoryCapRatio,
	PROCESS_SAMPLE_LIMIT,
	processLabel,
	processTotals,
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
function reportOf(processes: ProcessNode[], collectedAt = 1): ProcessesReport {
	return {
		collectedAt,
		collectedForMs: 750,
		details: ['stats'],
		degraded: { crossReplica: false, supervisor: false },
		services: [
			{
				service: 'api',
				replicas: [
					{ replicaId: 'a', hostname: 'a', supervisor: 'pm2', processes },
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
