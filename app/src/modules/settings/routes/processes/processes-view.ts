import type {
	ProcessNode,
	ProcessesReport,
	ResolvedEnvVariable,
} from '@directus/types';

/**
 * How close a process is to the cap it gets recycled at. `null` when no cap is
 * configured or nothing measured its memory — the two numbers side by side are
 * what turn a mystery restart loop into a one-glance diagnosis.
 */
export function memoryCapRatio(node: ProcessNode): number | null {
	const cap = node.supervisor?.maxMemoryRestartBytes ?? null;
	const used = node.supervisor?.memoryBytes ?? node.runtime?.rssBytes ?? null;

	if (cap === null || cap === 0 || used === null) {
		return null;
	}

	return used / cap;
}

/** Where a process is close enough to its cap to be worth flagging. */
export const MEMORY_CAP_WARNING_RATIO = 0.8;

export function isNearMemoryCap(node: ProcessNode): boolean {
	const ratio = memoryCapRatio(node);

	return ratio !== null && ratio >= MEMORY_CAP_WARNING_RATIO;
}

/** Case-insensitive match over both halves of a variable a user can see. */
export function filterEnvVariables(
	variables: ResolvedEnvVariable[],
	search: string,
): ResolvedEnvVariable[] {
	const needle = search.trim().toLowerCase();

	if (needle === '') {
		return variables;
	}

	return variables.filter((variable) => {
		return variable.key.toLowerCase().includes(needle)
			|| (variable.value ?? '').toLowerCase().includes(needle);
	});
}

function everyProcess(report: ProcessesReport): ProcessNode[] {
	return report.services.flatMap((service) => {
		return service.replicas.flatMap((replica) => replica.processes);
	});
}

/** Totals for the page header: how much of the deployment answered. */
export function processTotals(report: ProcessesReport): {
	processes: number;
	responding: number;
	replicas: number;
} {
	const processes = everyProcess(report);

	return {
		processes: processes.length,
		responding: processes.filter((node) => node.responding).length,
		replicas: report.services.reduce(
			(total, service) => total + service.replicas.length,
			0,
		),
	};
}

/** One process's readings at one moment, under the name the charts plot it by. */
export interface ProcessReading {
	label: string;
	cpuPercent: number | null;
	memoryBytes: number | null;
}

/** A total and the ceiling it is a share of, in the unit the chart plots. */
export interface UsageAgainstCapacity {
	used: number | null;
	capacity: number | null;
}

export interface ProcessSample {
	at: number;
	readings: ProcessReading[];
	/** The whole deployment at that moment: every process, every replica. */
	memory: UsageAgainstCapacity;
	cpu: UsageAgainstCapacity;
}

/** How many readings the charts keep; at 5s that is the last ten minutes. */
export const PROCESS_SAMPLE_LIMIT = 120;

/**
 * What a chart calls a process. Not the pid: PM2 gives a restarted worker a new
 * one, which would break a single worker's line into two. The slot it occupies
 * survives the restart, and the service name keeps two deployments apart.
 */
export function processLabel(service: string, node: ProcessNode): string {
	const slot = node.instance ?? node.pmId ?? node.pid;

	return slot === null
		? service
		: `${service} #${slot}`;
}

/** What the supervisor measured, or nothing — a self-report cannot see its CPU. */
export function cpuPercent(node: ProcessNode): number | null {
	return node.supervisor?.cpuPercent ?? null;
}

/** The supervisor's figure where there is one, else what the process measured. */
export function memoryBytes(node: ProcessNode): number | null {
	return node.supervisor?.memoryBytes ?? node.runtime?.rssBytes ?? null;
}

/**
 * Adds what was measured and leaves the rest out. A total over readings that are
 * partly absent is not the deployment's usage, so `null` in means `null` out
 * rather than a sum that silently counts the missing ones as zero.
 */
function total(values: (number | null)[]): number | null {
	const measured = values.filter((value): value is number => value !== null);

	return measured.length === 0
		? null
		: measured.reduce((sum, value) => sum + value, 0);
}

/** What every replica of the deployment is allowed to use, added up. */
function fleetCapacity(report: ProcessesReport): {
	memoryBytes: number | null;
	cpuCores: number | null;
} {
	const replicas = report.services.flatMap((service) => service.replicas);

	return {
		memoryBytes: total(replicas.map((replica) => {
			return replica.capacity?.memoryBytes ?? null;
		})),
		cpuCores: total(replicas.map((replica) => {
			return replica.capacity?.cpuCores ?? null;
		})),
	};
}

/**
 * Append one reading per process plus the deployment's totals, dropping the
 * oldest once the buffer is full. The samples live only as long as the page is
 * open — nothing persists them, so the charts cover the visit rather than
 * pretending to a history they don't have.
 */
export function appendProcessSample(
	samples: ProcessSample[],
	report: ProcessesReport,
): ProcessSample[] {
	const readings = report.services.flatMap((service) => {
		return service.replicas.flatMap((replica) => {
			return replica.processes.map((node) => {
				return {
					label: processLabel(service.service, node),
					cpuPercent: cpuPercent(node),
					memoryBytes: memoryBytes(node),
				};
			});
		});
	});

	const capacity = fleetCapacity(report);
	const busy = total(readings.map((reading) => reading.cpuPercent));

	return [...samples, {
		at: report.collectedAt,
		readings,
		memory: {
			used: total(readings.map((reading) => reading.memoryBytes)),
			capacity: capacity.memoryBytes,
		},
		// PM2 measures a process against one core, so a sum of its percentages is
		// a count of cores once divided by a hundred — directly comparable to the
		// quota the cgroup grants.
		cpu: {
			used: busy === null
				? null
				: busy / 100,
			capacity: capacity.cpuCores,
		},
	}]
		.slice(-PROCESS_SAMPLE_LIMIT);
}

/** A reading as a percentage of its ceiling, `null` unless both are known. */
export function shareOfCapacity(usage: UsageAgainstCapacity): number | null {
	if (usage.used === null || !usage.capacity) {
		return null;
	}

	return (usage.used / usage.capacity) * 100;
}

/**
 * The deployment against its limits: two lines on one axis, because a percentage
 * of a ceiling is the only thing bytes and cores can be compared in.
 */
export function capacitySeries(samples: ProcessSample[]): {
	name: string;
	data: (number | null)[];
}[] {
	return [
		{
			name: 'Memory',
			data: samples.map((sample) => shareOfCapacity(sample.memory)),
		},
		{
			name: 'CPU',
			data: samples.map((sample) => shareOfCapacity(sample.cpu)),
		},
	];
}

/** The newest sample, for the absolute figures a percentage does not carry. */
export function latestSample(samples: ProcessSample[]): ProcessSample | null {
	return samples.at(-1) ?? null;
}

/**
 * One line per process, over every sample taken. A process absent from a sample
 * plots as a gap rather than as zero: it was not measured then, which is not the
 * same as having been idle.
 */
export function chartSeries(
	samples: ProcessSample[],
	metric: 'cpuPercent' | 'memoryBytes',
): { name: string; data: (number | null)[] }[] {
	const labels = [...new Set(samples.flatMap((sample) => {
		return sample.readings.map((reading) => reading.label);
	}))].sort();

	return labels.map((label) => {
		return {
			name: label,
			data: samples.map((sample) => {
				return sample.readings.find((reading) => reading.label === label)
					?.[metric] ?? null;
			}),
		};
	});
}

/** Whether any sample carries the metric at all, so an empty chart stays hidden. */
export function hasMetric(
	samples: ProcessSample[],
	metric: 'cpuPercent' | 'memoryBytes',
): boolean {
	return samples.some((sample) => {
		return sample.readings.some((reading) => reading[metric] !== null);
	});
}
