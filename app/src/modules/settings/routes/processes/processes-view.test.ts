import type {
	ProcessNode,
	ProcessesReport,
	ResolvedEnvVariable,
} from '@directus/types';
import { describe, expect, test } from 'vitest';
import {
	filterEnvVariables,
	isNearMemoryCap,
	memoryCapRatio,
	processTotals,
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
