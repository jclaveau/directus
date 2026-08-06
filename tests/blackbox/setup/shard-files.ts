import fs from 'node:fs';
import { flatAfterList, sequentialTestsList } from './sequential-tests';

type Project = 'db' | 'common';

// Measured per-file wall clock (ms, the worse of the postgres and sqlite runs of
// 2026-08-05) for every file that takes more than a few seconds; the rest fall
// back to source size, which lands in the same order of magnitude for them.
// Only used to BALANCE shards, so drift between runs doesn't matter — just the
// relative ordering.
const DURATION_HINTS_MS: Record<string, number> = {
	'/tests/db/routes/items/no-relation.test.ts': 93_000,
	'/tests/db/routes/items/m2a.test.ts': 83_000,
	'/tests/db/routes/items/m2m.test.ts': 76_000,
	'/tests/db/routes/items/m2o.test.ts': 63_000,
	'/tests/db/routes/items/o2m.test.ts': 57_000,
	'/tests/db/routes/auth/login.test.ts': 25_000,
	'/tests/db/routes/items/cache-takeover-scope.test.ts': 16_000,
	'/tests/db/routes/auth/refresh.test.ts': 14_000,
	'/tests/db/routes/items/cache-update-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-delete-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-read-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-unautopurgeable-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-cancel-write.test.ts': 11_000,
	'/tests/db/routes/items/cache-poisoning-write.test.ts': 11_000,
	'/tests/db/database/db-connection-priority.test.ts': 8_000,
	// The `after` chain. The auth files spend their time waiting, not querying,
	// so they cost the same on every vendor — and the wait is per case, so the
	// three methods are nothing like equal. `connects` sleeps out the REST auth
	// timeout once per case; `pings` waits out `getMessages` on every case the
	// method answers by closing the socket, which is what makes strict the
	// heaviest file in the suite.
	'/tests/db/websocket/auth-public-connects.test.ts': 26_000,
	'/tests/db/websocket/auth-public-pings.test.ts': 12_000,
	'/tests/db/websocket/auth-handshake-connects.test.ts': 26_000,
	'/tests/db/websocket/auth-handshake-pings.test.ts': 92_000,
	'/tests/db/websocket/auth-strict-connects.test.ts': 26_000,
	'/tests/db/websocket/auth-strict-pings.test.ts': 168_000,
	'/tests/db/app/cache.test.ts': 86_000,
	'/tests/db/routes/items/m2o-max-batch-mutation.test.ts': 36_000,
	'/tests/db/routes/permissions/cache-purge.test.ts': 26_000,
	'/tests/db/routes/collections/schema-cache.test.ts': 23_000,
	'/tests/db/websocket/general.test.ts': 14_000,
	'/tests/db/schema/timezone/timezone-changed-node-tz-america.test.ts': 7_000,
	'/tests/db/schema/timezone/timezone-changed-node-tz-asia.test.ts': 7_000,
	'/tests/db/routes/flows/webhook.test.ts': 6_000,
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

function groupWeight(group: string[]): number {
	return group.reduce((sum, file) => sum + fileWeight(file), 0);
}

/**
 * Pack `groups` into `count` balanced buckets (heaviest-first → least-loaded
 * bucket). A group is a single file, or an ordered chain that has to stay whole.
 */
function packIntoBuckets(groups: string[][], count: number): string[][][] {
	const weighted = groups
		.map((group) => ({ group, weight: groupWeight(group) }))
		.sort((a, b) => {
			return b.weight - a.weight || a.group[0]!.localeCompare(b.group[0]!);
		});

	const buckets = Array.from({ length: count }, () => {
		return { groups: [] as string[][], total: 0 };
	});

	for (const { group, weight } of weighted) {
		const target = buckets.reduce((min, bucket) => {
			if (bucket.total < min.total) {
				return bucket;
			}

			return min;
		});

		target.groups.push(group);
		target.total += weight;
	}

	return buckets.map((bucket) => bucket.groups);
}


/**
 * Files this shard (1-based `index` of `count`) should run. Every shard runs all
 * `before` files (the ordering barrier needs them) and ends with its own share
 * of the `after` chain — that barrier only ever serialises within a shard, so
 * stacking the whole chain onto the last one just made it run 2× longer than
 * the rest. Deterministic, so the sequencer and the seeder agree.
 */
export function filesForShard(
	files: string[],
	project: Project,
	index: number,
	count: number,
): string[] {
	const list = sequentialTestsList[project];
	const after = flatAfterList(project);

	const isBefore = (file: string) =>
		list.before.some((entry) => file.endsWith(entry));

	const isAfter = (file: string) => after.some((entry) => file.endsWith(entry));

	const afterGroups = list.after
		.map((entry) => {
			const chain = Array.isArray(entry)
				? entry
				: [entry];

			return chain.flatMap((suffix) => {
				return files.filter((file) => file.endsWith(suffix));
			});
		})
		.filter((group) => group.length > 0);

	const parallel = files
		.filter((file) => !isBefore(file) && !isAfter(file))
		.map((file) => [file]);

	const packed = packIntoBuckets([...parallel, ...afterGroups], count);
	const mineFiles = (packed[index - 1] ?? []).flat();

	// The tail goes back into declaration order, so a chain runs in the order it
	// needs and the barrier indices the sequencer writes line up with it.
	const tail = after.flatMap((entry) => {
		return mineFiles.filter((file) => file.endsWith(entry));
	});

	return [
		...files.filter(isBefore),
		...mineFiles.filter((file) => !isAfter(file)),
		...tail,
	];
}
