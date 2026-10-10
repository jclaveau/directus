import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

//#region src/utils/dump-coverage.ts
async function dumpCoverage() {
	const coverageDir = process.env["COVERAGE_DIR"];
	const coverage = globalThis["__coverage__"];
	if (coverageDir && coverage) {
		await mkdir(coverageDir, { recursive: true });
		await writeFile(join(coverageDir, `cov-${process.pid}-${process.hrtime.bigint()}.json`), JSON.stringify(coverage));
	}
}

//#endregion
export { dumpCoverage };