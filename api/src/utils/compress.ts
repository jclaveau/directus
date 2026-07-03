import { useEnv } from '@directus/env';
import { compress as compressSnappy, uncompress as uncompressSnappy } from 'snappy';
import { compress as compressJSON, decompress as decompressJSON } from '@directus/utils';

type CacheValue = Record<string, any> | Record<string, any>[];

export async function compress(raw: CacheValue): Promise<Buffer | CacheValue> {
	if (!raw) {
		return raw;
	}

	// `CACHE_COMPRESSION_ENABLED=false` stores the value uncompressed so it is directly readable
	// in the cache store (a dev/debug aid). On by default → prod stays snappy+json-compressed.
	if (useEnv()['CACHE_COMPRESSION_ENABLED'] === false) {
		return raw;
	}

	return await compressSnappy(compressJSON(raw));
}

export async function decompress(compressed: Buffer | CacheValue): Promise<any> {
	if (!compressed) {
		return compressed;
	}

	// An uncompressed entry (compression off, or one cached before the toggle) round-trips through
	// the store as a plain value, not a Buffer — only a real Buffer went through snappy. Sniffing
	// the type (rather than the env) keeps mixed-state reads correct across a toggle.
	if (!Buffer.isBuffer(compressed)) {
		return compressed;
	}

	return decompressJSON((await uncompressSnappy(compressed, { asBuffer: false })) as string);
}
