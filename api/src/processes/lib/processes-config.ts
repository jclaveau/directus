import { useEnv } from '@directus/env';
import type { ProcessDetail } from '@directus/types';
import { hostname } from 'node:os';
import { getMilliseconds } from '../../utils/get-milliseconds.js';

/**
 * Whether this node serves and answers the processes report at all. Off removes
 * the endpoint and unsubscribes the responder, so a deployment that does not want
 * the surface has none of it — the page is admin-only either way.
 */
export function processesReportEnabled(): boolean {
	return useEnv()['PROCESSES_REPORT_ENABLED'] === true;
}

function isProcessDetail(value: unknown): value is ProcessDetail {
	return value === 'stats' || value === 'env';
}

/**
 * The halves of a process this node is willing to report. A responder intersects
 * the requester's list with its own, so a node configured without `env` never
 * reports env however it was asked.
 */
export function reportedProcessDetails(): ProcessDetail[] {
	const configured = useEnv()['PROCESSES_REPORT_DETAILS'];

	if (Array.isArray(configured) === false) {
		return [];
	}

	return configured
		.map((detail) => String(detail).trim())
		.filter(isProcessDetail);
}

/**
 * What one request asked for, narrowed to what this deployment reports at all.
 * Absent means the configured set, so a caller that says nothing still gets what
 * it always got.
 *
 * Narrowing only: a request can ask for less than `PROCESSES_REPORT_DETAILS`,
 * never for more. The env of every process is by far the larger half of the
 * report — a tree of a few processes runs to a hundred kilobytes with it — and
 * it is worth reading only when comparing configuration between replicas.
 */
export function requestedProcessDetails(requested: unknown): ProcessDetail[] {
	const reported = reportedProcessDetails();

	const asked = typeof requested === 'string'
		? requested.split(',')
		: requested;

	if (Array.isArray(asked) === false) {
		return reported;
	}

	const wanted = asked
		.map((detail) => String(detail).trim())
		.filter(isProcessDetail);

	return wanted.length === 0
		? reported
		: reported.filter((detail) => wanted.includes(detail));
}

/**
 * The deployment unit this process reports itself under — the top level of the
 * tree. Falls back to the platform's own service name, then to the PM2 app name
 * (PM2 exports it as `name`), so an unconfigured deployment still groups sanely.
 */
export function processesServiceName(): string {
	const configured = useEnv()['PROCESSES_SERVICE_NAME'];

	if (typeof configured === 'string' && configured.trim() !== '') {
		return configured.trim();
	}

	return process.env['RAILWAY_SERVICE_NAME']
		|| process.env['name']
		|| 'directus';
}

/**
 * The container this process runs in. Every process of one PM2 daemon shares it,
 * which is what makes them one branch of the tree.
 */
export function processesReplicaId(): string {
	return process.env['RAILWAY_REPLICA_ID'] || hostname();
}

/** How long the collector gathers replies before rendering what it has. */
export function processesCollectTimeoutMs(): number {
	return getMilliseconds(useEnv()['PROCESSES_COLLECT_TIMEOUT'], 750);
}
