import { useLogger } from "../../logger/index.js";
import { useRedis } from "../../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../../redis/utils/redis-config-available.js";
import "../../redis/index.js";
import { useEnv } from "@directus/env";

//#region src/database/migrations/20260911A-drop-the-pre-scoped-cache-index-layout.ts
const LEGACY_INDEX_KINDS = ["tag", "slices"];
const SCAN_COUNT = 1e3;
const UNLINK_CHUNK = 1e3;
async function unlinkKeysMatching(match) {
	const redis = useRedis();
	let cursor = "0";
	let dropped = 0;
	do {
		const [next, batch] = await redis.scan(cursor, "MATCH", match, "COUNT", SCAN_COUNT);
		cursor = next;
		if (batch.length > 0) {
			const pipeline = redis.pipeline();
			for (let at = 0; at < batch.length; at += UNLINK_CHUNK) pipeline.unlink(batch.slice(at, at + UNLINK_CHUNK));
			for (const [error, removed] of await pipeline.exec() ?? []) if (!error) dropped += Number(removed ?? 0);
		}
	} while (cursor !== "0");
	return dropped;
}
/**
* Drop the scoped-cache index keys the layout this replaced wrote —
* `<namespace>:tag:*` and `<namespace>:slices:*`.
*
* Nothing scans those patterns any more: both families moved under
* `<namespace>:scoped-cache-index:` so one `SCAN ... MATCH` covers them
* server-side in a single pass. A tag SET carries an expiry only when
* `CACHE_TTL` is set, so with it unset these are deliberately unbounded and an
* upgrade would strand them for good.
*
* Here rather than behind a marker key in Redis: a marker records "already done"
* inside the store being cleared, which is why it had to sit outside the flushed
* prefix and why it had to expire — and an expiring marker brings the two extra
* scan passes back every time it does. `directus_migrations` is the thing that
* actually knows this deployment upgraded, and it says so once.
*
* Scoped to those two prefixes rather than flushing the database: the cache-stats
* Redis Stream beside them is the only copy of its telemetry until the drain moves
* it into `directus_cache_stats_*`, and the locks under `directus:lock` may be held
* by another node while this runs.
*/
async function up(_knex) {
	if (!redisConfigAvailable()) return;
	const logger = useLogger();
	try {
		let dropped = 0;
		for (const kind of LEGACY_INDEX_KINDS) dropped += await unlinkKeysMatching(`${useEnv()["CACHE_NAMESPACE"]}:${kind}:*`);
		logger.info(`[cache] dropped ${dropped} keys of the old index layout`);
	} catch (error) {
		logger.warn(error, `[cache] could not drop the old index layout: ${error}`);
	}
}
async function down(_knex) {}

//#endregion
export { down, up };