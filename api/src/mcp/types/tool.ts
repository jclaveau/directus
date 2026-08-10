import type { Accountability, SchemaOverview } from '@directus/types';

/** What a tool receives: the caller's identity and the schema it reads under. */
export interface McpToolContext {
	accountability: Accountability | null;
	schema: SchemaOverview;
}

/**
 * The subsystem a tool reads, so a deployment can expose one without the other
 * (`DIAGNOSTICS_MCP_TOOLS`).
 */
export type McpToolGroup = 'processes' | 'cache';

/**
 * One diagnostic read, described well enough for a model to choose it and call
 * it without being told what it does — the `inputSchema` is the contract MCP
 * clients validate arguments against.
 */
export interface McpTool {
	name: string;
	group: McpToolGroup;
	title: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
	run: (args: Record<string, unknown>, context: McpToolContext) => Promise<unknown>;
}
