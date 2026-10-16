import { expect, it } from 'vitest';
import { clearCache } from '../src/rest/commands/utils/cache.js';

it('clearCache sends each target as its own `targets` parameter', () => {
	expect(clearCache(['system', 'permissions'])()).toEqual({
		method: 'POST',
		path: '/utils/cache/clear?targets=system&targets=permissions',
	});
});

it('clearCache with no target sends no query, clearing the response cache', () => {
	expect(clearCache()()).toEqual({
		method: 'POST',
		path: '/utils/cache/clear',
	});
});
