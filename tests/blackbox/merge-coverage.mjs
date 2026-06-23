/* eslint-disable no-console */
// Merge the per-server istanbul dumps written by api/src/server.ts on shutdown (one file per
// spawned blackbox server) into a single lcov report for Codecov's `blackbox` flag. The dumps
// are keyed by source path (src/controllers/*.ts, src/auth/drivers/*.ts, …) because the build
// is instrumented with `unbundle: true`, so the lcov maps straight onto the api sources.
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import reports from 'istanbul-reports';

// istanbul-lib-* are CommonJS; named ESM imports fail under Node, so destructure the default.
const { createCoverageMap } = libCoverage;
const { createContext } = libReport;

const dir = process.env['COVERAGE_DIR'];

if (!dir) {
	console.error('COVERAGE_DIR unset — nothing to merge');
	process.exit(0);
}

const map = createCoverageMap({});
let merged = 0;

for (const file of readdirSync(dir)) {
	if (!file.startsWith('cov-') || !file.endsWith('.json')) continue;
	map.merge(JSON.parse(readFileSync(join(dir, file), 'utf8')));
	merged++;
}

console.log(`merged ${merged} dumps → ${map.files().length} files`);

const context = createContext({ dir, coverageMap: map });
reports.create('lcovonly', { file: 'lcov.info' }).execute(context);
console.log(`wrote ${join(dir, 'lcov.info')}`);
