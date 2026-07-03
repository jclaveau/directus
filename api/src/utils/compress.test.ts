import { afterEach, describe, expect, test, vi } from 'vitest';

const env: Record<string, any> = { CACHE_COMPRESSION_ENABLED: true };

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const { compress, decompress } = await import('./compress.js');

afterEach(() => {
	env['CACHE_COMPRESSION_ENABLED'] = true;
});

describe('cache compress / decompress', () => {
	const value = { data: [{ id: 1, color: '#fff' }, { id: 2, color: '#000' }] };

	test('compresses to a Buffer and round-trips by default', async () => {
		const compressed = await compress(value);

		expect(Buffer.isBuffer(compressed)).toBe(true);
		expect(await decompress(compressed)).toEqual(value);
	});

	test('CACHE_COMPRESSION_ENABLED=false stores the raw value (no Buffer)', async () => {
		env['CACHE_COMPRESSION_ENABLED'] = false;

		const stored = await compress(value);

		expect(Buffer.isBuffer(stored)).toBe(false);
		expect(stored).toEqual(value);
	});

	test('decompress passes a non-Buffer value through (survives a toggle)', async () => {
		expect(await decompress(value)).toEqual(value);
	});

	test('falsy in → falsy out both ways', async () => {
		expect(await compress(null as any)).toBeNull();
		expect(await decompress(null as any)).toBeNull();
	});
});
