import type { Accountability, SchemaOverview } from '@directus/types';

/** What a tool receives: the caller's identity and the schema it reads under. */
export interface SystemMcpToolContext {
	accountability: Accountability | null;
	schema: SchemaOverview;
}

/**
 * The subsystem a tool reads, so a deployment can expose one without the other
 * (`SYSTEM_MCP_TOOLS`).
 */
export type SystemMcpToolGroup = 'processes' | 'cache';

/**
 * One diagnostic read, described well enough for a model to choose it and call
 * it without being told what it does — the `inputSchema` is the contract MCP
 * clients validate arguments against.
 */
export interface SystemMcpTool {
	name: string;
	group: SystemMcpToolGroup;
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
	run: (
		args: Record<string, unknown>,
		context: SystemMcpToolContext,
	) => Promise<unknown>;
}

/**
 * A list cannot be structured content, so the runtime names it `items`. The type
 * mirrors that, and exists so the schema below is checked against what a client
 * really receives rather than against what the service returned.
 */
export type SystemMcpStructuredAnswer<T> = T extends readonly unknown[]
	? { items: T }
	: T;

/**
 * An output schema whose properties are exactly the keys of the answer.
 *
 * A mapped type over `keyof` makes a missing key a compile error, and excess
 * property checking on the literal makes an invented one a compile error too —
 * which is the mistake this exists to prevent: two schemas once declared
 * `events` and `disabledReason`, neither of which any service ever returned.
 */
export type SystemMcpOutputSchema<TAnswer> = {
	type: 'object';
	properties: { [K in keyof Required<SystemMcpStructuredAnswer<TAnswer>>]: unknown };
};

/**
 * Declares a tool, tying its `outputSchema` to the return type of its own `run`.
 * The array they live in is homogeneous, so the check has to happen here, at
 * each declaration, while the answer type is still known.
 */
export function defineSystemMcpTool<TAnswer>(tool: {
	name: string;
	group: SystemMcpToolGroup;
	title: string;
	description: string;
	inputSchema: SystemMcpTool['inputSchema'];
	outputSchema: SystemMcpOutputSchema<Awaited<TAnswer>>;
	annotations: SystemMcpTool['annotations'];
	run: (
		args: Record<string, unknown>,
		context: SystemMcpToolContext,
	) => Promise<TAnswer>;
}): SystemMcpTool {
	return tool;
}
