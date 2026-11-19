/**
 * What `getWithGeneration` read: the cached value, or the generation a value
 * computed for the missing key has to be stored under
 */
export type CacheRead<T> =
	| { found: true; value: T }
	| { found: false; generation: number };

export interface Cache {
	/**
	 * Get the cached value by key. Returns undefined if the key doesn't exist in the cache
	 *
	 * @param key Key to retrieve from the cache
	 * @returns Cached value, or undefined if key doesn't exist
	 */
	get<T = unknown>(key: string): Promise<T | undefined>;

	/**
	 * Save the given value to the cache
	 *
	 * @param key Key to save in the cache
	 * @param value Value to save to the cache. Can be any JavaScript primitive, plain object, or array
	 */
	set<T = unknown>(key: string, value: T): Promise<void>;

	/**
	 * Remove the given key from the cache
	 *
	 * @param key Key to remove from the cache
	 */
	delete(key: string): Promise<void>;

	/**
	 * Check if a given key exists in the cache
	 *
	 * @param key Key to check
	 */
	has(key: string): Promise<boolean>;

	/**
	 * Remove all keys from the cache
	 */
	clear(): Promise<void>;

	/**
	 * Get the cached value by key or, when it is missing, the number of clears so
	 * far, to hand back to `setUnlessCleared`
	 *
	 * @param key Key to retrieve from the cache
	 */
	getWithGeneration<T = unknown>(key: string): Promise<CacheRead<T>>;

	/**
	 * Save the given value unless a clear came since `generation` was read
	 *
	 * @returns Whether the value was saved
	 */
	setUnlessCleared(
		key: string,
		value: unknown,
		generation: number,
	): Promise<boolean>;
}
