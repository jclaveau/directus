import fs from 'node:fs';
import { flatAfterList, sequentialTestsList } from './sequential-tests';

// The `maxWorkers` of the vitest config: how many middle files a shard runs at
// once.
export const MAX_WORKERS = 6;

type Project = 'db' | 'common';

// Measured per-file wall clock (ms; the `after` chain re-measured over the
// postgres run of 2026-10-01) for every file that takes more than a few
// seconds; the rest fall back to source size, which lands in the same order of
// magnitude for them.
// Only used to BALANCE shards, so drift between runs doesn't matter — just the
// relative ordering.
const DURATION_HINTS_MS: Record<string, number> = {
	'/tests/db/routes/items/no-relation.test.ts': 93_000,
	'/tests/db/routes/items/m2a.test.ts': 83_000,
	'/tests/db/routes/items/m2m.test.ts': 76_000,
	'/tests/db/routes/items/m2o.test.ts': 63_000,
	'/tests/db/routes/items/o2m.test.ts': 57_000,
	'/tests/db/routes/items/redis-outage-survival.test.ts': 98_000,
	'/tests/db/routes/auth/login.test.ts': 25_000,
	'/tests/db/routes/items/cache-takeover-scope.test.ts': 16_000,
	'/tests/db/routes/auth/refresh.test.ts': 14_000,
	'/tests/db/routes/items/cache-update-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-delete-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-read-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-unautopurgeable-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-cancel-write.test.ts': 11_000,
	'/tests/db/routes/items/cache-poisoning-write.test.ts': 11_000,
	'/tests/db/routes/items/cache-primary-key-scope.test.ts': 11_000,
	'/tests/db/routes/items/cache-m2o-parent-key-pin.test.ts': 13_000,
	'/tests/db/routes/items/cache-m2o-parent-pin-staleness.test.ts': 13_000,
	'/tests/db/routes/items/cache-purge-recovery.test.ts': 92_000,
	// One spawned instance; two bursts wait out the anomaly drain.
	'/tests/db/routes/items/cache-read-inflight-purge.test.ts': 30_000,
	// One spawned instance; every case waits out the one-second descriptor
	// drain before it audits.
	'/tests/db/routes/items/cache-audit.test.ts': 62_000,
	// One spawned instance; the run under test blocks the loop 2.4s and the
	// settle loop waits out the descriptor drain.
	'/tests/db/routes/items/cache-audit-under-pressure.test.ts': 20_000,
	// One spawned instance, held overloaded from boot.
	'/tests/db/routes/server/pressure-replay-exempt.test.ts': 12_000,
	// Two spawned instances and five CLI boots of the whole app.
	'/tests/db/app/cache-audit-cli.test.ts': 56_000,
	// Seven CLI boots of the whole app.
	'/tests/db/app/schema-diff-cli.test.ts': 15_000,
	// One spawned instance; one case waits out the descriptor drain.
	'/tests/db/app/cache-audit-mcp.test.ts': 60_000,
	'/tests/db/database/db-connection-priority.test.ts': 8_000,
	// The `after` chain. The auth files spend their time waiting, not querying,
	// so they cost the same on every vendor. `connects` sleeps out the REST
	// auth timeout once per case; `pings` stops at the close of a socket the
	// method refuses, so the three cost about the same. The pings are
	// estimated; to be measured.
	'/tests/db/websocket/auth-public-connects.test.ts': 40_000,
	'/tests/db/websocket/auth-public-pings.test.ts': 12_000,
	'/tests/db/websocket/auth-handshake-connects.test.ts': 40_000,
	'/tests/db/websocket/auth-handshake-pings.test.ts': 12_000,
	'/tests/db/websocket/auth-strict-connects.test.ts': 40_000,
	'/tests/db/websocket/auth-strict-pings.test.ts': 12_000,
	'/tests/db/app/cache.test.ts': 76_000,
	// Six spawned instances plus a PM2 daemon of three, and every read waits
	// out the collection window.
	'/tests/db/app/processes.test.ts': 50_000,
	// Two spawned instances, and one case holds a pool saturated for six seconds.
	'/tests/db/app/pgbouncer.test.ts': 40_000,
	'/tests/db/app/system-mcp.test.ts': 10_000,
	// A pm2 daemon per arm, and each assertion is a pool settling or a window
	// spent proving it did not move. Measured over the postgres runs of
	// 2026-09-08.
	'/tests/db/app/autoscale-ramp.test.ts': 170_000,
	'/tests/db/app/autoscale-config-source.test.ts': 95_000,
	// One ramp, one hold, and a churning pool watched either side of the
	// switch. Estimated from the arms it borrows; to be measured.
	'/tests/db/app/autoscale-legacy.test.ts': 61_000,
	// Two climbs paced at ten seconds a worker, one of them decided with the
	// connection cut, plus a cold-start arm. 27s driven directly on a quiet
	// laptop; the rest is the runner.
	'/tests/db/app/autoscale-redis-outage.test.ts': 85_000,
	// A climb, a whole pool falling idle, and the walk back down, plus a second
	// climb whose release is held by the cooldown the add re-armed, and a third
	// pool released at the worker that is not the one pm2 would have taken.
	'/tests/db/app/autoscale-release.test.ts': 115_000,
	// Four pools, each released by as much as the load that is left allows.
	'/tests/db/app/autoscale-release-proportional.test.ts': 120_000,
	// Two pools held under a fixed window each, plus the grow the second
	// arm waits out.
	'/tests/db/app/autoscale-signal.test.ts': 54_000,
	// One pool, a crash to wait for and a window to hold it over.
	'/tests/db/app/autoscale-churn.test.ts': 36_000,
	// One climb, a daemon taken away, and the climb it makes afterwards.
	'/tests/db/app/autoscale-supervisor-restart.test.ts': 12_000,
	'/tests/db/app/autoscale-supervisor-options.test.ts': 6_000,
	// Spawns two processes and asks one question of them.
	'/tests/db/app/autoscale-processes.test.ts': 10_000,
	'/tests/db/app/autoscale-config-validation.test.ts': 30_000,
	// Three boots that end at the check and one that goes all the way
	// through, each a full module load. Measured over the postgres run of
	// 2026-09-14.
	'/tests/db/app/autoscale-boolean-env.test.ts': 12_000,
	// A boot, a pool losing a worker, and an autoscaler started after it to
	// report on.
	'/tests/db/app/autoscale-pool-health.test.ts': 51_000,
	// Three deployments, each booting a Directus and a pool for it: one waits
	// out the hold it is asserting, and one walks a pool of eight up three
	// seconds a worker.
	'/tests/db/app/autoscale-prewarm-health.test.ts': 115_000,
	// One deployment walked up twice around a supervisor restart and the
	// eighty seconds the lost scale takes to fail.
	'/tests/db/app/autoscale-prewarm-daemon-lost.test.ts': 125_000,
	// Six Directus workers booted one after another under traffic, then
	// released back to one. Measured at 41s over the postgres run of
	// 2026-09-16, with the margin a loaded runner adds to six boots.
	'/tests/db/app/autoscale-prewarm-load.test.ts': 50_000,
	// One CLI command per vendor: a module load, a query, and the few
	// milliseconds the rejection it boots through takes to arrive.
	'/tests/db/app/cli-boot-redis-outage.test.ts': 10_000,
	// A whole Directus booted with no Redis at all and waited on until it
	// answers, then an autoscaler booted and cut off from its database. Both
	// spawns answer in seconds; what the run measures is the boots.
	'/tests/db/app/processes-missing-dependency.test.ts': 10_000,
	'/tests/db/app/autoscale-drill.test.ts': 25_000,
	// Three nodes to boot, then a poll that runs out its whole window for the
	// announcement that must not arrive.
	'/tests/db/app/cache-config-broadcast.test.ts': 21_000,
	// Two nodes to boot, then a few polls for an announcement that lands.
	'/tests/db/app/cache-settings.test.ts': 12_000,
	// Two nodes to boot, and two `directus cache flush` processes.
	'/tests/db/app/cache-settings-switch.test.ts': 15_000,
	// One node to boot and three schema rebuilds watched on the wire.
	'/tests/db/app/deployment-namespace.test.ts': 12_000,
	'/tests/db/app/autoscale-mcp-levers.test.ts': 16_000,
	'/tests/db/routes/items/m2o-max-batch-mutation.test.ts': 37_000,
	'/tests/db/routes/items/batch-insert.test.ts': 2_000,
	'/tests/db/routes/permissions/cache-purge.test.ts': 26_000,
	'/tests/db/routes/collections/schema-cache.test.ts': 23_000,
	'/tests/db/websocket/general.test.ts': 14_000,
	'/tests/db/schema/timezone/timezone-changed-node-tz-america.test.ts': 7_000,
	'/tests/db/schema/timezone/timezone-changed-node-tz-asia.test.ts': 7_000,
	'/tests/db/routes/flows/webhook.test.ts': 6_000,
	// These run in well under a second, which the source-size fallback does not
	// guess anywhere near: it reads them as 4-10 s and moves real work off
	// whichever shard they land on. Measured over the postgres runs of
	// 2026-09-03, worst of each.
	'/tests/db/routes/items/nested-upsert.test.ts': 1_600,
	'/tests/db/routes/items/db-error-translation.test.ts': 600,
	'/tests/db/routes/items/batch-update.test.ts': 500,
	'/tests/db/routes/permissions/policy-user-integrity.test.ts': 400,
	'/tests/db/routes/items/read-hook-null.test.ts': 200,
};

export function fileWeight(file: string): number {
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

type ShardGroup = {
	files: string[];
	// The share of a shard's wall clock the group takes: whole for an `after`
	// chain, which runs alone, a worker's share for a middle file.
	weight: number;
};

/**
 * Pack `groups` into `count` balanced buckets (heaviest-first → least-loaded
 * bucket). A group is a single file, or an ordered chain that has to stay whole.
 * `preloaded` is wall clock a bucket already spends on files packed elsewhere.
 */
function packIntoBuckets(
	groups: ShardGroup[],
	count: number,
	preloaded: number[],
): string[][][] {
	const weighted = groups.slice().sort((a, b) => {
		return b.weight - a.weight || a.files[0]!.localeCompare(b.files[0]!);
	});

	const buckets = Array.from({ length: count }, (_, index) => {
		return { groups: [] as string[][], total: preloaded[index] ?? 0 };
	});

	for (const { files: group, weight } of weighted) {
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
 * Files this shard (1-based `index` of `count`) should run. Every shard runs the
 * `before` files (the ordering barrier needs them), the first alone runs the
 * `firstShardOnly` ones, and each ends with its own share of the `after`
 * chain — that barrier only ever serialises within a shard, so stacking the
 * whole chain onto the last one just made it run 2× longer than the rest.
 * Deterministic, so the sequencer and the seeder agree.
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

	const isFirstShardOnly = (file: string) =>
		list.firstShardOnly.some((entry) => file.endsWith(entry));

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
		.filter((group) => group.length > 0)
		.map((group) => ({ files: group, weight: groupWeight(group) }));

	// Middle files share the shard's workers, while the after chain waits for
	// all of them and then runs one file at a time.
	const parallel = files
		.filter((file) => !isBefore(file) && !isAfter(file))
		.map((file) => ({ files: [file], weight: fileWeight(file) / MAX_WORKERS }));

	const firstShardBefore = files.filter(isFirstShardOnly);

	const packed = packIntoBuckets(
		[...parallel, ...afterGroups],
		count,
		[groupWeight(firstShardBefore)],
	);

	const mineFiles = (packed[index - 1] ?? []).flat();

	// The tail goes back into declaration order, so a chain runs in the order it
	// needs and the barrier indices the sequencer writes line up with it.
	const tail = after.flatMap((entry) => {
		return mineFiles.filter((file) => file.endsWith(entry));
	});

	const before = files.filter((file) => {
		return isBefore(file) && (index === 1 || !isFirstShardOnly(file));
	});

	return [
		...before,
		...mineFiles.filter((file) => !isAfter(file)),
		...tail,
	];
}
