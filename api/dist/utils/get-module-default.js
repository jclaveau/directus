//#region src/utils/get-module-default.ts
function getModuleDefault(mod) {
	if ("default" in mod) return mod.default;
	return mod;
}

//#endregion
export { getModuleDefault as default };