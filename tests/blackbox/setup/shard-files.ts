import fs from 'node:fs';
import { sequentialTestsList } from './sequential-tests';

type Project = 'db' | 'common';

// Rough per-file wall-clock (ms, from an observed postgres run) for the files whose runtime dwarfs
// their byte size; everything else falls back to source size. Only used to BALANCE shards, so exact
// values and cross-vendor drift don't matter — just the relative ordering.
const DURATION_HINTS_MS: Record<string, number> = {
	'/tests/db/routes/items/m2m.test.ts': 360_000,
	'/tests/db/routes/items/no-relation.test.ts': 212_000,
	'/tests/db/routes/items/o2m.test.ts': 190_000,
	'/tests/db/routes/items/m2o.test.ts': 166_000,
	'/tests/db/routes/items/m2a.test.ts': 139_000,
	'/tests/db/websocket/auth.test.ts': 170_000,
	'/tests/db/routes/auth/login.test.ts': 26_000,
};

function fileWeight(file: string): number {
	for (const [suffix, ms] of Object.entries(DURATION_HINTS_MS)) {
		if (file.endsWith(suffix)) {
			return ms;
		}
	}

	try {
		return fs.statSync(file).size;
	}
	catch {
		return 0;
	}
}

/**
 * Pack `files` into `count` balanced buckets (heaviest-first → least-loaded bucket). `lastHandicap`
 * pre-loads the last bucket so it gets less parallel work to offset the after-chain it also runs.
 */
function packIntoBuckets(
	files: string[],
	count: number,
	lastHandicap: number,
): string[][] {
	const weighted = files
		.map((file) => ({ file, weight: fileWeight(file) }))
		.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));

	const buckets = Array.from({ length: count }, (_, i) => {
		const total = i === count - 1
			? lastHandicap
			: 0;

		return { files: [] as string[], total };
	});

	for (const { file, weight } of weighted) {
		const target = buckets.reduce((min, bucket) => {
			if (bucket.total < min.total) {
				return bucket;
			}

			return min;
		});

		target.files.push(file);
		target.total += weight;
	}

	return buckets.map((bucket) => bucket.files);
}

/**
 * Files this shard (1-based `index` of `count`) should run. Every shard runs all `before` files
 * (the ordering barrier needs them); `after` files run only in the last shard; the parallel middle
 * is size-balanced across shards. Deterministic, so the sequencer and the seeder agree.
 */
export function filesForShard(
	files: string[],
	project: Project,
	index: number,
	count: number,
): string[] {
	const list = sequentialTestsList[project];

	const isBefore = (file: string) => list.before.some((entry) => file.endsWith(entry));
	const isAfter = (file: string) => list.after.some((entry) => file.endsWith(entry));

	const before = files.filter(isBefore);
	const after = files.filter(isAfter);
	const parallel = files.filter((file) => !isBefore(file) && !isAfter(file));

	const afterWeight = after.reduce((sum, file) => sum + fileWeight(file), 0);

	const mine = packIntoBuckets(parallel, count, afterWeight)[index - 1] ?? [];

	const tail = index === count
		? after
		: [];

	return [...before, ...mine, ...tail];
}
