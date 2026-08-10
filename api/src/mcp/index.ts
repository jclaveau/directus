export {
	handleMcpRequest,
	MCP_PROTOCOL_VERSION,
	SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from './lib/handle-request.js';
export { diagnosticsMcpEnabled, isAllowedMcpOrigin } from './lib/mcp-config.js';
// `MCP_TOOLS` deliberately stays inside the module: every caller goes through
// `exposedMcpTools`, which is where `DIAGNOSTICS_MCP_TOOLS` is enforced.
export { exposedMcpTools } from './lib/tools.js';
