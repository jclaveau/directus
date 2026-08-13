// What the api outside this module reaches for: the router's three, and nothing
// else. The tool list stays inside — every caller of it goes through
// `systemMcpTools`, which is where `SYSTEM_MCP_TOOLS` is enforced.
export {
	handleSystemMcpRequest,
	SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from './lib/handle-request.js';
export { systemMcpEnabled, systemMcpAllowsOrigin } from './lib/config.js';
