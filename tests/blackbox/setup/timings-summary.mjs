/* eslint-disable no-console */
// Reads the `blackbox-timings-*` artifacts of a run back and prints, per shard,
// when each phase ended, then per file what it cost once the barrier wait is
// taken off, next to what the packer assumed, and the hints to paste into
// `setup/shard-files.ts`.
//
//   gh run download <run-id> -p 'blackbox-timings-*' -D timings-<run-id>
//   pnpm timings timings-<run-id>

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const runDir = process.argv[2];

if (!runDir) {
	console.error('usage: pnpm timings <shardDir holding the downloaded artifacts>');
	process.exit(1);
}

function readJsonLines(filePath) {
	if (!existsSync(filePath)) {
		return [];
	}

	return readFileSync(filePath, 'utf8')
		.split('\n')
		.filter((jsonLine) => jsonLine.trim() !== '')
		.map((jsonLine) => JSON.parse(jsonLine));
}

function formatSeconds(ms) {
	return `${Math.round((ms ?? 0) / 1000)}s`;
}

const shardDirs = readdirSync(runDir, { withFileTypes: true })
	.filter((dirEntry) => dirEntry.isDirectory())
	// An artifact keeps the `timings/` folder the run wrote into.
	.map((dirEntry) => join(runDir, dirEntry.name, 'timings'))
	.filter((shardDir) => existsSync(join(shardDir, 'modules.json')))
	.sort();

const fileCosts = new Map();

console.log('shard                      before  middle  after   files  boots');

for (const shardDir of shardDirs) {
	const shardRun = JSON.parse(readFileSync(join(shardDir, 'modules.json'), 'utf8'));
	const gateWaits = new Map();

	for (const gateEntry of readJsonLines(join(shardDir, 'gate.jsonl'))) {
		gateWaits.set(gateEntry.file, gateEntry.waitedMs);
	}

	const shardBoots = readJsonLines(join(shardDir, 'boots.jsonl'));
	const phaseEnds = { before: 0, middle: 0, after: 0 };

	for (const moduleTiming of shardRun.modules) {
		const { phase, endMs = 0 } = moduleTiming;

		phaseEnds[phase] = Math.max(phaseEnds[phase], endMs);

		const costMs = (moduleTiming.endMs ?? 0) - (moduleTiming.startMs ?? 0)
			- (gateWaits.get(moduleTiming.file) ?? 0);

		const fileBoots = shardBoots.filter((bootEntry) => {
			return bootEntry.file === moduleTiming.file;
		});

		const hookMs = moduleTiming.hooks.reduce((sumMs, hookTiming) => {
			return sumMs + ((hookTiming.endMs ?? hookTiming.startMs) - hookTiming.startMs);
		}, 0);

		const knownCost = fileCosts.get(moduleTiming.file);

		if (!knownCost || knownCost.costMs < costMs) {
			fileCosts.set(moduleTiming.file, {
				costMs,
				hookMs,
				phase: moduleTiming.phase,
				weight: moduleTiming.weight,
				boots: fileBoots.length,
				bootMs: fileBoots.reduce((sumMs, bootEntry) => {
					return sumMs + bootEntry.waitedMs;
				}, 0),
				shard: `${shardRun.vendor}-${shardRun.shardIndex}`,
			});
		}
	}

	console.log([
		`${shardRun.vendor} ${shardRun.shardIndex ?? '-'}/${shardRun.shardCount ?? '-'}`
			.padEnd(27),
		formatSeconds(phaseEnds.before).padEnd(8),
		formatSeconds(Math.max(phaseEnds.middle, phaseEnds.before)).padEnd(8),
		formatSeconds(phaseEnds.after).padEnd(8),
		String(shardRun.modules.length).padEnd(7),
		String(shardBoots.length),
	].join(''));
}

const byCost = [...fileCosts.entries()].sort((a, b) => b[1].costMs - a[1].costMs);

console.log('\ncost    assumed hooks   boots         phase   shard       file');

for (const [filePath, fileCost] of byCost.slice(0, 60)) {
	console.log([
		formatSeconds(fileCost.costMs).padEnd(8),
		formatSeconds(fileCost.weight).padEnd(8),
		formatSeconds(fileCost.hookMs).padEnd(8),
		`${fileCost.boots} in ${formatSeconds(fileCost.bootMs)}`.padEnd(14),
		fileCost.phase.padEnd(8),
		fileCost.shard.padEnd(12),
		filePath,
	].join(''));
}

// Files under a few seconds fall back to their source size well enough.
console.log('\nDURATION_HINTS_MS candidates (worst run of each file over 3s):');

const hintCandidates = byCost.filter(([, fileCost]) => fileCost.costMs > 3000);

for (const [filePath, fileCost] of hintCandidates) {
	const roundedMs = Math.ceil(fileCost.costMs / 1000) * 1000;
	const hintLiteral = roundedMs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_');

	console.log(`\t'${filePath}': ${hintLiteral},`);
}
