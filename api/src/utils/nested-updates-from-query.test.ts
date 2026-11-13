import { InvalidQueryError } from '@directus/errors';
import { expect, test } from 'vitest';
import { nestedUpdatesFromQuery } from './nested-updates-from-query.js';

test('an absent nestedUpdates is left unset', () => {
	expect(nestedUpdatesFromQuery({})).toBe(undefined);
});

test('a known nestedUpdates is returned as is', () => {
	expect(nestedUpdatesFromQuery({ nestedUpdates: 'skip' })).toBe('skip');
});

test('an unknown nestedUpdates is refused', () => {
	expect(() => nestedUpdatesFromQuery({ nestedUpdates: 'ignore' }))
		.toThrowError(new InvalidQueryError({
			reason: '"nestedUpdates" must be one of apply, refuse, skip',
		}));
});

test('a repeated nestedUpdates is refused', () => {
	expect(() => {
		nestedUpdatesFromQuery({ nestedUpdates: ['refuse', 'skip'] });
	}).toThrowError(new InvalidQueryError({
		reason: '"nestedUpdates" must be one of apply, refuse, skip',
	}));
});
