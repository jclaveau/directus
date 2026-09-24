// Tests will run sequentially according to this list
export const sequentialTestsList: Record<'db' | 'common', SequentialTestsList> = {
	common: {
		before: ['/common/common.test.ts'],
		after: [],
		// If specified, only run these tests sequentially
		only: [
			// '/common/common.test.ts',
		],
	},
	db: {
		before: [
			'/tests/db/seed-database.test.ts',
			'/common/common.test.ts',
			'/tests/db/routes/schema/schema.test.ts',
			'/tests/db/routes/collections/crud.test.ts',
			'/tests/db/routes/fields/change-fields.test.ts',
			'/tests/db/routes/fields/crud.test.ts',
		],
		after: [
			// A chain: america reads back the rows timezone inserted, asia reads back
			// both. They run in one shard, in this order.
			[
				'/tests/db/schema/timezone/timezone.test.ts',
				'/tests/db/schema/timezone/timezone-changed-node-tz-america.test.ts',
				'/tests/db/schema/timezone/timezone-changed-node-tz-asia.test.ts',
			],
			// The suites below spawn their own Directus and came here one at a
			// time, each after a race it lost in the parallel middle:
			// `cache-takeover-scope` applied a unique constraint before its own
			// junction columns existed (postgres 42703) while two siblings were
			// spawning servers on the same runner.
			//
			// They are not every spawner, and the list does not aim to be. 106 of
			// the 160 db files boot an instance, so a file absent here is the norm
			// rather than an oversight — and a slot here buys less than it looks:
			// `cache-audit` and `autoscale-churn` have each failed once from inside
			// this chain, where the only company they had was the shard's own
			// serial order. Serialising a file costs its whole runtime, so move one
			// here on evidence that it raced, not on the fact that it spawns.
			'/tests/db/routes/items/cache-cancel-write.test.ts',
			'/tests/db/routes/items/cache-delete-scope.test.ts',
			'/tests/db/routes/items/cache-m2o-parent-key-pin.test.ts',
			'/tests/db/routes/items/cache-m2o-parent-pin-staleness.test.ts',
			'/tests/db/routes/items/cache-nested-write.test.ts',
			'/tests/db/routes/items/cache-poisoning-read.test.ts',
			'/tests/db/routes/items/cache-poisoning-write.test.ts',
			'/tests/db/routes/items/cache-primary-key-scope.test.ts',
			'/tests/db/routes/items/cache-purge-recovery.test.ts',
			'/tests/db/routes/items/cache-raw-purge.test.ts',
			'/tests/db/routes/items/cache-raw-purge-relational.test.ts',
			'/tests/db/routes/items/cache-read-scope.test.ts',
			'/tests/db/routes/items/cache-read-inflight-purge.test.ts',
			// Spawns an instance and builds a relation on a collection it has just
			// created. Left in the parallel middle that create-then-relate gap is
			// wide enough to lose: under a shard that packed it beside heavier
			// company it read back `Collection "..." doesn't exist` from its own
			// seed. Sixteen of its siblings already run here for the same reason.
			'/tests/db/routes/items/cache-slice-index.test.ts',
			'/tests/db/routes/items/cache-takeover-scope.test.ts',
			'/tests/db/routes/items/cache-unautopurgeable-scope.test.ts',
			'/tests/db/routes/items/cache-update-scope.test.ts',
			'/tests/db/routes/items/redis-outage-survival.test.ts',
			// The three audit suites share one settings singleton: a schedule one
			// of them writes reaches every node on the bus, the others' included,
			// so a `0 3 * * *` landing mid-wait would starve a sibling's per-second
			// cron witness.
			'/tests/db/routes/items/cache-audit.test.ts',
			'/tests/db/app/cache-audit-cli.test.ts',
			'/tests/db/app/cache-audit-mcp.test.ts',
			'/tests/db/websocket/auth-public-connects.test.ts',
			'/tests/db/websocket/auth-public-pings.test.ts',
			'/tests/db/websocket/auth-handshake-connects.test.ts',
			'/tests/db/websocket/auth-handshake-pings.test.ts',
			'/tests/db/websocket/auth-strict-connects.test.ts',
			'/tests/db/websocket/auth-strict-pings.test.ts',
			'/tests/db/websocket/general.test.ts',
			// WebSocket subscriptions starve under the parallel pool's load; run this
			// (split out of m2o.test.ts) sequentially like the other WS suites (#277).
			'/tests/db/routes/items/m2o-max-batch-mutation.test.ts',
			// `no-relation` subscribes to the artists collection over a WebSocket, and
			// this file writes `batch-N` rows into that same collection. Left in the
			// parallel middle its creates reach the subscriber's queue, and
			// `getMessages(1)` returns a row the assertion never asked for.
			'/tests/db/routes/items/batch-insert.test.ts',
			'/tests/db/routes/permissions/cache-purge.test.ts',
			'/tests/db/routes/flows/webhook.test.ts',
			'/tests/db/app/cache.test.ts',
			'/tests/db/app/processes.test.ts',
			'/tests/db/app/pgbouncer.test.ts',
			'/tests/db/app/system-mcp.test.ts',
			// A pm2 daemon each, and their decisions read a CPU duty cycle the
			// parallel middle would distort into any number the assertion asks for.
			'/tests/db/app/autoscale-ramp.test.ts',
			'/tests/db/app/autoscale-config-source.test.ts',
			'/tests/db/app/autoscale-legacy.test.ts',
			'/tests/db/app/autoscale-redis-outage.test.ts',
			'/tests/db/app/autoscale-release.test.ts',
			'/tests/db/app/autoscale-signal.test.ts',
			'/tests/db/app/autoscale-churn.test.ts',
			'/tests/db/app/autoscale-supervisor-restart.test.ts',
			'/tests/db/app/autoscale-supervisor-options.test.ts',
			// Spawns a Directus of its own beside a pm2 daemon, and asserts on a
			// collection window a loaded parallel middle would run out.
			'/tests/db/app/autoscale-processes.test.ts',
			// The same shape again — its own Directus, its own pm2 daemon, and a
			// collection window a loaded parallel middle would run out.
			'/tests/db/app/autoscale-mcp-levers.test.ts',
			// A Directus, a pm2 daemon and an autoscaler, and the claim is what
			// one says about the other two — a suite beside it scaling its own
			// pool reports on the same bus.
			'/tests/db/app/autoscale-pool-health.test.ts',
			// And again, with the pool being what the Directus beside it is
			// waiting on before it will report itself ready at all.
			'/tests/db/app/autoscale-prewarm-health.test.ts',
			'/tests/db/routes/collections/schema-cache.test.ts',
			// Reads the whole schema back against a snapshot taken a moment before:
			// a sibling creating its collections in between is a drift.
			'/tests/db/app/schema-diff-cli.test.ts',
		],
		// If specified, only run these tests sequentially
		only: [
			// '/tests/db/seed-database.test.ts',
			// '/common/common.test.ts',
		],
	},
};

// The `after` entries, chains unwrapped, in the order they are declared.
export function flatAfterList(project: 'db' | 'common'): string[] {
	return sequentialTestsList[project].after.flat();
}

/**
 * Where `testFilePath` sits in the completion barrier `setup/sequential-gate.ts`
 * waits on: a `before` slot counts up from the first file, an `after` slot counts
 * back from the last, and everything else runs once the `before` chain is done.
 *
 * `shardAfterFiles` is the after chain THIS shard runs, not the project-wide one
 * — a shard runs only its share, so a project-wide index would wait on
 * completions that never happen here.
 */
export function getReversedTestIndex(
	testFilePath: string,
	project: 'db' | 'common',
	shardAfterFiles: string[],
) {
	const list = sequentialTestsList[project];

	if (list.only.length > 0) {
		for (let index = 0; index < list.only.length; index++) {
			const onlyTest = list.only[index];

			if (onlyTest && testFilePath.includes(onlyTest)) {
				return index;
			}
		}
	}

	for (let index = 0; index < list.before.length; index++) {
		const beforeTest = list.before[index];

		if (beforeTest && testFilePath.includes(beforeTest)) {
			return index;
		}
	}

	for (let index = 0; index < shardAfterFiles.length; index++) {
		const afterTest = shardAfterFiles[index];

		if (afterTest && testFilePath.includes(afterTest)) {
			return 0 - shardAfterFiles.length + index;
		}
	}

	return list.before.length;
}

// An `after` entry is one file, or an ordered chain that has to stay in one
// shard because each of its files reads what the previous one wrote.
type AfterEntry = string | string[];

type SequentialTestsList = {
	before: string[];
	after: AfterEntry[];
	only: string[];
};
