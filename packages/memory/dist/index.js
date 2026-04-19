import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { parseJSON } from "@directus/utils";
import { Buffer } from "node:buffer";
import { LRUCache } from "lru-cache";
import { processId } from "@directus/utils/node";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { HitRateLimitError } from "@directus/errors";

//#region src/bus/lib/local.ts
var BusLocal = class {
	handlers;
	constructor(_config) {
		this.handlers = {};
	}
	async publish(channel, payload) {
		this.handlers[channel]?.forEach((callback) => {
			try {
				callback(payload);
			} catch {}
		});
	}
	async subscribe(channel, callback) {
		const set = this.handlers[channel] ?? /* @__PURE__ */ new Set();
		set.add(callback);
		this.handlers[channel] = set;
	}
	async unsubscribe(channel, callback) {
		this.handlers[channel]?.delete(callback);
	}
};

//#endregion
//#region src/utils/buffer-to-uint8array.ts
/**
* Convert a NodeJS Buffer to a JS Uint8Array
*
* @param buffer NodeJS Buffer
* @returns JS Uint8Array
*/
const bufferToUint8Array = (buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

//#endregion
//#region src/utils/compress.ts
const gzip$1 = promisify(gzip);
const gunzip$1 = promisify(gunzip);
/**
* Gzip compress a given input Uint8Array
*
* @param input Uint8Array to compress
* @returns Compressed Uint8Array
*/
const compress = async (input) => {
	return bufferToUint8Array(await gzip$1(input));
};
/**
* Gzip decompress a given input Uint8Array
*
* @param input Uint8Array to decompress
* @returns Decompressed Uint8Array
*/
const decompress = async (input) => {
	return bufferToUint8Array(await gunzip$1(input));
};

//#endregion
//#region src/utils/is-compressed.ts
const isCompressed = (array) => {
	/**
	* Gzipped values always have a 10-byte header, an 8-byte footer, and a minimum value of 1 byte
	*/
	if (array.byteLength < 19) return false;
	/**
	* The Gzip header starts with a 2-byte identifying magic number (1f 8b) followed by 08 for the
	* deflate compression method
	*/
	return array[0] === 31 && array[1] === 139 && array[2] === 8;
};

//#endregion
//#region src/utils/string-to-uint8array.ts
const encoder = new TextEncoder();
/**
* Convert a String to a JS Uint8Array
*/
const stringToUint8Array = (val) => encoder.encode(val);

//#endregion
//#region src/utils/uint8array-to-string.ts
const decoder = new TextDecoder();
/**
* Convert a JS Uint8Array to a String
*/
const uint8ArrayToString = (val) => decoder.decode(val);

//#endregion
//#region src/utils/serialize.ts
/**
* Serialize a given JavaScript value to it's Uint8Array equivalent
*
* @param val - JS value to serialize
* @returns Uint8Array of serialized value
*/
const serialize = (val) => {
	return stringToUint8Array(JSON.stringify(val));
};
/**
* Deserialize a given Uint8Array into a JavaScript value
*
* @param val - Binary array to deserialize
* @returns JavaScript value
*/
const deserialize = (val) => {
	return parseJSON(uint8ArrayToString(val));
};

//#endregion
//#region src/utils/uint8array-to-buffer.ts
const uint8ArrayToBuffer = (array) => Buffer.from(array);

//#endregion
//#region src/utils/with-namespace.ts
/**
* Prepend given namespace to given key, separated by a `:`
*
* @param key Key to prefix
* @param namespace Namespace to prefix key with
* @returns Namespace prefixed key
*/
const withNamespace = (key, namespace) => `${namespace}:${key}`;

//#endregion
//#region src/bus/lib/redis.ts
var BusRedis = class {
	pub;
	sub;
	namespace;
	compression;
	compressionMinSize;
	handlers;
	constructor(config) {
		this.namespace = config.namespace;
		this.pub = config.redis;
		this.sub = config.redis.duplicate();
		this.sub.on("messageBuffer", (channel, message) => this.messageBufferHandler(channel, message));
		this.compression = config.compression ?? true;
		this.compressionMinSize = config.compressionMinSize ?? 1e3;
		this.handlers = {};
	}
	async publish(channel, message) {
		let binaryArray = serialize(message);
		if (this.compression === true && binaryArray.byteLength >= this.compressionMinSize) binaryArray = await compress(binaryArray);
		await this.pub.publish(withNamespace(channel, this.namespace), uint8ArrayToBuffer(binaryArray));
	}
	async subscribe(channel, callback) {
		const namespaced = withNamespace(channel, this.namespace);
		const existingSet = this.handlers[namespaced];
		if (existingSet === void 0) {
			const set = /* @__PURE__ */ new Set();
			set.add(callback);
			this.handlers[namespaced] = set;
			await this.sub.subscribe(namespaced);
		} else existingSet.add(callback);
	}
	async unsubscribe(channel, callback) {
		const namespaced = withNamespace(channel, this.namespace);
		const set = this.handlers[namespaced];
		if (set === void 0) return;
		set.delete(callback);
		if (set.size === 0) {
			delete this.handlers[namespaced];
			await this.sub.unsubscribe(namespaced);
		}
	}
	/**
	* To avoid adding unnecessary active handles in node, we have 1 listener for all messages from
	* Redis, and call the individual registered callbacks from the handlers object
	*
	* @NOTE this method expects the namespaced channel name
	*
	* @param channel The namespaced channel the message was sent in
	* @param message Buffer of the message value that was sent in the given channel
	*/
	async messageBufferHandler(channel, message) {
		const namespaced = uint8ArrayToString(bufferToUint8Array(channel));
		if (namespaced in this.handlers === false) return;
		let binaryArray = bufferToUint8Array(message);
		if (this.compression === true && isCompressed(binaryArray)) binaryArray = await decompress(binaryArray);
		const deserialized = deserialize(binaryArray);
		this.handlers[namespaced]?.forEach((callback) => callback(deserialized));
	}
};

//#endregion
//#region src/bus/lib/create.ts
const createBus = (config) => {
	if (config.type === "local") return new BusLocal(config);
	if (config.type === "redis") return new BusRedis(config);
	throw new Error(`Invalid Bus configuration: Type does not exist.`);
};

//#endregion
//#region src/kv/lib/local.ts
var KvLocal = class {
	store;
	constructor(config) {
		if ("maxKeys" in config) this.store = new LRUCache({ max: config.maxKeys });
		else this.store = /* @__PURE__ */ new Map();
	}
	async get(key) {
		const value = this.store.get(key);
		if (value !== void 0) return deserialize(value);
	}
	async set(key, value) {
		const serialized = serialize(value);
		this.store.set(key, serialized);
	}
	async delete(key) {
		this.store.delete(key);
	}
	async has(key) {
		return this.store.has(key);
	}
	async increment(key, amount = 1) {
		const currentVal = await this.get(key) ?? 0;
		if (typeof currentVal !== "number") throw new Error(`The value for key "${key}" is not a number.`);
		const newVal = currentVal + amount;
		await this.set(key, newVal);
		return newVal;
	}
	async setMax(key, value) {
		const currentVal = await this.get(key) ?? 0;
		if (typeof currentVal !== "number") throw new Error(`The value for key "${key}" is not a number.`);
		if (currentVal > value) return false;
		await this.set(key, value);
		return true;
	}
	async clear() {
		this.store.clear();
	}
};

//#endregion
//#region src/kv/lib/redis.ts
const SET_MAX_SCRIPT = `
  local key = KEYS[1]
  local value = tonumber(ARGV[1])

  if redis.call("EXISTS", key) == 1 then
    local oldValue = tonumber(redis.call('GET', key))

    if value <= oldValue then
      return false
    end
  end

  redis.call('SET', key, value)

  return true
`;
var KvRedis = class {
	redis;
	namespace;
	compression;
	compressionMinSize;
	constructor(config) {
		if ("setMax" in config.redis === false) config.redis.defineCommand("setMax", {
			numberOfKeys: 1,
			lua: SET_MAX_SCRIPT
		});
		this.redis = config.redis;
		this.namespace = config.namespace;
		this.compression = config.compression ?? true;
		this.compressionMinSize = config.compressionMinSize ?? 1e3;
	}
	async get(key) {
		const value = await this.redis.getBuffer(withNamespace(key, this.namespace));
		if (value === null) return;
		let binaryArray = bufferToUint8Array(value);
		if (this.compression === true && isCompressed(binaryArray)) binaryArray = await decompress(binaryArray);
		return deserialize(binaryArray);
	}
	async set(key, value) {
		if (typeof value === "number") await this.redis.set(withNamespace(key, this.namespace), value);
		else {
			let binaryArray = serialize(value);
			if (this.compression === true && binaryArray.byteLength >= this.compressionMinSize) binaryArray = await compress(binaryArray);
			await this.redis.set(withNamespace(key, this.namespace), uint8ArrayToBuffer(binaryArray));
		}
	}
	async delete(key) {
		await this.redis.unlink(withNamespace(key, this.namespace));
	}
	async has(key) {
		return await this.redis.exists(withNamespace(key, this.namespace)) !== 0;
	}
	async increment(key, amount = 1) {
		return await this.redis.incrby(withNamespace(key, this.namespace), amount);
	}
	async setMax(key, value) {
		return await this.redis.setMax(withNamespace(key, this.namespace), value) !== 0;
	}
	async clear() {
		const keysStream = this.redis.scanStream({ match: withNamespace("*", this.namespace) });
		const pipeline = this.redis.pipeline();
		for await (const keys of keysStream) pipeline.unlink(keys);
		await pipeline.exec();
	}
};

//#endregion
//#region src/kv/lib/create.ts
const createKv = (config) => {
	if (config.type === "local") return new KvLocal(config);
	if (config.type === "redis") return new KvRedis(config);
	throw new Error(`Invalid KV configuration: Type does not exist.`);
};

//#endregion
//#region src/cache/lib/local.ts
var CacheLocal = class {
	store;
	constructor(config) {
		this.store = createKv({
			type: "local",
			...config
		});
	}
	async get(key) {
		return await this.store.get(key);
	}
	async set(key, value) {
		return await this.store.set(key, value);
	}
	async delete(key) {
		await this.store.delete(key);
	}
	async has(key) {
		return await this.store.has(key);
	}
	async clear() {
		await this.store.clear();
	}
};

//#endregion
//#region src/cache/lib/redis.ts
var CacheRedis = class {
	store;
	constructor(config) {
		this.store = createKv({
			type: "redis",
			...config
		});
	}
	async get(key) {
		return await this.store.get(key);
	}
	async set(key, value) {
		return await this.store.set(key, value);
	}
	async delete(key) {
		return await this.store.delete(key);
	}
	async has(key) {
		return await this.store.has(key);
	}
	async clear() {
		await this.store.clear();
	}
};

//#endregion
//#region src/cache/lib/multi.ts
const CACHE_CHANNEL_KEY = "multi-cache";
var CacheMulti = class {
	processId = processId();
	local;
	redis;
	bus;
	constructor(config) {
		this.local = new CacheLocal(config.local);
		this.redis = new CacheRedis(config.redis);
		this.bus = createBus({
			type: "redis",
			redis: config.redis.redis,
			namespace: config.redis.namespace
		});
		this.bus.subscribe(CACHE_CHANNEL_KEY, (payload) => this.onMessageClear(payload));
	}
	async get(key) {
		const local = await this.local.get(key);
		if (local !== void 0) return local;
		return await this.redis.get(key);
	}
	async set(key, value) {
		await Promise.all([this.local.set(key, value), this.redis.set(key, value)]);
		await this.clearOthers(key);
	}
	async delete(key) {
		await Promise.all([this.local.delete(key), this.redis.delete(key)]);
		await this.clearOthers(key);
	}
	async has(key) {
		return await this.redis.has(key);
	}
	async clearOthers(key) {
		await this.bus.publish(CACHE_CHANNEL_KEY, {
			type: "clear",
			key,
			origin: this.processId
		});
	}
	async clear() {
		await Promise.all([this.local.clear(), this.redis.clear()]);
		await this.clearOthers();
	}
	async onMessageClear(payload) {
		if (payload.origin === this.processId) return;
		if (payload.key !== void 0) await this.local.delete(payload.key);
		else await this.local.clear();
	}
};

//#endregion
//#region src/cache/lib/create.ts
const createCache = (config) => {
	if (config.type === "local") return new CacheLocal(config);
	if (config.type === "redis") return new CacheRedis(config);
	if (config.type === "multi") return new CacheMulti(config);
	throw new Error(`Invalid Cache configuration: Type does not exist.`);
};

//#endregion
//#region src/cache/lib/define.ts
const defineCache = (config) => {
	let cache;
	const useCache = () => {
		if (cache) return cache;
		cache = createCache(config);
		return cache;
	};
	return useCache;
};

//#endregion
//#region src/limiter/utils/consume.ts
/**
* Shared consume handler
*
* @param limiter Rate limiter instance. Intended for memory or redis
* @param key Key to consume a point for
* @param availablePoints Total configured available points
*/
const consume = async (limiter, key, availablePoints) => {
	try {
		await limiter.consume(key);
	} catch (err) {
		if (err instanceof Error) throw err;
		const { msBeforeNext } = err;
		throw new HitRateLimitError({
			limit: availablePoints,
			reset: new Date(Date.now() + msBeforeNext)
		});
	}
};

//#endregion
//#region src/limiter/lib/local.ts
var LimiterLocal = class {
	limiter;
	points;
	constructor(config) {
		this.limiter = new RateLimiterMemory({
			duration: config.duration,
			points: config.points
		});
		this.points = config.points;
	}
	async consume(key) {
		return await consume(this.limiter, key, this.points);
	}
	async delete(key) {
		await this.limiter.delete(key);
	}
};

//#endregion
//#region src/limiter/lib/redis.ts
var LimiterRedis = class {
	limiter;
	points;
	constructor(config) {
		this.limiter = new RateLimiterRedis({
			storeClient: config.redis,
			keyPrefix: config.namespace,
			points: config.points,
			duration: config.duration
		});
		this.points = config.points;
	}
	async consume(key) {
		return await consume(this.limiter, key, this.points);
	}
	async delete(key) {
		await this.limiter.delete(key);
	}
};

//#endregion
//#region src/limiter/lib/create.ts
const createLimiter = (config) => {
	if (config.type === "local") return new LimiterLocal(config);
	if (config.type === "redis") return new LimiterRedis(config);
	throw new Error(`Invalid Limiter configuration: Type does not exist.`);
};

//#endregion
export { BusLocal, BusRedis, CACHE_CHANNEL_KEY, CacheLocal, CacheMulti, CacheRedis, KvLocal, KvRedis, LimiterLocal, LimiterRedis, SET_MAX_SCRIPT, createBus, createCache, createKv, createLimiter, defineCache };