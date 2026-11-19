import { createKv, type Kv } from '../../kv/index.js';
import type { Cache } from '../types/class.js';
import type { CacheConfigLocal } from '../types/config.js';

export class CacheLocal implements Cache {
	private store: Kv;
	private generation = 0;

	constructor(config: Omit<CacheConfigLocal, 'type'>) {
		this.store = createKv({ type: 'local', ...config });
	}

	async get<T = unknown>(key: string) {
		return await this.store.get<T>(key);
	}

	async set(key: string, value: unknown) {
		return await this.store.set(key, value);
	}

	async delete(key: string) {
		await this.store.delete(key);
	}

	async has(key: string) {
		return await this.store.has(key);
	}

	async clear(): Promise<void> {
		this.generation++;
		await this.store.clear();
	}

	async readGeneration() {
		return this.generation;
	}

	async setUnlessCleared(key: string, value: unknown, generation: number) {
		if (generation !== this.generation) {
			return false;
		}

		await this.store.set(key, value);

		return true;
	}
}
