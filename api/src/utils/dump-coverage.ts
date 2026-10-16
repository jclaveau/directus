import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Dump istanbul coverage accumulated by rolldown-plugin-istanbul (COVERAGE_DIR builds) so the
// blackbox suite — which exercises this live server — contributes integration coverage. The
// process is short-lived per blackbox server, so pid+hrtime keeps the many dumps from colliding.
// Coverage-build-only glue (no-op unless COVERAGE_DIR is set) — codecov-ignored.
export async function dumpCoverage(): Promise<void> {
	const coverageDir = process.env['COVERAGE_DIR'];
	const coverage = (globalThis as Record<string, unknown>)['__coverage__'];

	if (coverageDir && coverage) {
		await mkdir(coverageDir, { recursive: true });

		const dumpName = `cov-${process.pid}-${process.hrtime.bigint()}.json`;
		const partialPath = join(coverageDir, `${dumpName}.partial`);

		// Write then rename: a server killed mid-write must not leave a
		// truncated cov-*.json that the merge would then fail to parse.
		await writeFile(partialPath, JSON.stringify(coverage));
		await rename(partialPath, join(coverageDir, dumpName));
	}
}
