//#region src/system-mcp/types/tool.ts
/**
* Declares a tool, tying its `outputSchema` to the return type of its own `run`.
* The array they live in is homogeneous, so the check has to happen here, at
* each declaration, while the answer type is still known.
*/
function defineSystemMcpTool(tool) {
	return tool;
}

//#endregion
export { defineSystemMcpTool };