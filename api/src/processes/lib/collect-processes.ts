import type {
	ProcessNode,
	ProcessReplica,
	ProcessService,
	ProcessSupervisorState,
	ProcessesReport,
} from '@directus/types';
import { randomUUID } from 'node:crypto';
import { useBus } from '../../bus/index.js';
import { redisConfigAvailable } from '../../redis/index.js';
import {
	PROCESSES_QUERY_CHANNEL,
	PROCESSES_REPORT_CHANNEL,
	type ProcessesQueryMessage,
	type ProcessesReportMessage,
} from '../types/messages.js';
import {
	processesCollectTimeoutMs,
	reportedProcessDetails,
} from './processes-config.js';

function nodeFromReport(report: ProcessesReportMessage): ProcessNode {
	return {
		nodeId: report.self.nodeId,
		pid: report.self.pid,
		pmId: report.self.pmId,
		name: report.self.name,
		instance: report.self.instance,
		responding: true,
		runtime: report.self.runtime,
		supervisor: null,
		env: report.self.env,
	};
}

function orderedByInstance(nodes: ProcessNode[]): ProcessNode[] {
	return nodes.sort((one, other) => {
		const left = one.instance ?? one.pmId ?? one.pid ?? 0;
		const right = other.instance ?? other.pmId ?? other.pid ?? 0;

		return left - right;
	});
}

/**
 * One replica's processes. When the supervisor list arrived it is the spine: a
 * process the daemon knows but that never answered is reported as not responding
 * rather than dropped — a worker crash-looping too fast to answer is precisely
 * what the page is for. Without a list, the self-reports are all there is.
 */
function replicaProcesses(reports: ProcessesReportMessage[]): ProcessNode[] {
	const selfByPid = new Map(reports.map((report) => [report.self.pid, report]));
	const listed = reports.find((report) => report.supervisor !== null)?.supervisor;

	if (!listed) {
		return orderedByInstance(reports.map(nodeFromReport));
	}

	const nodes = listed.map((supervised): ProcessNode => {
		const pid = supervised.pid;

		const report = pid === null
			? undefined
			: selfByPid.get(pid);

		if (pid !== null) {
			selfByPid.delete(pid);
		}

		return {
			nodeId: report?.self.nodeId ?? null,
			pid: supervised.pid,
			pmId: supervised.pmId,
			name: supervised.name,
			instance: supervised.instance,
			responding: report !== undefined,
			runtime: report?.self.runtime ?? null,
			supervisor: supervised.stats,
			env: report?.self.env ?? null,
		};
	});

	// A process that answered but is missing from the list (started outside the
	// daemon, or listed under another name) is still running — show it.
	for (const report of selfByPid.values()) {
		nodes.push(nodeFromReport(report));
	}

	return orderedByInstance(nodes);
}

function supervisorState(reports: ProcessesReportMessage[]): ProcessSupervisorState {
	if (reports.some((report) => report.supervisor !== null)) {
		return 'pm2';
	}

	return reports.some((report) => report.supervised)
		? 'unavailable'
		: 'none';
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();

	for (const item of items) {
		const group = groups.get(key(item));

		if (group) {
			group.push(item);
		}
		else {
			groups.set(key(item), [item]);
		}
	}

	return groups;
}

/** Fold the collected replies into the service → replica → process tree. */
export function buildProcessesTree(
	reports: ProcessesReportMessage[],
): ProcessService[] {
	const services: ProcessService[] = [];

	for (const [service, ofService] of groupBy(reports, (report) => report.service)) {
		const replicas: ProcessReplica[] = [];

		const byReplica = groupBy(ofService, (report) => report.replicaId);

		for (const [replicaId, ofReplica] of byReplica) {
			replicas.push({
				replicaId,
				hostname: ofReplica[0]!.hostname,
				supervisor: supervisorState(ofReplica),
				processes: replicaProcesses(ofReplica),
			});
		}

		replicas.sort((one, other) => one.replicaId.localeCompare(other.replicaId));
		services.push({ service, replicas });
	}

	services.sort((one, other) => one.service.localeCompare(other.service));

	return services;
}

/**
 * Ask every node on the bus to describe itself and fold the answers into a tree.
 *
 * PM2's API only reaches the daemon in its own container, so a single process can
 * only ever enumerate its own replica; the bus is what makes the other replicas
 * answerable at all. Without Redis the bus is local, and the report says so
 * instead of presenting one replica as the whole deployment.
 */
export async function collectProcesses(): Promise<ProcessesReport> {
	const bus = useBus();
	const details = reportedProcessDetails();
	const collectedForMs = processesCollectTimeoutMs();
	const requestId = randomUUID();
	const reports: ProcessesReportMessage[] = [];

	const collect = (report: ProcessesReportMessage) => {
		if (report.requestId === requestId) {
			reports.push(report);
		}
	};

	await bus.subscribe<ProcessesReportMessage>(PROCESSES_REPORT_CHANNEL, collect);

	try {
		const query: ProcessesQueryMessage = { requestId, details };

		await bus.publish(PROCESSES_QUERY_CHANNEL, query);
		await new Promise((resolve) => setTimeout(resolve, collectedForMs));
	}
	finally {
		await bus.unsubscribe(PROCESSES_REPORT_CHANNEL, collect);
	}

	const services = buildProcessesTree(reports);

	return {
		collectedAt: Date.now(),
		collectedForMs,
		details,
		services,
		degraded: {
			crossReplica: redisConfigAvailable() === false,
			supervisor: services.some((service) => {
				return service.replicas.some((replica) => {
					return replica.supervisor !== 'pm2';
				});
			}),
		},
	};
}
