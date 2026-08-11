import type { Accountability, SchemaOverview } from '@directus/types';

/** What a tool receives: the caller's identity and the schema it reads under. */
export interface McpToolContext {
	accountability: Accountability | null;
	schema: SchemaOverview;
}

/**
 * The subsystem a tool reads, so a deployment can expose one without the other
 * (`SYSTEM_MCP_TOOLS`).
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
	/**
	 * The shape of the answer, so a model reads fields rather than re-parsing a
	 * blob. Kept permissive — properties are named, nothing is forbidden — so a
	 * client validating against it does not break when a report gains a field.
	 */
	outputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
	};
	/**
	 * What a client may assume before calling. Every tool here reads and nothing
	 * more, which is what lets a client run one without asking the user first.
	 */
	annotations: {
		readOnlyHint: true;
		destructiveHint: false;
		openWorldHint: false;
	};
	run: (args: Record<string, unknown>, context: McpToolContext) => Promise<unknown>;
}
