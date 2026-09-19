import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import {
	scopedCacheOwnershipInjections,
	stripScopedCacheOwnershipInjections,
	withScopedCacheOwnershipInjections,
	type ScopedCacheOwnershipInjection,
} from './ownership-injection.js';

// member -> team -> lead (member) -> ... : every hop owns a scope field, so the
// ownership pin nests the chain's keys behind whatever the caller asked for.
const schema = new SchemaBuilder()
	.collection('member', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('team').m2o('team');
	})
	.collection('team', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('lead').m2o('member');
	})
	.build();

schema.collections['member']!.scopedCacheFields = ['team'];
schema.collections['team']!.scopedCacheFields = ['lead'];

const injectionsFor = (fields: string[]): ScopedCacheOwnershipInjection[] => {
	return scopedCacheOwnershipInjections(schema, 'member', fields);
};

describe('scopedCacheOwnershipInjections', () => {
	it('aliases the first hop the caller names as a scalar', () => {
		// `*` names `team` as a column: the whole chain nests under its alias.
		expect(injectionsFor(['*'])).toEqual([
			{ path: 'team.id', aliasedPath: '__scoped_cache_team.id' },
			{ path: 'team.lead.id', aliasedPath: '__scoped_cache_team.lead.id' },
		]);
	});

	it('aliases below what the caller already nests', () => {
		expect(injectionsFor(['team.name'])).toEqual([
			{ path: 'team.lead.id', aliasedPath: 'team.__scoped_cache_lead.id' },
		]);

		expect(injectionsFor(['*.*'])).toEqual([
			{ path: 'team.lead.id', aliasedPath: 'team.__scoped_cache_lead.id' },
		]);
	});

	it('injects nothing past a depth wildcard nesting the whole chain', () => {
		expect(injectionsFor(['*.*.*'])).toEqual([]);
	});
});

describe('withScopedCacheOwnershipInjections', () => {
	it('declares a root alias for a hop aliased at the root', () => {
		expect(withScopedCacheOwnershipInjections(
			{ fields: ['*'], alias: { me: 'name' } },
			injectionsFor(['*']),
		)).toEqual({
			fields: ['*', '__scoped_cache_team.id', '__scoped_cache_team.lead.id'],
			alias: { me: 'name', __scoped_cache_team: 'team' },
			deep: {},
		});
	});

	it('declares a nested alias on the parent hop\'s deep query', () => {
		// The caller's own deep query at that hop is kept, the alias added to it.
		expect(withScopedCacheOwnershipInjections(
			{ fields: ['team.name'], deep: { team: { _filter: { name: { _eq: 't' } } } } },
			injectionsFor(['team.name']),
		)).toEqual({
			fields: ['team.name', 'team.__scoped_cache_lead.id'],
			alias: {},
			deep: {
				team: {
					_filter: { name: { _eq: 't' } },
					_alias: { __scoped_cache_lead: 'lead' },
				},
			},
		});
	});

	it('requests every field when the caller named none', () => {
		expect(withScopedCacheOwnershipInjections({}, injectionsFor([])).fields)
			.toEqual(['*', '__scoped_cache_team.id', '__scoped_cache_team.lead.id']);
	});

	it('returns the query as is with nothing to inject', () => {
		const query = { fields: ['*.*.*'] };

		expect(withScopedCacheOwnershipInjections(query, [])).toBe(query);
	});
});

describe('stripScopedCacheOwnershipInjections', () => {
	const stripped = (fields: string[], record: Record<string, unknown>) => {
		const records = [record];

		stripScopedCacheOwnershipInjections(records, injectionsFor(fields));

		return records[0];
	};

	it(oneLine`
		leaves the column the caller asked for as the row carried it, whatever the
		injected hop came back as
	`, () => {
		// The un-injected read answers the foreign key; a nested row, a hop the
		// case withheld and a null key must all leave it so.
		expect(stripped(['*'], {
			id: 1,
			team: 5,
			__scoped_cache_team: { id: 5, lead: { id: 9 } },
		})).toEqual({ id: 1, team: 5 });

		expect(stripped(['*'], { id: 1, team: 5, __scoped_cache_team: null }))
			.toEqual({ id: 1, team: 5 });

		expect(stripped(['*'], { id: 1, team: null, __scoped_cache_team: null }))
			.toEqual({ id: 1, team: null });
	});

	it('removes an injected hop the caller never named', () => {
		expect(stripped(['id'], { id: 1, __scoped_cache_team: { id: 5 } }))
			.toEqual({ id: 1 });
	});

	it('descends what the caller nests, taking out only the hop under it', () => {
		expect(stripped(['team.name'], {
			id: 1,
			team: { name: 't', lead: 9, __scoped_cache_lead: { id: 9 } },
		})).toEqual({ id: 1, team: { name: 't', lead: 9 } });
	});

	it('leaves a prefix the response answered with null', () => {
		expect(stripped(['team.name'], { id: 1, team: null }))
			.toEqual({ id: 1, team: null });
	});
});
