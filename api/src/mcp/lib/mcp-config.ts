import { useEnv } from '@directus/env';
import type { McpToolGroup } from '../types/tool.js';

/**
 * Whether this deployment serves the diagnostics MCP endpoint. Off by default:
 * it is a new externally reachable surface, so it is opened deliberately or not
 * at all.
 */
export function diagnosticsMcpEnabled(): boolean {
	return useEnv()['DIAGNOSTICS_MCP_ENABLED'] === true;
}

function isMcpToolGroup(value: unknown): value is McpToolGroup {
	return value === 'processes' || value === 'cache';
}

/**
 * Which subsystems this deployment exposes tools for. A group left out is not
 * listed and cannot be called — an agent given the processes tools has no way to
 * reach the cache ones.
 */
export function exposedMcpToolGroups(): McpToolGroup[] {
	const configured = useEnv()['DIAGNOSTICS_MCP_TOOLS'];

	if (Array.isArray(configured) === false) {
		return [];
	}

	return configured
		.map((group) => String(group).trim())
		.filter(isMcpToolGroup);
}

/**
 * Whether a browser at `origin` may call the endpoint.
 *
 * The transport spec requires the `Origin` header to be validated, because DNS
 * rebinding defeats CORS: the attacker's name resolves to this host, so the
 * browser believes it is same-origin and never sends a preflight. A request
 * carrying no `Origin` is not from a browser — that is the agent case, and it
 * is the one this endpoint exists for.
 *
 * Empty by default, so no browser origin is accepted until one is named. Kept
 * separate from `CORS_ORIGIN` on purpose: opening the Data Studio to an origin
 * should not also hand it the diagnostics.
 */
export function isAllowedMcpOrigin(origin: string | undefined): boolean {
	if (origin === undefined) {
		return true;
	}

	const configured = useEnv()['DIAGNOSTICS_MCP_ALLOWED_ORIGINS'];

	if (Array.isArray(configured) === false) {
		return false;
	}

	return configured
		.map((allowed) => String(allowed).trim())
		.includes(origin);
}
