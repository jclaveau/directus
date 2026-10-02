import { readFile } from "node:fs/promises";
import { availableParallelism, totalmem } from "node:os";

//#region src/processes/lib/host-capacity.ts
/**
* cgroup v1 writes this when memory is uncapped rather than leaving the file
* empty, and it is not a limit anybody has — it is `LONG_MAX` rounded down to a
* page. Anything at or above it means "no cap".
*/
const UNCAPPED_V1_MEMORY = 0x7ffffffffffff000;
async function readLimit(path) {
	return readFile(path, "utf8").then((contents) => contents.trim()).catch(() => null);
}
/**
* The bytes this container may use. `os.totalmem()` is the machine's, which on a
* shared host overstates the ceiling by an order of magnitude, so the cgroup is
* asked first and the machine is only the fallback for an uncapped process.
*/
async function memoryLimit() {
	const version2 = await readLimit("/sys/fs/cgroup/memory.max");
	if (version2 !== null && version2 !== "max") return Number(version2) || null;
	const version1 = await readLimit("/sys/fs/cgroup/memory/memory.limit_in_bytes");
	if (version1 !== null) {
		const bytes = Number(version1);
		if (bytes > 0 && bytes < UNCAPPED_V1_MEMORY) return bytes;
	}
	return totalmem() || null;
}
/**
* The cores this container may use, fractional where the quota is: a `50000
* 100000` quota is half a core however many the machine has. PM2 measures a
* process against one core, so this is what turns a sum of process readings into
* a share of the container.
*/
async function cpuLimit() {
	const version2 = await readLimit("/sys/fs/cgroup/cpu.max");
	if (version2 !== null) {
		const [quota$1, period$1] = version2.split(/\s+/);
		if (quota$1 !== void 0 && quota$1 !== "max" && Number(period$1) > 0) return Number(quota$1) / Number(period$1) || null;
	}
	const quota = Number(await readLimit("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"));
	const period = Number(await readLimit("/sys/fs/cgroup/cpu/cpu.cfs_period_us"));
	if (quota > 0 && period > 0) return quota / period;
	return availableParallelism() || null;
}
let measured = null;
/**
* What this container may use, measured once. A cgroup limit cannot change under
* a running process, so re-reading it on every report would only cost four file
* reads per process per refresh.
*/
async function hostCapacity() {
	measured ??= Promise.all([memoryLimit(), cpuLimit()]).then(([memoryBytes, cpuCores]) => ({
		memoryBytes,
		cpuCores
	}));
	return measured;
}
/** Drops the memo so a test can measure a different container. */
function forgetHostCapacity() {
	measured = null;
}

//#endregion
export { forgetHostCapacity, hostCapacity };