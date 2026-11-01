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

/**
 * What the instrumented code of a sandboxed extension recorded: it runs in its
 * own isolate, whose globalThis is not the server's.
 */
export interface SandboxCoverage {
	coverage: CoverageMap;
	coverageDirs: ExtensionCoverageDir[];
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

/** Reads one sandbox's coverage; `readSource` names it in a failed read. */
interface SandboxCoverageReader {
	readSource: string;
	readCoverage: () => Promise<SandboxCoverage>;
}

const sandboxCoverageReaders = new Set<SandboxCoverageReader>();

/** istanbul's hit counters of one file, the part two runs of it add up. */
interface FileCoverage {
	hash?: string;
	s: Record<string, number>;
	f: Record<string, number>;
	b: Record<string, number[]>;
}

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
 * Whether anything loaded so far is instrumented, in the server or in a
 * sandbox.
 */
export function isCoverageInstrumented(): boolean {
	return readCoverage() !== undefined || sandboxCoverageReaders.size > 0;
}

/**
 * Have every dump read the coverage of a sandboxed extension through
 * `readSandboxCoverage`. The returned function reads it one last time, for an
 * isolate about to be disposed: an unloaded extension keeps its coverage, as
 * one loaded in the server does. Each load keeps its last coverage until the
 * process exits, which bounds a coverage run, not a production server. A last
 * read that fails does not fail the unload: every later dump names the sandbox.
 */
export function trackSandboxCoverage(
	readSandboxCoverage: () => Promise<SandboxCoverage>,
	extensionName: string,
): () => Promise<void> {
	const sandboxReader: SandboxCoverageReader = {
		readSource: `the sandbox of "${extensionName}"`,
		readCoverage: readSandboxCoverage,
	};

	let isReleased = false;

	sandboxCoverageReaders.add(sandboxReader);

	return async () => {
		// a removed extension is unloaded again by every later reload
		if (isReleased) {
			return;
		}

		isReleased = true;

		try {
			const lastCoverage = await readSandboxCoverage();

			sandboxReader.readCoverage = async () => lastCoverage;
		}
		catch (error) {
			sandboxReader.readSource += ' when it was unloaded';

			sandboxReader.readCoverage = async () => {
				throw error;
			};
		}
	};
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

interface CollectedCoverage extends SandboxCoverage {
	failedReads: string[];
}

/**
 * The server's coverage and every sandbox's, in one map. A file two sandboxes
 * recorded, the same extension loaded again, has its hits added up while its
 * code is unchanged; changed code starts over, as istanbul does in the server.
 */
async function collectCoverage(): Promise<CollectedCoverage | undefined> {
	const serverCoverage = readCoverage();
	const sandboxCoverages: SandboxCoverage[] = [];
	const failedReads: string[] = [];

	// one sandbox that cannot be read must not cost the others their coverage
	for (const sandboxReader of sandboxCoverageReaders) {
		try {
			sandboxCoverages.push(await sandboxReader.readCoverage());
		}
		catch (error) {
			const { message } = error as Error;

			failedReads.push(
				`Coverage not read from ${sandboxReader.readSource}: ${message}`,
			);
		}
	}

	if (serverCoverage === undefined && sandboxCoverageReaders.size === 0) {
		return undefined;
	}

	const coverage: CoverageMap = { ...serverCoverage };
	const coverageDirs = [...readExtensionCoverageDirs()];

	for (const sandboxCoverage of sandboxCoverages) {
		coverageDirs.push(...sandboxCoverage.coverageDirs);

		for (const [sourceFile, fileCoverage] of Object.entries(
			sandboxCoverage.coverage,
		)) {
			coverage[sourceFile] = sourceFile in coverage
				? addFileCoverage(
					coverage[sourceFile] as FileCoverage,
					fileCoverage as FileCoverage,
				)
				: fileCoverage;
		}
	}

	return { coverage, coverageDirs, failedReads };
}

function addFileCoverage(
	earlierCoverage: FileCoverage,
	laterCoverage: FileCoverage,
): FileCoverage {
	if (
		earlierCoverage.hash === undefined
		|| earlierCoverage.hash !== laterCoverage.hash
	) {
		return laterCoverage;
	}

	const addHits = (
		earlierHits: Record<string, number>,
		laterHits: Record<string, number>,
	) => {
		return Object.fromEntries(Object.entries(laterHits).map(([id, hitCount]) => {
			return [id, hitCount + (earlierHits[id] ?? 0)];
		}));
	};

	return {
		...laterCoverage,
		s: addHits(earlierCoverage.s, laterCoverage.s),
		f: addHits(earlierCoverage.f, laterCoverage.f),
		b: Object.fromEntries(Object.entries(laterCoverage.b).map(([id, hitCounts]) => {
			return [id, hitCounts.map((hitCount, index) => {
				return hitCount + (earlierCoverage.b[id]?.[index] ?? 0);
			})];
		})),
	};
}

async function writeCoverage(): Promise<WrittenCoverage[]> {
	const collectedCoverage = await collectCoverage();

	if (collectedCoverage === undefined) {
		return [];
	}

	const { coverageByDir, unownedCount } = splitCoverage(
		collectedCoverage.coverage,
		collectedCoverage.coverageDirs,
		process.env['COVERAGE_DIR'] || undefined,
	);

	if (unownedCount > 0) {
		useLogger().warn(
			`Coverage of ${unownedCount} source files not written: no extension `
				+ 'built with coverage owns them, and COVERAGE_DIR is unset.',
		);
	}

	const writtenCoverage: WrittenCoverage[] = [];
	const failedWrites: string[] = [];

	for (const [targetDir, dirCoverage] of coverageByDir) {
		// one directory that cannot be written must not cost the others theirs
		try {
			await writeDirCoverage(targetDir, dirCoverage);
		}
		catch (error) {
			failedWrites.push(`${targetDir}: ${(error as Error).message}`);
			continue;
		}

		writtenCoverage.push({
			dir: targetDir,
			fileCount: Object.keys(dirCoverage).length,
		});
	}

	const failures = [
		...collectedCoverage.failedReads,
		...(failedWrites.length > 0
			? [`Coverage not written to ${failedWrites.join('; ')}`]
			: []),
	];

	if (failures.length > 0) {
		throw new Error(failures.join('; '));
	}

	return writtenCoverage;
}

async function writeDirCoverage(
	targetDir: string,
	dirCoverage: CoverageMap,
): Promise<void> {
	await mkdir(targetDir, { recursive: true });

	const partialPath = join(targetDir, `${COVERAGE_DUMP_NAME}.partial`);

	// Write then rename: a server killed mid-write must not leave a
	// truncated cov-*.json that the merge would then fail to parse.
	await writeFile(partialPath, JSON.stringify(dirCoverage));
	await rename(partialPath, join(targetDir, COVERAGE_DUMP_NAME));
}
