import { InstallationManager } from "./manager.js";

//#region src/extensions/lib/installation/index.ts
let manager;
function getInstallationManager() {
	if (manager) return manager;
	manager = new InstallationManager();
	return manager;
}

//#endregion
export { getInstallationManager };