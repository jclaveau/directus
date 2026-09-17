import { getSecret } from "./get-secret.js";
import { createHmac, timingSafeEqual } from "node:crypto";

//#region src/utils/cache-audit-replay.ts
/**
* The cache audit replays a cached request against the running app and needs
* that replay to neither be answered from the cache nor written back to it: a
* HIT would compare the entry with itself, and a refill would overwrite the
* evidence. `Cache-Control: no-store` only does the first half, and is gated
* on CACHE_SKIP_ALLOWED which a deployment may keep off.
*
* The marker is an HMAC over SECRET rather than a per-process nonce so it
* holds across the workers of one PM2 cluster, whichever of them the loopback
* lands on — and cannot be forged by a client into a cache bypass.
*/
const CACHE_AUDIT_REPLAY_HEADER = "x-cache-audit-replay";
/**
* Set on every recognised replay, so the audit can tell a response that went
* through the cache stack from one that did not (a worker with another SECRET,
* a proxy answering in between).
*/
const CACHE_AUDIT_TAGS_HEADER = "x-cache-audit-tags";
function cacheAuditReplayToken() {
	return createHmac("sha256", getSecret()).update("cache-audit-replay").digest("hex");
}
function isCacheAuditReplay(req) {
	const sent = req.get(CACHE_AUDIT_REPLAY_HEADER);
	if (typeof sent !== "string" || sent === "") return false;
	const expected = cacheAuditReplayToken();
	return sent.length === expected.length && timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}

//#endregion
export { CACHE_AUDIT_REPLAY_HEADER, CACHE_AUDIT_TAGS_HEADER, cacheAuditReplayToken, isCacheAuditReplay };