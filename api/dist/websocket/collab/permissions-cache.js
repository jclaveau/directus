import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { IRRELEVANT_COLLECTIONS } from "./constants.js";
import { useEnv } from "@directus/env";
import { LRUMapWithDelete } from "mnemonist";

//#region src/websocket/collab/permissions-cache.ts
const env = useEnv();
/**
* Caches permission check results for collaborative editing clients.
* Supports granular invalidation based on collection, item, and relational dependencies.
*/
var PermissionCache = class {
	cache;
	tags = /* @__PURE__ */ new Map();
	keyTags = /* @__PURE__ */ new Map();
	timers = /* @__PURE__ */ new Map();
	bus = useBus();
	invalidationCount = 0;
	constructor(maxSize) {
		this.cache = new LRUMapWithDelete(maxSize);
		this.bus.subscribe("websocket.event", (event) => {
			this.handleInvalidation(event);
		});
	}
	/**
	* Used for race condition protection during async permission fetches.
	*/
	getInvalidationCount() {
		return this.invalidationCount;
	}
	/**
	* Clears entire cache for system collections, or performs granular invalidation for user data.
	*/
	handleInvalidation(event) {
		const { collection, keys, key } = event;
		const items = keys || (key ? [key] : []);
		const affectedKeys = /* @__PURE__ */ new Set();
		if ([
			"directus_roles",
			"directus_permissions",
			"directus_policies",
			"directus_access",
			"directus_fields",
			"directus_relations",
			"directus_collections"
		].includes(collection)) {
			this.clear();
			return;
		}
		if (IRRELEVANT_COLLECTIONS.includes(collection)) return;
		this.invalidationCount++;
		if (this.invalidationCount >= Number.MAX_SAFE_INTEGER) this.invalidationCount = 1;
		if (!this.tags.has(`collection:${collection}`) && !this.tags.has(`dependency:${collection}`) && !this.tags.has(`collection-dependency:${collection}`)) return;
		if (items.length === 0 && this.tags.has(`collection:${collection}`)) for (const k of this.tags.get(`collection:${collection}`)) affectedKeys.add(k);
		for (const id of items) {
			const tag = `item:${collection}:${id}`;
			if (this.tags.has(tag)) for (const k of this.tags.get(tag)) affectedKeys.add(k);
		}
		const depTags = [`dependency:${collection}`];
		if (items.length > 0) for (const id of items) depTags.push(`dependency:${collection}:${id}`);
		else depTags.push(`collection-dependency:${collection}`);
		for (const tag of depTags) if (this.tags.has(tag)) for (const k of this.tags.get(tag)) affectedKeys.add(k);
		for (const k of affectedKeys) this.invalidateKey(k);
	}
	/**
	* Get cached allowed fields for a given accountability and collection/item.
	* LRUMap automatically updates access order on get().
	*/
	get(accountability, collection, item, action) {
		const key = this.getCacheKey(accountability, collection, item, action);
		return this.cache.get(key);
	}
	/**
	* Store allowed fields in the cache with optional TTL and dependencies.
	*/
	set(accountability, collection, item, action, fields, dependencies = [], ttlMs) {
		const key = this.getCacheKey(accountability, collection, item, action);
		if (this.timers.has(key)) {
			clearTimeout(this.timers.get(key));
			this.timers.delete(key);
		}
		if (!this.cache.has(key) && this.cache.size >= this.cache.capacity) {
			const lruKey = this.cache.keys().next().value;
			if (lruKey) this.cleanupKeyMetadata(lruKey);
		}
		this.cache.set(key, fields);
		if (ttlMs) {
			const timer = setTimeout(() => {
				this.invalidateKey(key);
			}, ttlMs);
			this.timers.set(key, timer);
		}
		this.addTag(key, `item:${collection}:${item}`);
		this.addTag(key, `collection:${collection}`);
		for (const dep of dependencies) {
			this.addTag(key, `dependency:${dep}`);
			if (dep.includes(":")) {
				const [dependencyCollection] = dep.split(":");
				this.addTag(key, `collection-dependency:${dependencyCollection}`);
			}
		}
	}
	/**
	* Called before LRU eviction or explicit invalidation to prevent orphaned metadata.
	*/
	cleanupKeyMetadata(key) {
		if (this.timers.has(key)) {
			clearTimeout(this.timers.get(key));
			this.timers.delete(key);
		}
		const tags = this.keyTags.get(key);
		if (tags) {
			for (const tag of tags) {
				const keys = this.tags.get(tag);
				if (keys) {
					keys.delete(key);
					if (keys.size === 0) this.tags.delete(tag);
				}
			}
			this.keyTags.delete(key);
		}
	}
	/**
	* Maintains bidirectional mappings: tag → keys and key → tags.
	*/
	addTag(key, tag) {
		if (!this.tags.has(tag)) this.tags.set(tag, /* @__PURE__ */ new Set());
		this.tags.get(tag).add(key);
		if (!this.keyTags.has(key)) this.keyTags.set(key, /* @__PURE__ */ new Set());
		this.keyTags.get(key).add(tag);
	}
	/**
	* Cleans up metadata first, then removes from cache.
	*/
	invalidateKey(key) {
		this.cleanupKeyMetadata(key);
		this.cache.delete(key);
	}
	/**
	* Cache key format: user:collection:item:action
	*/
	getCacheKey(accountability, collection, item, action) {
		return `${accountability.user || "public"}:${collection}:${item || "singleton"}:${action}`;
	}
	/**
	* Clear the entire cache.
	*/
	clear() {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.cache.clear();
		this.tags.clear();
		this.keyTags.clear();
		this.invalidationCount++;
	}
};
const permissionCache = new PermissionCache(Number(env["WEBSOCKETS_COLLAB_PERMISSIONS_CACHE_CAPACITY"] ?? 2e3));

//#endregion
export { PermissionCache, permissionCache };