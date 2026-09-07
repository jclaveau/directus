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

export interface ProcessSample {
	at: number;
	readings: ProcessReading[];
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
 * Append one reading per process, dropping the oldest once the buffer is full.
 * The samples live only as long as the page is open — nothing persists them, so
 * the charts cover the visit rather than pretending to a history they don't have.
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

	return [...samples, { at: report.collectedAt, readings }]
		.slice(-PROCESS_SAMPLE_LIMIT);
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
