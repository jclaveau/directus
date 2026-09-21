import { useEnv } from '@directus/env';
import { compress as compressSnappy, uncompress as uncompressSnappy } from 'snappy';
import { decompress as decompressJSON } from '@directus/utils/values';

type CacheValue = Record<string, any> | Record<string, any>[];

export async function compress(raw: CacheValue): Promise<Buffer | CacheValue> {
	if (!raw) {
		return raw;
	}

	// `CACHE_COMPRESSION_ENABLED=false` stores the value uncompressed so it is
	// directly readable in the cache store (a dev/debug aid). On by default → prod
	// stays snappy-compressed.
	if (useEnv()['CACHE_COMPRESSION_ENABLED'] === false) {
		return raw;
	}

	// Snappy over the JSON text itself. The jsonpack-style tokenizer that used to
	// sit in between (`@directus/utils` `compress`) cost a 1.4 MB fill 160–255 ms
	// and every HIT on it ~105 ms, and stored MORE: its base-36 tokens destroy the
	// repetition snappy compresses on, 906 KB where snappy alone stores 490 KB.
	return await compressSnappy(JSON.stringify(raw));
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

	const text = (await uncompressSnappy(compressed, { asBuffer: false })) as string;

	// An entry compressed before the tokenizer went is still tokenized under its
	// snappy, and stays readable for the deploy window in which both shapes
	// coexist. Its text is not JSON, so the parse refuses it on its first bytes.
	try {
		return JSON.parse(text);
	}
	catch {
		return decompressJSON(text);
	}
}
