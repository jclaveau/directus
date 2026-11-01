import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { useLogger } from '../logger/index.js';

/**
 * istanbul's coverage object, keyed by source file. It is cumulative: every
 * dump of one process holds everything the dumps before it held.
 */
export type CoverageMap = Record<string, unknown>;

/**
 * What an extension built by `directus-extension build` with `coverage` in its
 * extension.config.js registers when loaded: the `sourceFiles` its build
 * instrumented, keyed as istanbul keys them, have their coverage written to
 * `coverageDir`. `sourceRoot` is the package, which a rebuild replaces its
 * entry by.
 */
export interface ExtensionCoverageDir {
	sourceRoot: string;
	coverageDir: string;
	sourceFiles: string[];
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
 * far. An extension unloaded since keeps its entry: its files stay in the
 * cumulative coverage too.
 */
export function readExtensionCoverageDirs(): ExtensionCoverageDir[] {
	const extensionCoverageDirs = (globalThis as Record<string, unknown>)[
		'__extensionCoverageDirs'
	] as ExtensionCoverageDir[] | undefined;

	return extensionCoverageDirs ?? [];
}

/**
 * Group the coverage by the directory it is written to: a file goes to the
 * directory of every extension whose build bundled it, any other file to
 * `coreDir`. Without a `coreDir`, those are counted instead, for the caller to
 * report.
 */
export function splitCoverage(
	coverage: CoverageMap,
	extensionCoverageDirs: ExtensionCoverageDir[],
	coreDir: string | undefined,
): { coverageByDir: Map<string, CoverageMap>; unownedCount: number } {
	const coverageDirsByFile = new Map<string, string[]>();

	for (const extensionDir of extensionCoverageDirs) {
		for (const sourceFile of extensionDir.sourceFiles) {
			coverageDirsByFile.set(sourceFile, [
				...(coverageDirsByFile.get(sourceFile) ?? []),
				extensionDir.coverageDir,
			]);
		}
	}

	const coverageByDir = new Map<string, CoverageMap>();
	let unownedCount = 0;

	for (const [sourceFile, fileCoverage] of Object.entries(coverage)) {
		const unresolvedDirs = coverageDirsByFile.get(sourceFile)
			?? (coreDir === undefined
				? []
				: [coreDir]);

		if (unresolvedDirs.length === 0) {
			unownedCount++;
			continue;
		}

		for (const unresolvedDir of unresolvedDirs) {
			// one directory spelled two ways must be one file, not two overwriting
			const targetDir = resolve(unresolvedDir);
			const dirCoverage = coverageByDir.get(targetDir) ?? {};
			dirCoverage[sourceFile] = fileCoverage;
			coverageByDir.set(targetDir, dirCoverage);
		}
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
