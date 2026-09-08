import type { ProcessDetail, ProcessRuntimeStats } from '@directus/types';
import { hostname } from 'node:os';
import { useBus } from '../../bus/index.js';
import { useLogger } from '../../logger/index.js';
import { nodeId } from '../../utils/node-id.js';
import {
	PROCESSES_QUERY_CHANNEL,
	PROCESSES_REPORT_CHANNEL,
	type ProcessesQueryMessage,
	type ProcessesReportMessage,
} from '../types/messages.js';
import {
	processesReplicaId,
	processesReportEnabled,
	processesServiceName,
	reportedProcessDetails,
} from './processes-config.js';
import { resolveReportedEnv } from './redact-env.js';
import { hostCapacity } from './host-capacity.js';
import {
	readSupervisedProcesses,
	supervisorAvailable,
} from './supervisor-snapshot.js';

function instanceNumber(): number | null {
	const parsed = Number(process.env['NODE_APP_INSTANCE']);

	return Number.isInteger(parsed)
		? parsed
		: null;
}

function runtimeStats(): ProcessRuntimeStats {
	const memory = process.memoryUsage();

	return {
		rssBytes: memory.rss,
		heapUsedBytes: memory.heapUsed,
		heapTotalBytes: memory.heapTotal,
		externalBytes: memory.external,
		uptimeMs: Math.round(process.uptime() * 1000),
		nodeVersion: process.version,
		execArgv: process.execArgv,
	};
}

async function reportSelf(query: ProcessesQueryMessage): Promise<void> {
	// A node reports only what it is itself configured to report, however it was
	// asked — the requester's list narrows this one, it never widens it.
	const allowed = reportedProcessDetails();
	const details = query.details.filter((detail) => allowed.includes(detail));
	const carries = (detail: ProcessDetail) => details.includes(detail);

	// The supervisor's list is how a replica is enumerated, not a half of one
	// process: without it a worker crash-looping too fast to answer disappears
	// from the tree, and a healthy PM2 replica reports itself `unavailable`. So it
	// follows what this node is configured to report and not what one request
	// asked for — a caller narrows what is said about each process, it cannot
	// remove the spine they are listed on. The size this parameter exists to save
	// is the env, which is per process and stays narrowable.
	const reportsSupervisor = allowed.includes('stats');

	const message: ProcessesReportMessage = {
		requestId: query.requestId,
		service: processesServiceName(),
		replicaId: processesReplicaId(),
		hostname: hostname(),
		supervised: supervisorAvailable(),
		self: {
			nodeId,
			pid: process.pid,
			pmId: Number.isInteger(Number(process.env['pm_id']))
				? Number(process.env['pm_id'])
				: null,
			instance: instanceNumber(),
			name: process.env['name'] ?? 'directus',
			runtime: carries('stats')
				? runtimeStats()
				: null,
			env: carries('env')
				? resolveReportedEnv()
				: null,
		},
		// Every supervised process attaches the container-wide `pm2 list` and the
		// collector keeps one copy per replica. Electing a single reporter by
		// instance number looked cheaper, but PM2 keeps counting up as the
		// autoscaler releases and adds workers: a pool that has scaled even once
		// can hold instances 2 and 3 and no 0, and the elected reporter then never
		// exists. That lost the CPU readings for good on exactly the services that
		// autoscale — the ones the page is for.
		supervisor: reportsSupervisor
			? await readSupervisedProcesses()
			: null,
		capacity: reportsSupervisor
			? await hostCapacity()
			: null,
	};

	await useBus().publish(PROCESSES_REPORT_CHANNEL, message);
}

/**
 * Answer processes queries for the lifetime of this process. Every node
 * subscribes, so a collector on any one of them reaches all of them — as far as
 * the bus reaches, which without Redis is this process alone.
 */
export async function initProcessReports(): Promise<void> {
	if (processesReportEnabled() === false) {
		return;
	}

	const logger = useLogger();

	const onQuery = (query: ProcessesQueryMessage) => {
		reportSelf(query).catch((error) => {
			logger.warn(error, 'Could not report this process to a processes query');
		});
	};

	await useBus().subscribe(PROCESSES_QUERY_CHANNEL, onQuery);
}
