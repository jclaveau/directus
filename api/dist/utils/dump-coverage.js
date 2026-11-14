import { useLogger } from "../logger/index.js";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

//#region src/utils/dump-coverage.ts
/**
* One file per process and directory, overwritten by each dump: a new file per
* dump would make the merge add up every snapshot. The start stamp keeps a pid
* the OS hands to a later server from overwriting this one's file.
*/
const COVERAGE_DUMP_NAME = `cov-${process.pid}-${process.hrtime.bigint()}.json`;
let pendingDump = Promise.resolve();
const sandboxCoverageReaders = /* @__PURE__ */ new Set();
/**
* The coverage of every instrumented module loaded so far, or undefined when
* nothing loaded was instrumented, which is every build but a coverage one.
*/
function readCoverage() {
	return globalThis["__coverage__"];
}
/**
* Whether anything loaded so far is instrumented, in the server or in a
* sandbox.
*/
function isCoverageInstrumented() {
	return readCoverage() !== void 0 || sandboxCoverageReaders.size > 0;
}
/**
* Have every dump read the coverage of a sandboxed extension through
* `readSandboxCoverage`. The returned function reads it one last time, for an
* isolate about to be disposed: an unloaded extension keeps its coverage, as
* one loaded in the server does. Each load keeps its last coverage until the
* process exits, which bounds a coverage run, not a production server. A last
* read that fails does not fail the unload: every later dump names the sandbox.
*/
function trackSandboxCoverage(readSandboxCoverage, extensionName) {
	const sandboxReader = {
		readSource: `the sandbox of "${extensionName}"`,
		readCoverage: readSandboxCoverage
	};
	let isReleased = false;
	sandboxCoverageReaders.add(sandboxReader);
	return async () => {
		if (isReleased) return;
		isReleased = true;
		try {
			const lastCoverage = await readSandboxCoverage();
			sandboxReader.readCoverage = async () => lastCoverage;
		} catch (error) {
			sandboxReader.readSource += " when it was unloaded";
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
function readExtensionCoverageDirs() {
	return globalThis["__extensionCoverageDirs"] ?? [];
}
/**
* Group the coverage by the directory it is written to: a file goes to the
* directory of every extension whose build bundled it, any other file to
* `coreDir`. Without a `coreDir`, those are counted instead, for the caller to
* report.
*/
function splitCoverage(coverage, extensionCoverageDirs, coreDir) {
	const coverageDirsByFile = /* @__PURE__ */ new Map();
	for (const extensionDir of extensionCoverageDirs) for (const sourceFile of extensionDir.sourceFiles) coverageDirsByFile.set(sourceFile, [...coverageDirsByFile.get(sourceFile) ?? [], extensionDir.coverageDir]);
	const coverageByDir = /* @__PURE__ */ new Map();
	let unownedCount = 0;
	for (const [sourceFile, fileCoverage] of Object.entries(coverage)) {
		const unresolvedDirs = coverageDirsByFile.get(sourceFile) ?? (coreDir === void 0 ? [] : [coreDir]);
		if (unresolvedDirs.length === 0) {
			unownedCount++;
			continue;
		}
		for (const unresolvedDir of unresolvedDirs) {
			const targetDir = resolve(unresolvedDir);
			const dirCoverage = coverageByDir.get(targetDir) ?? {};
			dirCoverage[sourceFile] = fileCoverage;
			coverageByDir.set(targetDir, dirCoverage);
		}
	}
	return {
		coverageByDir,
		unownedCount
	};
}
/**
* Write the coverage collected so far: each extension built with coverage gets
* its own files, `COVERAGE_DIR` gets the rest. Dumps run one
* after the other, since two of them would write the same files.
*/
function dumpCoverage() {
	const dump = pendingDump.then(writeCoverage, writeCoverage);
	pendingDump = dump.catch(() => void 0);
	return dump;
}
/**
* The server's coverage and every sandbox's, in one map. A file two sandboxes
* recorded, the same extension loaded again, has its hits added up while its
* code is unchanged; changed code starts over, as istanbul does in the server.
*/
async function collectCoverage() {
	const serverCoverage = readCoverage();
	const sandboxCoverages = [];
	const failedReads = [];
	for (const sandboxReader of sandboxCoverageReaders) try {
		sandboxCoverages.push(await sandboxReader.readCoverage());
	} catch (error) {
		const { message } = error;
		failedReads.push(`Coverage not read from ${sandboxReader.readSource}: ${message}`);
	}
	if (serverCoverage === void 0 && sandboxCoverageReaders.size === 0) return;
	const coverage = { ...serverCoverage };
	const coverageDirs = [...readExtensionCoverageDirs()];
	for (const sandboxCoverage of sandboxCoverages) {
		coverageDirs.push(...sandboxCoverage.coverageDirs);
		for (const [sourceFile, fileCoverage] of Object.entries(sandboxCoverage.coverage)) coverage[sourceFile] = sourceFile in coverage ? addFileCoverage(coverage[sourceFile], fileCoverage) : fileCoverage;
	}
	return {
		coverage,
		coverageDirs,
		failedReads
	};
}
function addFileCoverage(earlierCoverage, laterCoverage) {
	if (earlierCoverage.hash === void 0 || earlierCoverage.hash !== laterCoverage.hash) return laterCoverage;
	const addHits = (earlierHits, laterHits) => {
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
		}))
	};
}
async function writeCoverage() {
	const collectedCoverage = await collectCoverage();
	if (collectedCoverage === void 0) return [];
	const { coverageByDir, unownedCount } = splitCoverage(collectedCoverage.coverage, collectedCoverage.coverageDirs, process.env["COVERAGE_DIR"] || void 0);
	if (unownedCount > 0) useLogger().warn(`Coverage of ${unownedCount} source files not written: no extension built with coverage owns them, and COVERAGE_DIR is unset.`);
	const writtenCoverage = [];
	const failedWrites = [];
	for (const [targetDir, dirCoverage] of coverageByDir) {
		try {
			await writeDirCoverage(targetDir, dirCoverage);
		} catch (error) {
			failedWrites.push(`${targetDir}: ${error.message}`);
			continue;
		}
		writtenCoverage.push({
			dir: targetDir,
			fileCount: Object.keys(dirCoverage).length
		});
	}
	const failures = [...collectedCoverage.failedReads, ...failedWrites.length > 0 ? [`Coverage not written to ${failedWrites.join("; ")}`] : []];
	if (failures.length > 0) throw new Error(failures.join("; "));
	return writtenCoverage;
}
async function writeDirCoverage(targetDir, dirCoverage) {
	await mkdir(targetDir, { recursive: true });
	const partialPath = join(targetDir, `${COVERAGE_DUMP_NAME}.partial`);
	await writeFile(partialPath, JSON.stringify(dirCoverage));
	await rename(partialPath, join(targetDir, COVERAGE_DUMP_NAME));
}

//#endregion
export { COVERAGE_DUMP_NAME, dumpCoverage, isCoverageInstrumented, readCoverage, readExtensionCoverageDirs, splitCoverage, trackSandboxCoverage };