import type Keyv from 'keyv';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { dropCacheEntries } from './cache-drop.js';

const unlink = vi.fn();
const del = vi.fn();

function redisBacked(): Keyv {
	return {
		store: {
			namespace: 'scalabus_response',
			createKeyPrefix: (key: string, namespace?: string) => {
				return `${namespace}::${namespace}:${key}`;
			},
			client: { unlink },
		},
		delete: del,
	} as unknown as Keyv;
}

function memoryBacked(): Keyv {
	return { store: new Map(), delete: del } as unknown as Keyv;
}

beforeEach(() => {
	vi.restoreAllMocks();
	unlink.mockReset();
	del.mockReset();
	unlink.mockResolvedValue(0);
	del.mockResolvedValue(true);
});

describe('dropCacheEntries', () => {
	test('drops every key in ONE command, spelled by the store', async () => {
		unlink.mockResolvedValue(2);

		const dropped = await dropCacheEntries(redisBacked(), ['a', 'b']);

		// The whole point: one command carrying the list, not one command per key.
		// A per-key loop satisfies every other assertion here at N times the cost.
		expect(unlink).toHaveBeenCalledTimes(1);

		expect(unlink).toHaveBeenCalledWith([
			'scalabus_response::scalabus_response:a',
			'scalabus_response::scalabus_response:b',
		]);

		expect(del).not.toHaveBeenCalled();
		expect(dropped).toBe(2);
	});

	test('reports what was there, not what was asked for', async () => {
		unlink.mockResolvedValue(1);

		expect(await dropCacheEntries(redisBacked(), ['a', 'b', 'c'])).toBe(1);
	});

	test('falls back to one delete per key on a store that cannot bulk', async () => {
		del.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

		const dropped = await dropCacheEntries(memoryBacked(), ['a', 'b']);

		expect(del.mock.calls).toEqual([['a'], ['b']]);

		// The fallback has no count of its own, so it counts the answers — and a key
		// that was not there is not an eviction.
		expect(dropped).toBe(1);
	});

	test('touches nothing when there is nothing to drop', async () => {
		expect(await dropCacheEntries(redisBacked(), [])).toBe(0);

		// `UNLINK` with no key is an error, and a purge reaches here with an empty
		// list whenever a tag named only sidecars.
		expect(unlink).not.toHaveBeenCalled();
		expect(del).not.toHaveBeenCalled();
	});
});
