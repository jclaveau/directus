import { ExtensionManager } from "./manager.js";

//#region src/extensions/index.ts
let extensionManager;
function getExtensionManager() {
	if (extensionManager) return extensionManager;
	extensionManager = new ExtensionManager();
	return extensionManager;
}

//#endregion
export { getExtensionManager };