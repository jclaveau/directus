import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

//#region src/utils/dump-coverage.ts
async function dumpCoverage() {
	const coverageDir = process.env["COVERAGE_DIR"];
	const coverage = globalThis["__coverage__"];
	if (coverageDir && coverage) {
		await mkdir(coverageDir, { recursive: true });
		const dumpName = `cov-${process.pid}-${process.hrtime.bigint()}.json`;
		const partialPath = join(coverageDir, `${dumpName}.partial`);
		await writeFile(partialPath, JSON.stringify(coverage));
		await rename(partialPath, join(coverageDir, dumpName));
	}
}

//#endregion
export { dumpCoverage };