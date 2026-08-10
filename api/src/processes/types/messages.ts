import type {
	ProcessDetail,
	ProcessRuntimeStats,
	ResolvedEnvVariable,
} from '@directus/types';
import type { SupervisedProcess } from '../lib/supervisor-snapshot.js';

/** The bus channel a collector asks every node to describe itself on. */
export const PROCESSES_QUERY_CHANNEL = 'processes:query';

/** The bus channel every node answers a query on. */
export const PROCESSES_REPORT_CHANNEL = 'processes:report';

export interface ProcessesQueryMessage {
	requestId: string;
	details: ProcessDetail[];
}

/** What one process answers with about itself. */
export interface ReportedProcess {
	nodeId: string;
	pid: number;
	pmId: number | null;
	instance: number | null;
	name: string;
	runtime: ProcessRuntimeStats | null;
	env: ResolvedEnvVariable[] | null;
}

export interface ProcessesReportMessage {
	requestId: string;
	service: string;
	replicaId: string;
	hostname: string;
	/** Whether PM2 supervises this process, whatever the list below holds. */
	supervised: boolean;
	self: ReportedProcess;
	/**
	 * The whole container's `pm2 list`, attached by one process per replica so N
	 * workers don't each publish the same list. `null` from every other process,
	 * and from an unsupervised one.
	 */
	supervisor: SupervisedProcess[] | null;
}
