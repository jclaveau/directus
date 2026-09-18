import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { setScopedCacheTagsHeader } from './scoped-cache-tags-header.js';

const env: Record<string, unknown> = {};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const NAME = 'X-Scoped-Cache-Tags';

function makeRes() {
	return { setHeader: vi.fn() };
}

beforeEach(() => {
	delete env['CACHE_TAGS_HEADER_MAX_SIZE'];
});

describe('setScopedCacheTagsHeader', () => {
	test('emits every tag when they fit the budget', () => {
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '1kb';
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, ['a:b=1', 'a:b=2']);

		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenCalledWith(NAME, 'a:b=1, a:b=2');
	});

	test('keeps whole tags within the budget and counts the rest', () => {
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '12b';
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, ['a:b=1', 'a:b=2', 'a:b=3', 'a:b=4']);

		expect(res.setHeader).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenCalledWith(NAME, 'a:b=1, a:b=2');
		expect(res.setHeader).toHaveBeenCalledWith(`${NAME}-omitted`, '2');
	});

	test('a budget exactly met keeps the last tag', () => {
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '5b';
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, ['a:b=1', 'a:b=2']);

		expect(res.setHeader).toHaveBeenCalledWith(NAME, 'a:b=1');
		expect(res.setHeader).toHaveBeenCalledWith(`${NAME}-omitted`, '1');
	});

	test('skips the tags header when not even the first tag fits', () => {
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '4b';
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, ['a:b=1', 'a:b=2']);

		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenCalledWith(`${NAME}-omitted`, '2');
	});

	test('budgets the percent-encoded size, not the raw one', () => {
		// `a:b=é` is 5 chars raw, 10 bytes once `é` reads `%C3%A9`.
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '9b';
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, ['a:b=é', 'a:b=1']);

		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenCalledWith(`${NAME}-omitted`, '2');
	});

	test.each([
		['unset', undefined],
		['unparseable', 'lots'],
		['zero', '0'],
	])('emits everything when the budget is %s', (_, value) => {
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = value;
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, ['a:b=1', 'a:b=é']);

		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenCalledWith(NAME, 'a:b=1, a:b=%C3%A9');
	});

	test('emits nothing for no tags', () => {
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, []);

		expect(res.setHeader).not.toHaveBeenCalled();
	});

	// The label is the Redis key, so a value may hold the separator: it is one
	// tag, kept or omitted whole, never cut at the separator inside it.
	test('keeps a tag whose value holds the separator whole', () => {
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '5b';
		const res = makeRes();

		setScopedCacheTagsHeader(res, NAME, ['a:b=x, y', 'c']);

		expect(res.setHeader).toHaveBeenCalledTimes(1);
		expect(res.setHeader).toHaveBeenCalledWith(`${NAME}-omitted`, '2');
	});

	test('a clamped header never makes res.setHeader throw', () => {
		env['CACHE_TAGS_HEADER_MAX_SIZE'] = '4kb';
		const res = new ServerResponse(new IncomingMessage(new Socket()));

		const labels = Array.from({ length: 400 }, (_, i) => {
			return `t:id=${String(i).padStart(36, '0')}`;
		});

		expect(() => setScopedCacheTagsHeader(res, NAME, labels)).not.toThrow();
		expect(String(res.getHeader(NAME)).length).toBeLessThanOrEqual(4 * 1024);
		expect(res.getHeader(`${NAME}-omitted`)).toBe('305');
	});
});
