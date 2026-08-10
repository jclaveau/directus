import { useEnv } from '@directus/env';
import type { Accountability } from '@directus/types';
import { timingSafeEqual } from 'node:crypto';
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

function configuredTokens(): string[] {
	const tokens = useEnv()['DIAGNOSTICS_MCP_TOKENS'];

	return Array.isArray(tokens)
		? tokens.map((token) => String(token)).filter((token) => token !== '')
		: [];
}

function matches(candidate: string, configured: string): boolean {
	const left = Buffer.from(candidate);
	const right = Buffer.from(configured);

	// `timingSafeEqual` throws on a length mismatch, and a length difference is
	// public anyway — compare lengths first, contents in constant time.
	return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The identity an `Authorization: Mcp <token>` header grants, or `null` when the
 * header carries no configured token.
 *
 * A configured token reads every diagnostic tool, which is what an admin can
 * read — the tools are read-only and each still runs through the service guard,
 * so this widens who may read the diagnostics, never what may be read. Treat a
 * token as an admin credential: `DIAGNOSTICS_MCP_TOKENS` is unset by default.
 */
export function mcpTokenAccountability(
	authorization: string | undefined,
	ip: string | null,
): Accountability | null {
	const tokens = configuredTokens();

	if (authorization === undefined || tokens.length === 0) {
		return null;
	}

	const parts = authorization.split(' ');

	if (parts.length !== 2 || parts[0]!.toLowerCase() !== 'mcp') {
		return null;
	}

	const presented = parts[1]!;

	if (tokens.some((token) => matches(presented, token)) === false) {
		return null;
	}

	return { role: null, roles: [], user: null, admin: true, app: false, ip };
}
