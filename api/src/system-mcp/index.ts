export {
	handleSystemMcpRequest,
	MCP_PROTOCOL_VERSION,
	SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from './lib/handle-request.js';
export { systemMcpEnabled, systemMcpAllowsOrigin } from './lib/config.js';
// The ungated list deliberately stays inside the module: every caller goes
// through `systemMcpTools`, which is where `SYSTEM_MCP_TOOLS` is enforced.
export { systemMcpTools } from './lib/tools.js';
