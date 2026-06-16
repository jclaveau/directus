import { execSync } from "child_process";

//#region src/kill.ts
/**
* Windows doesn't properly cleanup child processes, forcing us to do this manually.
*/
function kill(child) {
	if (!child) return;
	if (process.platform === "win32") try {
		execSync(`taskkill /pid ${child.pid} /T /F`);
	} catch {}
	else child.kill();
}

//#endregion
export { kill };