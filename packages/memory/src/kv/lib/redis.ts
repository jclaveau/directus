import {
	bufferToUint8Array,
	compress,
	decompress,
	deserialize,
	isCompressed,
	serialize,
	uint8ArrayToBuffer,
	withNamespace,
} from '../../utils/index.js';
import type { CacheRead } from '../../cache/types/class.js';
import type { ExtendedRedis, KvConfigRedis } from '../index.js';
import type { Kv } from '../types/class.js';

const CLEAR_SCAN_COUNT = 1000;

export const SET_MAX_SCRIPT = `
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

// Stores ARGV[2] only while the generation is still the one read before the
// value was computed: a clear moved it, so that value predates the clear.
export const SET_UNLESS_CLEARED_SCRIPT = `
  local current = redis.call('GET', KEYS[1])

  if (current or '0') ~= ARGV[1] then
    return 0
  end

  redis.call('SET', KEYS[2], ARGV[2])

  return 1
`;

export class KvRedis implements Kv {
	private redis: ExtendedRedis;
	private namespace: string;
	private compression: boolean;
	private compressionMinSize: number;

	constructor(config: Omit<KvConfigRedis, 'type'>) {
		if ('setMax' in config.redis === false) {
			config.redis.defineCommand('setMax', {
				numberOfKeys: 1,
				lua: SET_MAX_SCRIPT,
			});
		}

		if ('setUnlessCleared' in config.redis === false) {
			config.redis.defineCommand('setUnlessCleared', {
				numberOfKeys: 2,
				lua: SET_UNLESS_CLEARED_SCRIPT,
			});
		}

		this.redis = config.redis as ExtendedRedis;
		this.namespace = config.namespace;
		this.compression = config.compression ?? true;
		this.compressionMinSize = config.compressionMinSize ?? 1000;
	}

	async get<T = unknown>(key: string) {
		const value = await this.redis.getBuffer(withNamespace(key, this.namespace));

		if (value === null) {
			return undefined;
		}

		return await this.decodeValue<T>(value);
	}

	private async decodeValue<T>(value: Buffer) {
		let binaryArray = bufferToUint8Array(value);

		if (this.compression === true && isCompressed(binaryArray)) {
			binaryArray = await decompress(binaryArray);
		}

		return <T>deserialize(binaryArray);
	}

	private async encodeValue(value: unknown) {
		if (typeof value === 'number') {
			return value;
		}

		// serialize() infers Uint8Array<ArrayBuffer> (TextEncoder) but compress()
		// returns Uint8Array<ArrayBufferLike>; widen so the reassignment below
		// type-checks under TS 5.9
		let binaryArray: Uint8Array = serialize(value);

		if (
			this.compression === true
			&& binaryArray.byteLength >= this.compressionMinSize
		) {
			binaryArray = await compress(binaryArray);
		}

		return uint8ArrayToBuffer(binaryArray);
	}

	async set<T = unknown>(key: string, value: T) {
		await this.redis.set(
			withNamespace(key, this.namespace),
			await this.encodeValue(value),
		);
	}

	// Outside the `namespace:*` pattern `clear()` removes, so a clear never
	// resets it back to a generation a running read already holds.
	private get generationKey() {
		return `${this.namespace}-generation`;
	}

	// One MGET: the generation is read at the instant the key was found missing.
	async getWithGeneration<T = unknown>(key: string): Promise<CacheRead<T>> {
		const [value, generation] = await this.redis.mgetBuffer(
			withNamespace(key, this.namespace),
			this.generationKey,
		);

		if (value) {
			return { found: true, value: await this.decodeValue<T>(value) };
		}

		return { found: false, generation: Number(generation?.toString() ?? 0) };
	}

	async bumpGeneration() {
		await this.redis.incr(this.generationKey);
	}

	async setUnlessCleared(key: string, value: unknown, generation: number) {
		const wasSet = await this.redis.setUnlessCleared(
			this.generationKey,
			withNamespace(key, this.namespace),
			generation,
			await this.encodeValue(value),
		);

		return wasSet !== 0;
	}

	async delete(key: string) {
		await this.redis.unlink(withNamespace(key, this.namespace));
	}

	async has(key: string) {
		const exists = await this.redis.exists(withNamespace(key, this.namespace));
		return exists !== 0;
	}

	async increment(key: string, amount = 1) {
		return await this.redis.incrby(withNamespace(key, this.namespace), amount);
	}

	async setMax(key: string, value: number) {
		const wasSet = await this.redis.setMax(withNamespace(key, this.namespace), value);
		return wasSet !== 0;
	}

	async clear() {
		// MATCH filters after the walk, so every call pays for COUNT keys of the
		// whole database: ioredis's default of 10 is 100x the round trips.
		const keysStream = this.redis.scanStream({
			match: withNamespace('*', this.namespace),
			count: CLEAR_SCAN_COUNT,
		});

		const pipeline = this.redis.pipeline();

		for await (const keys of keysStream) {
			pipeline.unlink(keys);
		}

		await pipeline.exec();
	}
}
