import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { useLogger } from '../logger/index.js';

/**
 * istanbul's coverage object, keyed by source file. It is cumulative: every
 * dump of one process holds everything the dumps before it held.
 */
export type CoverageMap = Record<string, unknown>;

/**
 * What an extension built by `directus-extension build` with `coverage` in its
 * extension.config.js registers when loaded: the files under `sourceRoot` have
 * their coverage written to `coverageDir`. Both are absolute, `sourceRoot` a
 * real path, as istanbul keys its files.
 */
export interface ExtensionCoverageDir {
	sourceRoot: string;
	coverageDir: string;
}

export interface WrittenCoverage {
	dir: string;
	fileCount: number;
}

/**
 * One file per process and directory, overwritten by each dump: a new file per
 * dump would make the merge add up every snapshot. The start stamp keeps a pid
 * the OS hands to a later server from overwriting this one's file.
 */
export const COVERAGE_DUMP_NAME
	= `cov-${process.pid}-${process.hrtime.bigint()}.json`;

let pendingDump: Promise<unknown> = Promise.resolve();

/**
 * The coverage of every instrumented module loaded so far, or undefined when
 * nothing loaded was instrumented, which is every build but a coverage one.
 */
export function readCoverage(): CoverageMap | undefined {
	return (globalThis as Record<string, unknown>)['__coverage__'] as
		| CoverageMap
		| undefined;
}

/**
 * The coverage directories registered by the instrumented extensions loaded so
 * far, deepest package first so a package nested in another one owns its own
 * files. An extension unloaded since keeps its entry: its files stay in the
 * cumulative coverage too.
 */
export function readExtensionCoverageDirs(): ExtensionCoverageDir[] {
	const extensionCoverageDirs = (globalThis as Record<string, unknown>)[
		'__extensionCoverageDirs'
	] as ExtensionCoverageDir[] | undefined;

	return [...(extensionCoverageDirs ?? [])].sort(
		(left, right) => right.sourceRoot.length - left.sourceRoot.length,
	);
}

/**
 * Group the coverage by the directory it is written to: an extension's own
 * files go to its directory, every other file to `coreDir`. Without a
 * `coreDir`, those are counted instead, for the caller to report.
 */
export function splitCoverage(
	coverage: CoverageMap,
	extensionCoverageDirs: ExtensionCoverageDir[],
	coreDir: string | undefined,
): { coverageByDir: Map<string, CoverageMap>; unownedCount: number } {
	const coverageByDir = new Map<string, CoverageMap>();
	let unownedCount = 0;

	for (const [sourceFile, fileCoverage] of Object.entries(coverage)) {
		const targetDir = extensionCoverageDirs.find((extensionDir) => {
			return sourceFile.startsWith(extensionDir.sourceRoot + sep);
		})?.coverageDir ?? coreDir;

		if (targetDir === undefined) {
			unownedCount++;
			continue;
		}

		const dirCoverage = coverageByDir.get(targetDir) ?? {};
		dirCoverage[sourceFile] = fileCoverage;
		coverageByDir.set(targetDir, dirCoverage);
	}

	return { coverageByDir, unownedCount };
}

/**
 * Write the coverage collected so far: each extension built with coverage gets
 * its own files, `COVERAGE_DIR` gets the rest. Dumps run one
 * after the other, since two of them would write the same files.
 */
export function dumpCoverage(): Promise<WrittenCoverage[]> {
	const dump = pendingDump.then(writeCoverage, writeCoverage);

	// The chain only orders the dumps; the caller of this one gets its error.
	pendingDump = dump.catch(() => undefined);

	return dump;
}

async function writeCoverage(): Promise<WrittenCoverage[]> {
	const coverage = readCoverage();

	if (coverage === undefined) {
		return [];
	}

	const { coverageByDir, unownedCount } = splitCoverage(
		coverage,
		readExtensionCoverageDirs(),
		process.env['COVERAGE_DIR'] || undefined,
	);

	if (unownedCount > 0) {
		useLogger().warn(
			`Coverage of ${unownedCount} source files not written: no extension `
				+ 'built with coverage owns them, and COVERAGE_DIR is unset.',
		);
	}

	const writtenCoverage: WrittenCoverage[] = [];

	for (const [targetDir, dirCoverage] of coverageByDir) {
		await mkdir(targetDir, { recursive: true });

		const partialPath = join(targetDir, `${COVERAGE_DUMP_NAME}.partial`);

		// Write then rename: a server killed mid-write must not leave a
		// truncated cov-*.json that the merge would then fail to parse.
		await writeFile(partialPath, JSON.stringify(dirCoverage));
		await rename(partialPath, join(targetDir, COVERAGE_DUMP_NAME));

		writtenCoverage.push({
			dir: targetDir,
			fileCount: Object.keys(dirCoverage).length,
		});
	}

	return writtenCoverage;
}
