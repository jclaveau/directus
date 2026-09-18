import { useEnv } from '@directus/env';
import { parse as parseBytesConfiguration } from 'bytes';
import type { ServerResponse } from 'node:http';
import { printableScopedCacheTags } from './printable-scoped-cache-tags.js';

const SEPARATOR = ', ';

// A batch write pins one tag per row, and node's fetch refuses a response past
// 16kb of headers (UND_ERR_HEADERS_OVERFLOW): the caller then sees a failed
// request over a write that went through. Whole tags are kept up to
// CACHE_TAGS_HEADER_MAX_SIZE, the rest counted in a `<name>-omitted` sibling.
export function setScopedCacheTagsHeader(
	res: Pick<ServerResponse, 'setHeader'>,
	name: string,
	serialized: string,
): void {
	if (serialized === '') {
		return;
	}

	const env = useEnv();
	const maxSize = parseBytesConfiguration(String(env['CACHE_TAGS_HEADER_MAX_SIZE']));
	const tags = serialized.split(SEPARATOR).map(printableScopedCacheTags);

	if (!maxSize) {
		res.setHeader(name, tags.join(SEPARATOR));
		return;
	}

	let kept = 0;
	let size = 0;

	// Printable output is pure ASCII, so a length is a byte count.
	for (const tag of tags) {
		let next = size + tag.length;

		if (kept > 0) {
			next += SEPARATOR.length;
		}

		if (next > maxSize) {
			break;
		}

		size = next;
		kept += 1;
	}

	if (kept > 0) {
		res.setHeader(name, tags.slice(0, kept).join(SEPARATOR));
	}

	if (kept < tags.length) {
		res.setHeader(`${name}-omitted`, String(tags.length - kept));
	}
}
