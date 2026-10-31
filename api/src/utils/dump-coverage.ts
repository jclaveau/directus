import { useEnv } from '@directus/env';
import type { Extension } from '@directus/types';
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { getExtensionManager } from '../extensions/index.js';
import { useLogger } from '../logger/index.js';
import { getMilliseconds } from './get-milliseconds.js';

/**
 * istanbul's coverage object, keyed by source file. It is cumulative: every
 * dump of one process holds everything the dumps before it held.
 */
export type CoverageMap = Record<string, unknown>;

export interface CoveredExtension {
	realPath: string;
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
 * The extensions whose manifest declares a coverage directory, deepest package
 * first so a package nested in another one owns its own files. Paths are real
 * paths: a workspace dependency is loaded through a `node_modules` symlink while
 * istanbul keys its files by where they really are. An extension removed since
 * the last reload is skipped: its files go where unowned files go. An
 * extension with no `coverage` takes no part, so a package nested in a covered
 * one without declaring its own has its files written to the covered one's.
 */
export async function listCoveredExtensions(
	extensions: Extension[],
): Promise<CoveredExtension[]> {
	const coveredExtensions = await Promise.all(
		extensions
			.filter((extension) => extension.coverage !== undefined)
			.map(async (extension) => {
				let realPath: string;

				try {
					realPath = await realpath(extension.path);
				}
				catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						throw error;
					}

					useLogger().warn(
						`Coverage of extension "${extension.name}" not written to its `
							+ `own directory: ${extension.path} no longer exists.`,
					);

					return [];
				}

				return [{
					realPath,
					coverageDir: resolve(realPath, extension.coverage!),
				}];
			}),
	);

	return coveredExtensions.flat().sort(
		(left, right) => right.realPath.length - left.realPath.length,
	);
}

/**
 * Group the coverage by the directory it is written to: an extension's own
 * files go to its directory, every other file to `coreDir`. Without a
 * `coreDir`, those are counted instead, for the caller to report.
 */
export function splitCoverage(
	coverage: CoverageMap,
	coveredExtensions: CoveredExtension[],
	coreDir: string | undefined,
): { coverageByDir: Map<string, CoverageMap>; unownedCount: number } {
	const coverageByDir = new Map<string, CoverageMap>();
	let unownedCount = 0;

	for (const [sourceFile, fileCoverage] of Object.entries(coverage)) {
		const targetDir = coveredExtensions.find((extension) => {
			return sourceFile.startsWith(extension.realPath + sep);
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
 * Write the coverage collected so far: each extension declaring a `coverage`
 * directory gets its own files, `COVERAGE_DIR` gets the rest. Dumps run one
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

	const coveredExtensions = await listCoveredExtensions(
		getExtensionManager().extensions,
	);

	const { coverageByDir, unownedCount } = splitCoverage(
		coverage,
		coveredExtensions,
		process.env['COVERAGE_DIR'] || undefined,
	);

	if (unownedCount > 0) {
		useLogger().warn(
			`Coverage of ${unownedCount} source files not written: no extension `
				+ 'declaring a coverage directory owns them, and COVERAGE_DIR is unset.',
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

/**
 * Dump every `COVERAGE_FLUSH_INTERVAL`, so a process that dies without a
 * graceful shutdown loses at most one interval. Off at 0, and in a build with
 * nothing instrumented. The timer never holds the process open.
 */
export function startCoverageFlush(): void {
	const flushInterval = getMilliseconds(
		useEnv()['COVERAGE_FLUSH_INTERVAL'],
		0,
	);

	if (flushInterval === 0 || readCoverage() === undefined) {
		return;
	}

	setInterval(() => {
		dumpCoverage().catch((error) => {
			useLogger().error(error, 'Coverage flush failed');
		});
	}, flushInterval).unref();
}
