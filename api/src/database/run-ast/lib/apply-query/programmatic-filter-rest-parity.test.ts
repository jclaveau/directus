/**
 * `ItemsService.readByQuery` takes its filter raw: it never passes through
 * `sanitizeQuery`/`parseFilter`, so `normalizeFilter` is the only thing standing
 * between an extension's filter and the query builder. This file pins the property
 * that matters — for any shape, the SQL the programmatic path emits is the SQL
 * REST would have emitted for the same filter.
 *
 * Divergences found this way, each of which returned wrong rows with no error:
 * - a logical operator under a relational key compiled to a bare `select *`
 * - a multi-key `_or` element had siblings OR-combined instead of ANDed (#325)
 * - a second operator on one field (`{ _gte, _lte }`) was dropped
 */
import { SchemaBuilder } from '@directus/schema-builder';
import { parseFilter } from '@directus/utils';
import knex from 'knex';
import { expect, test, vi } from 'vitest';
import { Client_SQLite3 } from './mock.js';

const aliasFn = vi.fn(() => 'alias1');

vi.doMock('nanoid/non-secure', () => {
	return { customAlphabet: () => aliasFn };
});

const { applyFilter } = await import('./filter/index.js');

const schema = new SchemaBuilder()
	.collection('article', (c) => {
		c.field('id').id();
		c.field('status').string();
		c.field('author').m2o('users');
		c.field('links').o2m('links_list', 'article_id');
	})
	.collection('links_list', (c) => {
		c.field('id').id();
		c.field('article_id').m2o('article');
		c.field('label').string();
	})
	.collection('users', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('email').string();
		c.field('team').m2o('teams');
	})
	.collection('teams', (c) => {
		c.field('id').id();
		c.field('label').string();
	})
	.build();

function sqlFor(filter: any) {
	const db = vi.mocked(knex.default({ client: Client_SQLite3 }));
	const queryBuilder = db.queryBuilder();
	applyFilter(db, schema, queryBuilder, filter, 'article', {}, [], []);
	const raw = queryBuilder.toSQL();
	return `${raw.sql} -- ${JSON.stringify(raw.bindings)}`;
}

const SHAPES: [string, any][] = [
	['logical under a relation', {
		author: { _or: [{ name: { _eq: 'a' } }, { email: { _eq: 'b' } }] },
	}],
	['_and under a relation', {
		author: { _and: [{ name: { _eq: 'a' } }, { email: { _eq: 'b' } }] },
	}],
	['logical two levels down', {
		author: { team: { _or: [{ label: { _eq: 'x' } }] } },
	}],
	['multi-key element in a nested logical', {
		author: { _or: [{ name: { _eq: 'a' }, email: { _eq: 'b' } }] },
	}],
	['logical beside a sibling field', {
		author: { _or: [{ name: { _eq: 'a' } }], email: { _eq: 'b' } },
	}],
	['multi-key _or element', { _or: [{ status: { _eq: 'p' }, id: { _eq: 1 } }] }],
	['plain siblings', { status: { _eq: 'p' }, id: { _eq: 1 } }],
	['relation siblings', { author: { name: { _eq: 'a' }, email: { _eq: 'b' } } }],
	['operator pair on one field', { id: { _gte: 1, _lte: 10 } }],
	['_some', { links: { _some: { label: { _eq: 'a' } } } }],
	['_some with a nested logical', {
		links: { _some: { _or: [{ label: { _eq: 'a' } }] } },
	}],
	['_none', { links: { _none: { label: { _eq: 'a' } } } }],
	['_or with an empty element', { _or: [{}, { status: { _eq: 'p' } }] }],
	['nested _or inside _or', {
		_or: [{ _or: [{ status: { _eq: 'p' }, id: { _eq: 1 } }] }],
	}],
];

test.each(SHAPES)('programmatic SQL matches REST SQL — %s', (_name, raw) => {
	const programmatic = sqlFor(structuredClone(raw));
	const rest = sqlFor(parseFilter(structuredClone(raw), null));

	expect(programmatic).toBe(rest);
});

// A seeded generator, so a failure names a reproducible case rather than a mood.
function makeRandom(seed: number) {
	let state = seed;

	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
}

const SCALARS = [
	['status', 'p'],
	['id', 1],
] as const;

const RELATION_SCALARS = [
	['name', 'a'],
	['email', 'b'],
] as const;

function randomFilter(random: () => number, depth: number): any {
	const roll = random();

	if (depth <= 0 || roll < 0.35) {
		const [field, value] = SCALARS[Math.floor(random() * SCALARS.length)]!;
		return { [field]: { _eq: value } };
	}

	if (roll < 0.5) {
		const index = Math.floor(random() * RELATION_SCALARS.length);
		const [field, value] = RELATION_SCALARS[index]!;
		return { author: { [field]: { _eq: value } } };
	}

	if (roll < 0.6) {
		return { id: { _gte: 1, _lte: 10 } };
	}

	if (roll < 0.7) {
		return { author: { team: randomFilter(random, depth - 1) } };
	}

	if (roll < 0.8) {
		return { links: { _some: randomFilter(random, depth - 1) } };
	}

	const operator = random() < 0.5
		? '_and'
		: '_or';

	const width = 1 + Math.floor(random() * 2);

	// Under a relational key half the time — the shape REST can never produce,
	// and the one that used to vanish.
	const branch = {
		[operator]: Array.from({ length: width }, () => randomFilter(random, depth - 1)),
	};

	return random() < 0.5
		? branch
		: { author: branch };
}

test('programmatic SQL matches REST SQL over generated filters', () => {
	const random = makeRandom(20260805);
	const mismatches: string[] = [];

	for (let i = 0; i < 400; i++) {
		const raw = randomFilter(random, 3);

		let programmatic: string;
		let rest: string;

		try {
			programmatic = sqlFor(structuredClone(raw));
			rest = sqlFor(parseFilter(structuredClone(raw), null));
		}
		catch {
			// A shape the query builder rejects outright (e.g. `_some` under a
			// non-alias) is not what this test is about.
			continue;
		}

		if (programmatic !== rest) {
			mismatches.push(
				`${JSON.stringify(raw)}\n  prog: ${programmatic}\n  rest: ${rest}`,
			);
		}
	}

	expect(mismatches).toEqual([]);
});
