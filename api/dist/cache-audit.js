import database_default from "./database/index.js";
import { advanceCacheAuditQueue, cacheStatsConfigured, claimCacheAnomalyThrottleSlot, evictCacheEntry, listPurgesCoveringEntry, queueCacheAnomaly, readCacheAuditQueue, readScopedCacheEntryTags, retireCacheAuditQueue } from "./cache-events.js";
import { decompress } from "./utils/compress.js";
import { getCache, getCacheValue } from "./cache.js";
import { getSecret } from "./utils/get-secret.js";
import { CACHE_AUDIT_REPLAY_HEADER, CACHE_AUDIT_TAGS_HEADER, cacheAuditReplayToken } from "./utils/cache-audit-replay.js";
import { UNDER_PRESSURE_REASON } from "./middleware/shed-under-pressure.js";
import { useEnv } from "@directus/env";
import jwt from "jsonwebtoken";
import http from "node:http";
import pLimit from "p-limit";

//#region src/cache-audit.ts
const CACHE_AUDIT_VERDICTS = [
	"fresh",
	"stale",
	"tag_drift",
	"raced",
	"time_varying",
	"expired",
	"unreplayable"
];
const REPLAY_CONCURRENCY = 4;
const QUEUE_PAGE = 500;
const DIFF_PATHS_REPORTED = 20;
const DIFF_PATHS_COMPARED = 500;
const REPLAY_TOKEN_TTL = "60s";
async function auditCache(options = {}) {
	const startedAt = Date.now();
	const { cache } = getCache();
	const report = {
		scanned: 0,
		counts: emptyCounts(),
		findings: [],
		evicted: 0,
		durationMs: 0,
		timedOut: false
	};
	if (!cache) {
		report.durationMs = Date.now() - startedAt;
		return report;
	}
	if (!cacheStatsConfigured()) throw new Error("The cache audit replays the request descriptors: CACHE_STATS_ENABLED is off");
	const audit = new CacheAudit(cache, options);
	const limit = pLimit(REPLAY_CONCURRENCY);
	const before = new Date(startedAt);
	const filter = {
		user: options.user,
		collection: options.collection
	};
	for (;;) {
		const room = options.limit === void 0 ? Number.POSITIVE_INFINITY : options.limit - report.scanned;
		if (room <= 0) break;
		const due = await readCacheAuditQueue(QUEUE_PAGE, before, filter);
		if (due.length === 0) break;
		const askedAt = /* @__PURE__ */ new Date();
		const held = await askHeld(cache, due.map((row) => row.redisKey));
		const gone = [];
		const taken = [];
		due.forEach((row, index) => {
			if (held[index] !== true) gone.push(row.cacheKey);
			else if (taken.length < room) taken.push(row);
		});
		const [stored, tags] = await Promise.all([cache.getMany(taken.flatMap((row) => [row.redisKey, expiryKey(row.redisKey)])), readScopedCacheEntryTags(taken.map((row) => row.cacheKey))]);
		const batch = taken.map((row, index) => {
			return {
				descriptor: {
					...row,
					scopedCacheTags: tags.get(row.cacheKey) ?? []
				},
				raw: stored[index * 2],
				rawExpiry: stored[index * 2 + 1]
			};
		});
		await Promise.all([retireCacheAuditQueue(gone, askedAt), advanceCacheAuditQueue(batch.map((entry) => entry.descriptor.cacheKey), /* @__PURE__ */ new Date())]);
		for (const finding of await audit.examine(batch, limit)) {
			report.scanned += 1;
			report.counts[finding.verdict] += 1;
			if (finding.verdict !== "fresh") report.findings.push(finding);
		}
		if (options.maxDurationMs !== void 0 && Date.now() - startedAt >= options.maxDurationMs) {
			report.timedOut = true;
			break;
		}
	}
	if (options.purge === true) {
		for (const finding of report.findings) if (finding.verdict === "stale" || finding.verdict === "tag_drift") {
			await evictCacheEntry(cache, finding.redisKey);
			report.evicted += 1;
		}
	}
	report.durationMs = Date.now() - startedAt;
	return report;
}
/**
* Whether the cache holds each key. A Keyv answers a store it lost with "not
* held" for every key (and throws only for one it never reached), which the
* loop above would take for a page of entries gone and retire: asked here
* with an ear on the store's error, so an outage of either kind fails the run
* and retires nothing.
*/
async function askHeld(cache, redisKeys) {
	let failure;
	const onError = (error) => {
		failure = error;
	};
	cache.on("error", onError);
	try {
		const held = await cache.hasMany(redisKeys);
		if (failure === void 0) return held;
	} catch (error) {
		failure = error;
	} finally {
		cache.off("error", onError);
	}
	throw new Error(`The cache could not be asked what it holds: ${describeFailure(failure)}`);
}
function describeFailure(failure) {
	if (failure instanceof AggregateError) return failure.errors.map(describeFailure).at(-1) ?? failure.name;
	if (failure instanceof Error) return failure.message || failure.name;
	return String(failure);
}
function expiryKey(redisKey) {
	return `${redisKey}__expires_at`;
}
function emptyCounts() {
	return Object.fromEntries(CACHE_AUDIT_VERDICTS.map((verdict) => [verdict, 0]));
}
var CacheAudit = class {
	replay;
	ignore;
	users = /* @__PURE__ */ new Map();
	constructor(cache, options) {
		this.cache = cache;
		this.replay = options.replay ?? loopbackReplayer();
		this.ignore = [...useEnv()["CACHE_AUDIT_IGNORE_PATHS"] ?? [], ...options.ignore ?? []].map((glob) => glob.split("/").slice(1));
	}
	async examine(batch, limit) {
		return Promise.all(batch.map((entry) => limit(() => this.examineEntry(entry))));
	}
	async examineEntry(entry) {
		const { descriptor } = entry;
		const verdict = await this.judge(entry);
		const now = Date.now();
		const finding = {
			verdict: verdict.verdict,
			reason: "reason" in verdict ? verdict.reason : null,
			redisKey: descriptor.redisKey,
			cacheKey: descriptor.cacheKey,
			method: descriptor.method,
			url: descriptorUrl(descriptor),
			query: descriptor.query,
			user: descriptor.userId,
			collection: descriptor.collection,
			filledAt: descriptor.lastFilled.getTime(),
			ageMs: Math.max(now - descriptor.lastFilled.getTime(), 0),
			tags: descriptor.scopedCacheTags,
			replayTags: "replayTags" in verdict ? verdict.replayTags : null,
			diff: "diff" in verdict ? verdict.diff : null,
			purgesSinceFilled: null
		};
		if (verdict.verdict === "stale") {
			finding.purgesSinceFilled = await listPurgesCoveringEntry(descriptor.cacheKey, descriptor.lastFilled);
			await this.recordAnomaly(descriptor, "stale_entry", verdict.diff?.join(" ") ?? verdict.reason);
		}
		if (verdict.verdict === "tag_drift") await this.recordAnomaly(descriptor, "tag_drift", `filled under ${descriptor.scopedCacheTags.join(",") || "(none)"}, replay pinned ${verdict.replayTags.join(",") || "(none)"}`);
		return finding;
	}
	async judge(entry) {
		const { descriptor } = entry;
		const { redisKey } = descriptor;
		let snapshot = await this.snapshot(redisKey, entry.raw, entry.rawExpiry);
		if (snapshot === null) return { verdict: "raced" };
		if (snapshot.body === void 0) return {
			verdict: "unreplayable",
			reason: "unreadable"
		};
		if (snapshot.expiresAt !== null && snapshot.expiresAt <= Date.now()) return { verdict: "expired" };
		const plan = replayPlan(descriptor);
		if ("reason" in plan) return {
			verdict: "unreplayable",
			reason: plan.reason
		};
		const authorization = await this.authorizationFor(descriptor.userId);
		if (authorization === null) return {
			verdict: "unreplayable",
			reason: "user_gone"
		};
		if (authorization !== "") plan.request.headers["authorization"] = authorization;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const fresh = await this.replayBody(plan.request);
			if ("verdict" in fresh) return fresh;
			const diff = this.diff(snapshot.body, fresh.body);
			if (diff.length === 0) return sameTags(descriptor.scopedCacheTags, fresh.tags) ? { verdict: "fresh" } : {
				verdict: "tag_drift",
				replayTags: fresh.tags
			};
			const moved = await this.movedSince(redisKey, snapshot);
			if (moved === "gone") return { verdict: "raced" };
			if (moved === "refilled") {
				snapshot = await this.snapshot(redisKey, void 0, void 0);
				if (snapshot === null || snapshot.body === void 0) return { verdict: "raced" };
				continue;
			}
			const again = await this.replayBody(plan.request);
			if ("verdict" in again) return again;
			if (this.diff(fresh.body, again.body).length > 0) return {
				verdict: "time_varying",
				diff,
				replayTags: fresh.tags
			};
			return {
				verdict: "stale",
				reason: null,
				diff,
				replayTags: fresh.tags
			};
		}
		return { verdict: "raced" };
	}
	/**
	* The body and its expiry sidecar as the page read handed them, or both
	* re-read from the cache when a retry needs the current pair. Null once
	* the key is gone; `undefined` body for a value that does not decompress.
	*/
	async snapshot(redisKey, raw, rawExpiry) {
		let stored = raw;
		let expiry = void 0;
		if (stored === void 0) {
			stored = await this.cache.get(redisKey);
			if (stored === void 0) return null;
			expiry = await getCacheValue(this.cache, expiryKey(redisKey));
		} else if (rawExpiry !== void 0) try {
			expiry = await decompress(rawExpiry);
		} catch {
			expiry = void 0;
		}
		let body;
		try {
			body = await decompress(stored);
		} catch {
			body = void 0;
		}
		const sidecar = isRecord(expiry) ? expiry : {};
		return {
			body,
			createdAt: typeof sidecar["createdAt"] === "number" ? sidecar["createdAt"] : null,
			expiresAt: typeof sidecar["exp"] === "number" ? sidecar["exp"] : null
		};
	}
	async createdAt(redisKey) {
		const expiry = await getCacheValue(this.cache, expiryKey(redisKey));
		return typeof expiry?.createdAt === "number" ? expiry.createdAt : null;
	}
	async movedSince(redisKey, snapshot) {
		if (!await this.cache.has(redisKey)) return "gone";
		if (snapshot.createdAt === null) return "held";
		return await this.createdAt(redisKey) === snapshot.createdAt ? "held" : "refilled";
	}
	async replayBody(request) {
		let response;
		try {
			response = await this.replay(request);
		} catch (error) {
			return {
				verdict: "unreplayable",
				reason: transportReason(error)
			};
		}
		if (response.status === 403) return {
			verdict: "stale",
			reason: "replay_status_403",
			diff: null,
			replayTags: null
		};
		if (response.status === 503 && answeredUnderPressure(response.body)) return {
			verdict: "unreplayable",
			reason: "status_503_under_pressure"
		};
		if (response.status < 200 || response.status >= 300) return {
			verdict: "unreplayable",
			reason: `status_${response.status}`
		};
		const tagged = response.headers[CACHE_AUDIT_TAGS_HEADER];
		if (typeof tagged !== "string") return {
			verdict: "unreplayable",
			reason: "replay_unrecognized"
		};
		try {
			return {
				body: JSON.parse(response.body),
				tags: tagged.split(",").filter(Boolean)
			};
		} catch {
			return {
				verdict: "unreplayable",
				reason: "body"
			};
		}
	}
	diff(stored, fresh) {
		const paths = [];
		diffPaths(canonical(stored), canonical(fresh), "", paths);
		return paths.filter((path) => !this.ignored(path)).slice(0, DIFF_PATHS_REPORTED);
	}
	ignored(path) {
		const segments = path.split("/").slice(1);
		return this.ignore.some((glob) => globMatches(glob, segments));
	}
	/**
	* A minted access token for the user the entry was filled for, `''` for a
	* public fill, null for a user that no longer exists. `{ id, role }` is all
	* the token needs to carry: the app rebuilds the rest from the database, as
	* it does for any access token.
	*/
	async authorizationFor(userId) {
		if (userId === null) return "";
		let lookup = this.users.get(userId);
		if (lookup === void 0) {
			lookup = database_default()("directus_users").where({ id: userId }).first("id", "role").then((row) => row ?? null);
			this.users.set(userId, lookup);
		}
		const user = await lookup;
		if (user === null) return null;
		return `Bearer ${jwt.sign({
			id: user.id,
			role: user.role,
			app_access: false,
			admin_access: false
		}, getSecret(), {
			expiresIn: REPLAY_TOKEN_TTL,
			issuer: "directus"
		})}`;
	}
	async recordAnomaly(descriptor, reason, detail) {
		if (await claimCacheAnomalyThrottleSlot(reason, descriptor.cacheKey)) queueCacheAnomaly({
			cacheKey: descriptor.cacheKey,
			reason,
			detail
		});
	}
};
function answeredUnderPressure(body) {
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		return false;
	}
	return parsed?.errors?.some((error) => {
		return error.extensions?.reason === UNDER_PRESSURE_REASON;
	}) === true;
}
function descriptorUrl(descriptor) {
	if (descriptor.query === "" || descriptor.path.startsWith("/graphql")) return descriptor.path;
	return `${descriptor.path}?${descriptor.query}`;
}
/**
* The request a descriptor describes, rebuilt as it was sent. A GraphQL read
* is replayed as a POST of its stored document whichever method filled it: the
* document is what the descriptor kept, the query string it may have travelled
* in is not.
*/
function replayPlan(descriptor) {
	const headers = {
		accept: "application/json",
		[CACHE_AUDIT_REPLAY_HEADER]: cacheAuditReplayToken()
	};
	if (descriptor.path.startsWith("/graphql")) {
		let document;
		try {
			document = JSON.parse(descriptor.query);
		} catch {
			return { reason: "document" };
		}
		if (typeof document !== "object" || document === null) return { reason: "document" };
		headers["content-type"] = "application/json";
		return {
			url: descriptor.path,
			request: {
				method: "POST",
				path: descriptor.path,
				headers,
				body: JSON.stringify(document)
			}
		};
	}
	if (descriptor.method.toUpperCase() !== "GET") return { reason: "method" };
	if (descriptor.query.startsWith("{")) return { reason: "query" };
	const url = descriptorUrl(descriptor);
	return {
		url,
		request: {
			method: "GET",
			path: url,
			headers
		}
	};
}
function sameTags(filled, replayed) {
	const a = [...new Set(filled)].sort();
	const b = [...new Set(replayed)].sort();
	return a.length === b.length && a.every((tag, index) => tag === b[index]);
}
function canonical(value) {
	return value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));
}
function diffPaths(a, b, path, out) {
	if (out.length >= DIFF_PATHS_COMPARED) return;
	if (Array.isArray(a) && Array.isArray(b)) {
		const length = Math.max(a.length, b.length);
		for (let index = 0; index < length; index += 1) if (index >= a.length || index >= b.length) out.push(`${path}/${index}`);
		else diffPaths(a[index], b[index], `${path}/${index}`, out);
		return;
	}
	if (isRecord(a) && isRecord(b)) {
		for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!(key in a) || !(key in b)) out.push(`${path}/${key}`);
		else diffPaths(a[key], b[key], `${path}/${key}`, out);
		return;
	}
	if (a !== b) out.push(path || "/");
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function globMatches(glob, segments) {
	for (let index = 0; index < glob.length; index += 1) {
		if (glob[index] === "**") return true;
		if (index >= segments.length) return false;
		if (glob[index] !== "*" && glob[index] !== segments[index]) return false;
	}
	return glob.length === segments.length;
}
const REASON_MAX_LENGTH = 64;
function transportReason(error) {
	const code = typeof error === "object" && error !== null && "code" in error ? error.code : void 0;
	return typeof code === "string" && code !== "" ? `transport_${code.toLowerCase()}`.slice(0, REASON_MAX_LENGTH) : "transport";
}
/**
* The replay's tags come back in one header, and a deep read pins one tag per
* related key: 370 of them ran past node's 16KB header cap and every audit of
* that entry ended `HPE_HEADER_OVERFLOW`. Room for the fan-out #392 leaves
* unbounded; the parser buffers only what a response actually sends.
*/
const REPLAY_MAX_HEADER_SIZE = 1024 * 1024;
/**
* A replayer speaking to the app's own listener, never through PUBLIC_URL: the
* audit asks what THIS deployment would answer, and a proxy or a CDN in front
* of it is exactly the kind of cache it must not be answered by.
*/
function loopbackReplayer(target = loopbackTarget()) {
	return (request) => {
		return new Promise((resolve, reject) => {
			const outgoing = http.request({
				...target,
				method: request.method,
				path: request.path,
				headers: request.headers,
				maxHeaderSize: REPLAY_MAX_HEADER_SIZE
			}, (incoming) => {
				const chunks = [];
				incoming.on("data", (chunk) => chunks.push(chunk));
				incoming.on("end", () => {
					resolve({
						status: incoming.statusCode ?? 0,
						headers: Object.fromEntries(Object.entries(incoming.headers).map(([name, value]) => {
							return [name, Array.isArray(value) ? value.join(", ") : value];
						})),
						body: Buffer.concat(chunks).toString("utf8")
					});
				});
				incoming.on("error", reject);
			});
			outgoing.on("error", reject);
			outgoing.end(request.body);
		});
	};
}
function loopbackTarget() {
	const env = useEnv();
	if (env["UNIX_SOCKET_PATH"]) return { socketPath: String(env["UNIX_SOCKET_PATH"]) };
	const host = String(env["HOST"] ?? "");
	if (host === "" || host === "0.0.0.0") return {
		host: "127.0.0.1",
		port: Number(env["PORT"])
	};
	if (host === "::") return {
		host: "::1",
		port: Number(env["PORT"])
	};
	return {
		host,
		port: Number(env["PORT"])
	};
}

//#endregion
export { CACHE_AUDIT_VERDICTS, REPLAY_MAX_HEADER_SIZE, auditCache, loopbackReplayer, loopbackTarget };