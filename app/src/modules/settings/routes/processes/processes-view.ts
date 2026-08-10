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

	return variables.filter((variable) =>
		variable.key.toLowerCase().includes(needle)
		|| (variable.value ?? '').toLowerCase().includes(needle));
}

function everyProcess(report: ProcessesReport): ProcessNode[] {
	return report.services.flatMap((service) =>
		service.replicas.flatMap((replica) => replica.processes));
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
