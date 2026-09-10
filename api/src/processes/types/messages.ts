import type {
	AutoscaleNodeState,
	ProcessDetail,
	ProcessHostCapacity,
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
	/** What this process is scaling, `null` from every process that scales nothing. */
	autoscale: AutoscaleNodeState | null;
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
	 * The whole container's `pm2 list`. Every supervised process attaches it and
	 * the collector keeps one copy per replica — electing a single reporter meant
	 * losing the list entirely once its instance was recycled. `null` from an
	 * unsupervised process, and where stats were not asked for.
	 */
	supervisor: SupervisedProcess[] | null;
	/** What this process's container may use, for the totals to be shares of. */
	capacity: ProcessHostCapacity | null;
}
