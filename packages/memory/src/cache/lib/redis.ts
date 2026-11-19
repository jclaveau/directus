import type { KvRedis } from '../../kv/index.js';
import { createKv } from '../../kv/index.js';
import type { CacheConfigRedis } from '../index.js';
import type { Cache } from '../types/class.js';

export class CacheRedis implements Cache {
	private store: KvRedis;

	constructor(config: Omit<CacheConfigRedis, 'type'>) {
		this.store = createKv({ type: 'redis', ...config }) as KvRedis;
	}

	async get<T = unknown>(key: string) {
		return await this.store.get<T>(key);
	}

	async set<T = unknown>(key: string, value: T) {
		return await this.store.set(key, value);
	}

	async delete(key: string) {
		return await this.store.delete(key);
	}

	async has(key: string) {
		return await this.store.has(key);
	}

	// Before the removal: a write checked against the old generation lands
	// before it and is removed with the rest, a later one is refused.
	async clear(): Promise<void> {
		await this.store.bumpGeneration();
		await this.store.clear();
	}

	async getWithGeneration<T = unknown>(key: string) {
		return await this.store.getWithGeneration<T>(key);
	}

	async setUnlessCleared(key: string, value: unknown, generation: number) {
		return await this.store.setUnlessCleared(key, value, generation);
	}
}
