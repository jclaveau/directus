import { SchemaBuilder } from '@directus/schema-builder';
import type { Filter } from '@directus/types';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Isolate from the real cache module (redis/bus) and force scoped mode on, so readByQuery runs its
// tag-accumulation branch. runAst is the only DB-touching call in the read path; stub it out.
vi.mock('../cache.js', () => ({
	getCache: () => ({ cache: null }),
}));

// The owning modules, not the barrel: the collaborator imports its siblings
// directly, so a stand-in on the re-export would leave the real ones in its graph.
vi.mock('../scoped-cache/purge.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache/purge.js')>()),
		purgeScopedCache: vi.fn(),
	};
});

vi.mock('../scoped-cache/config.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache/config.js')>()),
		scopedCachePurgeEnabled: vi.fn(() => true),
	};
});

vi.mock('../database/run-ast/run-ast.js', () => ({ runAst: vi.fn(async () => []) }));

vi.mock('../scoped-cache/tags.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache/tags.js')>()),
		scopedCacheMaxPinsPerCollection: vi.fn(() => 250),
	};
});

vi.mock('../permissions/lib/fetch-policies.js', () => {
	return { fetchPolicies: vi.fn(async () => ['policy']) };
});

vi.mock('../permissions/lib/fetch-permissions.js', () => {
	return { fetchPermissions: vi.fn(async () => []) };
});

import {
	scopedCachePurgeEnabled,
	serializeScopedCacheTags,
} from '../scoped-cache.js';
import { runAst } from '../database/run-ast/run-ast.js';
import { fetchPermissions } from '../permissions/lib/fetch-permissions.js';
import { scopedCacheMaxPinsPerCollection } from '../scoped-cache/tags.js';
import { readMeta } from '../utils/read-meta.js';
import { ItemsService } from './items.js';

const schema = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('title').string();
		c.field('author').m2o('users');
	})
	.collection('users', (c) => {
		c.field('id').id();
		c.field('name').string();
	})
	.build();

const db = knex({ client: MockClient });

describe('readByQuery scoped cache tag accumulation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(true);
	});

	test('tags the root collection AND every collection reached through relations', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(
			(readMeta(result)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('tags only the root collection for a non-relational read', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*'] }, { emitEvents: false });

		expect(
			(readMeta(result)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles']);
	});

	test('tags are bounded per read — they do not accumulate across reads on one instance', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const shallow = await service.readByQuery({ fields: ['*'] }, { emitEvents: false });
		const deep = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		// Each result carries only its own query's tags — the earlier read is not polluted by the later.
		expect(
			(readMeta(shallow)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles']);

		expect(
			(readMeta(deep)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('readOne carries the read tags onto the single returned item', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });
		vi.mocked(runAst).mockResolvedValueOnce([{ id: 1, title: 't' }]);

		const one = await service.readOne(1, { fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(
			(readMeta(one)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('readSingleton carries the read tags onto the returned record', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });
		vi.mocked(runAst).mockResolvedValueOnce([{ id: 1, title: 't' }]);

		const record = await service.readSingleton({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(
			(readMeta(record)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('readSingleton carries the read tags onto the synthesized defaults when empty', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });
		vi.mocked(runAst).mockResolvedValueOnce([]); // no row → readSingleton builds a defaults object

		const defaults = await service.readSingleton({ fields: ['*'] }, { emitEvents: false });

		expect(
			(readMeta(defaults)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles']);
	});

	test('emits empty tags (but still a meta rider) when scoped purge is disabled', async () => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(false);
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(readMeta(result)?.scopedCacheTags.length).toBe(0);
	});
});

// The write-side capture ran behind a "no scope fields declared" early return until
// the key axis made it run for every mutation, so it now meets collections absent
// from the schema. Every mutation reaching it dereferences that collection first, so
// only a direct call gets here today — the guard is what keeps a caller that stops
// doing so from throwing on `.primary` of undefined.
describe(oneLine`
	the write-side capture on a collection the schema does not know
`, () => {
	beforeEach(() => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(true);
	});

	test(oneLine`
		resolves no tag rather than throwing, leaving the bare collection tag
	`, async () => {
		const service = new ItemsService('ghost', {
			knex: db,
			schema,
			accountability: null,
		});

		expect(await service.scopedCache.capture([1])).toEqual({
			tags: [],
			rows: [],
		});
	});

	test('resolves the key slice on a collection it does know', async () => {
		const service = new ItemsService('articles', {
			knex: db,
			schema,
			accountability: null,
		});

		expect(await service.scopedCache.capture([1])).toEqual({
			tags: [
				{ collection: 'articles', field: 'id', value: 1, type: 'integer' },
			],
			rows: [
				{
					key: 1,
					row: null,
					fingerprint: {
						collection: 'articles',
						pinnedScope: { id: ['1'] },
						viewFields: [],
					},
				},
			],
		});
	});
});

// The tags a read carries once the row-dependent pins and the AST-only plan meet.
// Each case feeds the rows runAst would return — the pinners read parent keys off
// them — and asserts the serialized tag list, so a pin, a slice and a bare tag are
// told apart by the exact string a purge matches against.
describe('read tags at the merge', () => {
	// Cloned: the ownership strip collapses the fed rows in place, and a fixture
	// two cases share must reach the second one intact.
	const feed = (rows: Record<string, unknown>[]): void => {
		vi.mocked(runAst).mockImplementationOnce(async (_ast, _schema, _acc, opts) => {
			const fresh = structuredClone(rows);
			opts?.onRowsWithTemporaryFields?.(fresh);
			return fresh;
		});
	};

	const tagsOf = async (
		service: ItemsService,
		query: Parameters<ItemsService['readByQuery']>[0],
	): Promise<string[]> => {
		const result = await service.readByQuery(query, { emitEvents: false });

		return serializeScopedCacheTags(readMeta(result)?.scopedCacheTags ?? [])
			.split(', ')
			.sort();
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(true);
	});

	describe('an injected ownership ancestor a filter hops through unkeyed', () => {
		const ownership = new SchemaBuilder()
			.collection('course', (c) => {
				c.field('id').id();
				c.field('enrollment').m2o('enrollment');
			})
			.collection('enrollment', (c) => {
				c.field('id').id();
				c.field('status').string();
				c.field('student').m2o('student');
			})
			.collection('student', (c) => {
				c.field('id').id();
				c.field('user').string();
			})
			.build();

		ownership.collections['course']!.scopedCacheFields = ['enrollment'];
		ownership.collections['enrollment']!.scopedCacheFields = ['student'];
		ownership.collections['student']!.scopedCacheFields = ['user'];

		// As run-ast returns them: the injected chain under its alias, beside the
		// foreign key `*` asked for.
		const rows = [{
			id: 1,
			enrollment: 10,
			__scoped_cache_enrollment: { id: 10, student: { id: 100 } },
		}];

		test(oneLine`
			stays bare: the filter reads enrollment rows the injected pin never named
		`, async () => {
			const service = new ItemsService('course', {
				knex: db,
				schema: ownership,
				accountability: null,
			});

			feed(rows);

			expect(await tagsOf(service, {
				fields: ['*'],
				filter: { enrollment: { status: { _eq: 'active' } } },
			})).toEqual(['course', 'enrollment', 'student:id=100']);
		});

		test('is injected only below what a depth wildcard already nests', () => {
			const service = new ItemsService('course', {
				knex: db,
				schema: ownership,
				accountability: null,
			});

			expect(service.scopedCache.ownershipInjections({ fields: ['*'] }))
				.toEqual([
					{
						path: 'enrollment.id',
						aliasedPath: '__scoped_cache_enrollment.id',
					},
					{
						path: 'enrollment.student.id',
						aliasedPath: '__scoped_cache_enrollment.student.id',
					},
				]);

			expect(service.scopedCache.ownershipInjections({ fields: ['*.*'] }))
				.toEqual([{
					path: 'enrollment.student.id',
					aliasedPath: 'enrollment.__scoped_cache_student.id',
				}]);

			expect(service.scopedCache.ownershipInjections({ fields: ['*.*.*'] }))
				.toEqual([]);
		});

		test('stays nested in the response a depth wildcard asked for', async () => {
			const service = new ItemsService('course', {
				knex: db,
				schema: ownership,
				accountability: null,
			});

			// `*.*` nests enrollment itself, so only the student is injected, under
			// the enrollment row the caller asked for.
			feed([{
				id: 1,
				enrollment: { id: 10, student: 100, __scoped_cache_student: { id: 100 } },
			}]);

			const result = await service.readByQuery(
				{ fields: ['*.*'] },
				{ emitEvents: false },
			);

			expect(result).toEqual([{ id: 1, enrollment: { id: 10, student: 100 } }]);
		});

		test('unfiltered, it carries the key pin the injection was for', async () => {
			const service = new ItemsService('course', {
				knex: db,
				schema: ownership,
				accountability: null,
			});

			feed(rows);

			expect(await tagsOf(service, { fields: ['*'] }))
				.toEqual(['course', 'enrollment:id=10', 'student:id=100']);
		});
	});

	describe('one collection nested through an M2O path AND an O2M path', () => {
		const featured = new SchemaBuilder()
			.collection('article', (c) => {
				c.field('id').id();
				c.field('featured_comment').m2o('comment');
				c.field('comments').o2m('comment', 'article');
			})
			.collection('comment', (c) => {
				c.field('id').id();
				c.field('body').string();
				c.field('article').m2o('article');
			})
			.build();

		featured.collections['comment']!.scopedCacheFields = ['article'];

		test(oneLine`
			is bare: the reverse-fk pin names only the rows the O2M path nested
		`, async () => {
			const service = new ItemsService('article', {
				knex: db,
				schema: featured,
				accountability: null,
			});

			feed([{
				id: 1,
				featured_comment: { id: 9, body: 'x', article: 2 },
				comments: [{ id: 5, body: 'y', article: 1 }],
			}]);

			expect(await tagsOf(service, {
				fields: ['featured_comment.body', 'comments.body'],
			})).toEqual(['article', 'comment']);
		});

		test(oneLine`
			nested through the O2M path alone, it carries the reverse-fk pin
		`, async () => {
			const service = new ItemsService('article', {
				knex: db,
				schema: featured,
				accountability: null,
			});

			feed([{ id: 1, comments: [{ id: 5, body: 'y', article: 1 }] }]);

			expect(await tagsOf(service, { fields: ['comments.body'] }))
				.toEqual(['article', 'comment:article=1']);
		});
	});

	describe('a collection two reverse fks reach and disagree on', () => {
		const grading = new SchemaBuilder()
			.collection('enrollment', (c) => {
				c.field('id').id();
				c.field('pinned_note').m2o('note');
				c.field('discipline').m2o('discipline');
				c.field('unit').m2o('unit');
			})
			.collection('discipline', (c) => {
				c.field('id').id();
				c.field('notes').o2m('note', 'discipline');
			})
			.collection('unit', (c) => {
				c.field('id').id();
				c.field('notes').o2m('note', 'unit');
			})
			.collection('note', (c) => {
				c.field('id').id();
				c.field('body').string();
				c.field('discipline').m2o('discipline');
				c.field('unit').m2o('unit');
			})
			.build();

		grading.collections['note']!.scopedCacheFields = ['discipline', 'unit'];

		const service = () => {
			return new ItemsService('enrollment', {
				knex: db,
				schema: grading,
				accountability: null,
			});
		};

		test(oneLine`
			keyed by a filter through all three paths, it is bare: the key one path
			binds names nothing the reverse fks nest
		`, async () => {
			// Only the field asked for: the paths a filter alone crosses nest no row.
			feed([{ id: 1 }]);

			const tags = await tagsOf(service(), {
				fields: ['id'],
				filter: {
					_and: [
						{ pinned_note: { id: { _eq: 7 } } },
						{ discipline: { notes: { id: { _eq: 7 } } } },
						{ unit: { notes: { id: { _eq: 7 } } } },
					],
				},
			});

			expect(tags).toContain('note');
			expect(tags.filter((tag) => tag.startsWith('note:'))).toEqual([]);
		});

		test(oneLine`
			nested through both, each node's own filter slices the rows it returns,
			whichever fk reached them
		`, async () => {
			feed([{
				id: 1,
				discipline: {
					id: 1,
					notes: [{ id: 7, body: 'a', discipline: 1, unit: 2 }],
				},
				unit: {
					id: 2,
					notes: [{ id: 8, body: 'b', discipline: 3, unit: 2 }],
				},
			}]);

			const tags = await tagsOf(service(), {
				fields: ['discipline.notes.body', 'unit.notes.body'],
				deep: {
					discipline: { notes: { _filter: { discipline: { _eq: 1 } } } },
					unit: { notes: { _filter: { unit: { _eq: 2 } } } },
				},
			});

			expect(tags).toContain('note:discipline=1');
			expect(tags).toContain('note:unit=2');
			expect(tags).not.toContain('note');
		});

		test(oneLine`
			nested through both and filtered on beyond them, it is bare: the nodes'
			slices name only the rows they returned
		`, async () => {
			feed([{
				id: 1,
				discipline: {
					id: 1,
					notes: [{ id: 7, body: 'a', discipline: 1, unit: 2 }],
				},
				unit: {
					id: 2,
					notes: [{ id: 8, body: 'b', discipline: 3, unit: 2 }],
				},
			}]);

			const tags = await tagsOf(service(), {
				fields: ['discipline.notes.body', 'unit.notes.body'],
				filter: { discipline: { notes: { body: { _eq: 'a' } } } },
				deep: {
					discipline: { notes: { _filter: { discipline: { _eq: 1 } } } },
					unit: { notes: { _filter: { unit: { _eq: 2 } } } },
				},
			});

			expect(tags).toContain('note');
			expect(tags.filter((tag) => tag.startsWith('note:'))).toEqual([]);
		});

		test(oneLine`
			nested through both with a node nothing bounds, it is bare
		`, async () => {
			feed([{
				id: 1,
				discipline: {
					id: 1,
					notes: [{ id: 7, body: 'a', discipline: 1, unit: 2 }],
				},
				unit: {
					id: 2,
					notes: [{ id: 8, body: 'b', discipline: 3, unit: 2 }],
				},
			}]);

			const tags = await tagsOf(service(), {
				fields: ['discipline.notes.body', 'unit.notes.body'],
				deep: { unit: { notes: { _filter: { unit: { _eq: 2 } } } } },
			});

			expect(tags).toContain('note');
			expect(tags.filter((tag) => tag.startsWith('note:'))).toEqual([]);
		});
	});

	describe('a to-many reached over a foreign key outside its scope', () => {
		const reviewing = new SchemaBuilder()
			.collection('owner', (c) => {
				c.field('id').id();
				c.field('notes').o2m('note', 'student');
				c.field('reviewed_notes').o2m('note', 'reviewer');
			})
			.collection('note', (c) => {
				c.field('id').id();
				c.field('body').string();
				c.field('student').m2o('owner');
				c.field('reviewer').m2o('owner');
			})
			.build();

		reviewing.collections['note']!.scopedCacheFields = ['student'];

		const service = () => {
			return new ItemsService('owner', {
				knex: db,
				schema: reviewing,
				accountability: null,
			});
		};

		test('is bare: the root key bounds nothing the note is sliced on', async () => {
			feed([{
				id: 7,
				reviewed_notes: [{ id: 3, body: 'b', student: 8, reviewer: 7 }],
			}]);

			expect(await tagsOf(service(), {
				filter: { id: { _eq: 7 } },
				fields: ['reviewed_notes.body'],
			})).toEqual(['note', 'owner:id=7']);
		});

		test(oneLine`
			reached over its scoped fk, it carries the root key as a slice
		`, async () => {
			feed([{ id: 7, notes: [{ id: 3, body: 'b', student: 7, reviewer: 8 }] }]);

			expect(await tagsOf(service(), {
				filter: { id: { _eq: 7 } },
				fields: ['notes.body'],
			})).toEqual(['note:student=7', 'owner:id=7']);
		});

		test('reached both ways, the unscoped path bares it', async () => {
			feed([{
				id: 7,
				notes: [{ id: 3, body: 'b', student: 7, reviewer: 8 }],
				reviewed_notes: [{ id: 4, body: 'c', student: 8, reviewer: 7 }],
			}]);

			expect(await tagsOf(service(), {
				filter: { id: { _eq: 7 } },
				fields: ['notes.body', 'reviewed_notes.body'],
			})).toEqual(['note', 'owner:id=7']);
		});
	});

	describe('a collection depended on beyond the rows it nested', () => {
		const chain = (partScope: string[]) => {
			const built = new SchemaBuilder()
				.collection('student', (c) => {
					c.field('id').id();
					c.field('courses').o2m('course', 'student');
				})
				.collection('course', (c) => {
					c.field('id').id();
					c.field('student').m2o('student');
					c.field('parts').o2m('part', 'course');
				})
				.collection('part', (c) => {
					c.field('id').id();
					c.field('title').string();
					c.field('status').string();
					c.field('course').m2o('course');
				})
				.build();

			built.collections['course']!.scopedCacheFields = ['student'];
			built.collections['part']!.scopedCacheFields = partScope;

			return built;
		};

		const rows = [{
			id: 3,
			courses: [{
				id: 20,
				student: 3,
				parts: [{ id: 200, title: 't', status: 'x', course: 20 }],
			}],
		}];

		const query = {
			filter: { id: { _eq: 3 }, courses: { parts: { status: { _eq: 'x' } } } },
			fields: ['courses.parts.title'],
		};

		test(oneLine`
			carries its row pins beside the slice its ownership chain reverses to the root
		`, async () => {
			const service = new ItemsService('student', {
				knex: db,
				schema: chain(['course', 'course.student']),
				accountability: null,
			});

			feed(rows);

			expect(await tagsOf(service, query)).toEqual([
				'course:student=3',
				'part:course.student=3',
				'part:course=20',
				'student:id=3',
			]);
		});

		test(oneLine`
			falls back to bare when no slice bounds the rows the filter reads
		`, async () => {
			// Rooted on the course itself, filtered by its owner rather than its key:
			// the root has no key pin for the chain to reverse onto, and nothing in the
			// filter binds `parts.course`, so the row pin alone cannot stand.
			const service = new ItemsService('course', {
				knex: db,
				schema: chain(['course']),
				accountability: null,
			});

			feed([{
				id: 20,
				student: 3,
				parts: [{ id: 200, title: 't', status: 'x', course: 20 }],
			}]);

			expect(await tagsOf(service, {
				filter: { student: { _eq: 3 }, parts: { status: { _eq: 'x' } } },
				fields: ['parts.title'],
			})).toEqual(['course:student=3', 'part']);
		});

		test(oneLine`
			drops the slice the filter binds past the ceiling, never trimmed
		`, async () => {
			vi.mocked(scopedCacheMaxPinsPerCollection).mockReturnValue(2);

			const service = new ItemsService('course', {
				knex: db,
				schema: chain(['course']),
				accountability: null,
			});

			feed([{ id: 20, student: 3 }]);

			expect(await tagsOf(service, {
				filter: { parts: { id: { _in: [200, 201, 202] } } },
				fields: ['id'],
			})).toEqual(['course', 'part']);

			feed([{ id: 20, student: 3 }]);

			expect(await tagsOf(service, {
				filter: { parts: { id: { _in: [200, 201] } } },
				fields: ['id'],
			})).toEqual(['course', 'part:course=20', 'part:id=200', 'part:id=201']);

			vi.mocked(scopedCacheMaxPinsPerCollection).mockReturnValue(250);
		});
	});

	describe('an injected ownership ancestor gated by a permission case', () => {
		const ownership = new SchemaBuilder()
			.collection('root', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('kind').string();
				c.field('since').dateTime();
			})
			.collection('grandowner', (c) => {
				c.field('id').id();
				c.field('root').m2o('root');
			})
			.collection('owner', (c) => {
				c.field('id').id();
				c.field('grandowner').m2o('grandowner');
			})
			.collection('note', (c) => {
				c.field('id').id();
				c.field('owner').m2o('owner');
			})
			.build();

		ownership.collections['root']!.scopedCacheFields = ['name', 'since'];
		ownership.collections['grandowner']!.scopedCacheFields = ['root'];
		ownership.collections['owner']!.scopedCacheFields = ['grandowner'];
		ownership.collections['note']!.scopedCacheFields = ['owner'];

		const permitting = (cases: Record<string, Filter>): void => {
			vi.mocked(fetchPermissions).mockImplementation(async () => {
				return ['root', 'grandowner', 'owner', 'note'].map((collection, at) => {
					return {
						id: at + 1,
						policy: 'policy',
						collection,
						action: 'read' as const,
						fields: ['*'],
						permissions: cases[collection] ?? { id: { _nnull: true } },
						validation: null,
						presets: null,
					};
				});
			});
		};

		const asUser = (): ItemsService => {
			return new ItemsService('note', {
				knex: db,
				schema: ownership,
				accountability: {
					user: 'u1',
					role: 'r1',
					roles: ['r1'],
					admin: false,
					app: true,
					ip: null,
				},
			});
		};

		const rows = [{
			id: 1,
			owner: 1,
			__scoped_cache_owner: { id: 1, grandowner: { id: 1, root: { id: 1 } } },
		}];

		afterEach(() => {
			vi.mocked(fetchPermissions).mockImplementation(async () => []);
		});

		test('keeps its key pin under a case on its own columns', async () => {
			// The case decides per nested row whether that row shows, and the row is
			// the one the key pin names — a write to it purges that pin.
			permitting({});
			feed(rows);

			expect(await tagsOf(asUser(), {
				fields: ['*'],
				filter: { owner: { id: { _eq: 1 } } },
			})).toEqual(['grandowner:id=1', 'note:owner=1', 'owner:id=1', 'root:id=1']);
		});

		test(oneLine`
			slices what a case hopping out of it reaches along a scope path: the
			write side emits that slice for every row the chain lands on the value
		`, async () => {
			permitting({
				grandowner: { root: { name: { _eq: 'open' } } },
				root: { name: { _eq: 'open' } },
			});

			feed(rows);

			expect(await tagsOf(asUser(), {
				fields: ['*'],
				filter: { owner: { id: { _eq: 1 } } },
			})).toEqual([
				'grandowner:id=1',
				'grandowner:root.name=open',
				'note:owner=1',
				'owner:id=1',
				'root:id=1',
				'root:name=open',
			]);
		});

		test(oneLine`
			bares what a case hopping out of it reaches off any scope path
		`, async () => {
			permitting({ grandowner: { root: { kind: { _eq: 'open' } } } });
			feed(rows);

			expect(await tagsOf(asUser(), {
				fields: ['*'],
				filter: { owner: { id: { _eq: 1 } } },
			})).toEqual(['grandowner:id=1', 'note:owner=1', 'owner:id=1', 'root']);
		});

		test('slices one value per key the case lists', async () => {
			permitting({
				grandowner: { root: { name: { _in: ['open', 'ajar'] } } },
				root: { name: { _in: ['open', 'ajar'] } },
			});

			feed(rows);

			expect(await tagsOf(asUser(), {
				fields: ['*'],
				filter: { owner: { id: { _eq: 1 } } },
			})).toEqual([
				'grandowner:id=1',
				'grandowner:root.name=ajar',
				'grandowner:root.name=open',
				'note:owner=1',
				'owner:id=1',
				'root:id=1',
				'root:name=ajar',
				'root:name=open',
			]);
		});

		// Off any request but the date's: `validateFilter` rejects the empty
		// list, and `parseFilter` lists the value, splits the columns into `_and`
		// and wraps the leaf in `_eq` before any tag is derived — only a filter
		// handed straight to the service carries those shapes.
		test.each([
			['an empty list', { name: { _in: [] } }],
			['a list that is no list', { name: { _in: 'open' } }],
			['a column no slice can name', { since: { _eq: '2026-01-01' } }],
			['two columns at once', { name: { _eq: 'open' }, kind: { _eq: 'x' } }],
			['a leaf that is no node', { name: { open: 'x' } }],
		])(
			'bares what a case hopping out of it reaches on %s',
			async (_shape, condition) => {
				permitting({ grandowner: { root: condition } as Filter });
				feed(rows);

				expect(await tagsOf(asUser(), {
					fields: ['*'],
					filter: { owner: { id: { _eq: 1 } } },
				})).toEqual(['grandowner:id=1', 'note:owner=1', 'owner:id=1', 'root']);
			},
		);

		test(oneLine`
			bares what a case reaches on a declared path whose hop is no relation
		`, async () => {
			ownership.collections['grandowner']!.scopedCacheFields = [
				'root',
				'root.kind.x',
			];

			try {
				permitting({ grandowner: { root: { kind: { x: { _eq: 1 } } } } as Filter });
				feed(rows);

				expect(await tagsOf(asUser(), {
					fields: ['*'],
					filter: { owner: { id: { _eq: 1 } } },
				})).toEqual(['grandowner:id=1', 'note:owner=1', 'owner:id=1', 'root']);
			}
			finally {
				ownership.collections['grandowner']!.scopedCacheFields = ['root'];
			}
		});
	});

	describe('a nested node whose case hops out along a scope path', () => {
		// The planner's review-round enrichment: a method-range configuration read
		// nests the range's time slots, their part and course, and every collection
		// is scoped by the fk toward its owner while every read policy filters on
		// the composed path to the user.
		const cursus = new SchemaBuilder()
			.collection('student', (c) => {
				c.field('id').id();
				c.field('user').string();
				c.field('name').string();
			})
			.collection('enrollment', (c) => {
				c.field('id').id();
				c.field('student').m2o('student');
			})
			.collection('discipline', (c) => {
				c.field('id').id();
				c.field('enrollment').m2o('enrollment');
			})
			.collection('tu', (c) => {
				c.field('id').id();
				c.field('discipline').m2o('discipline');
			})
			.collection('course', (c) => {
				c.field('id').id();
				c.field('tu').m2o('tu');
				c.field('parts').o2m('part', 'course');
				c.field('notes').o2m('note', 'course');
			})
			.collection('note', (c) => {
				c.field('id').id();
				c.field('course').m2o('course');
			})
			.collection('part', (c) => {
				c.field('id').id();
				c.field('course').m2o('course');
			})
			.collection('slot', (c) => {
				c.field('id').id();
				c.field('part').m2o('part');
				c.field('range').m2o('range');
			})
			.collection('range', (c) => {
				c.field('id').id();
				c.field('user_created').string();
				c.field('tu').m2o('tu');
				c.field('time_slots').o2m('slot', 'range');
			})
			.collection('configuration', (c) => {
				c.field('id').id();
				c.field('collection').string();
				c.field('item').string();
				c.field('range').m2o('range');
			})
			.build();

		cursus.collections['student']!.scopedCacheFields = ['user'];
		cursus.collections['enrollment']!.scopedCacheFields = ['student'];
		cursus.collections['discipline']!.scopedCacheFields = ['enrollment'];
		cursus.collections['tu']!.scopedCacheFields = ['discipline'];
		cursus.collections['course']!.scopedCacheFields = ['tu'];
		cursus.collections['note']!.scopedCacheFields = ['course'];
		cursus.collections['part']!.scopedCacheFields = ['course'];
		cursus.collections['slot']!.scopedCacheFields = ['part', 'range'];
		cursus.collections['range']!.scopedCacheFields = ['user_created', 'tu'];
		cursus.collections['configuration']!.scopedCacheFields = ['range', 'item'];

		const toUser = { user: { _eq: 'u1' } };

		// Every policy but the range's reaches the student, `onStudent` being
		// what it says of them.
		const casesReaching = (onStudent: Filter): Record<string, Filter> => {
			const from = (path: string[]): Filter => {
				return path.reduceRight<Record<string, unknown>>(
					(inner, hop) => ({ [hop]: inner }),
					{ student: onStudent },
				) as Filter;
			};

			return {
				student: onStudent,
				enrollment: from([]),
				discipline: from(['enrollment']),
				tu: from(['discipline', 'enrollment']),
				course: from(['tu', 'discipline', 'enrollment']),
				note: from(['course', 'tu', 'discipline', 'enrollment']),
				part: from(['course', 'tu', 'discipline', 'enrollment']),
				slot: from(['part', 'course', 'tu', 'discipline', 'enrollment']),
				range: { user_created: { _eq: 'u1' } },
				configuration: { range: { user_created: { _eq: 'u1' } } },
			};
		};

		const permitting = (onStudent: Filter = toUser): void => {
			const cases = casesReaching(onStudent);

			vi.mocked(fetchPermissions).mockImplementation(async () => {
				return Object.keys(cases).map((collection, at) => {
					return {
						id: at + 1,
						policy: 'policy',
						collection,
						action: 'read' as const,
						fields: ['*'],
						permissions: { _and: [cases[collection]!] },
						validation: null,
						presets: null,
					};
				});
			});
		};

		const asUser = (): ItemsService => {
			return new ItemsService('configuration', {
				knex: db,
				schema: cursus,
				accountability: {
					user: 'u1',
					role: 'r1',
					roles: ['r1'],
					admin: false,
					app: true,
					ip: null,
				},
			});
		};

		afterEach(() => {
			vi.mocked(fetchPermissions).mockImplementation(async () => []);
		});

		const rows = [{
			id: 100,
			item: '7',
			range: {
				id: 50,
				user_created: 'u1',
				tu: 30,
				__scoped_cache_tu: {
					id: 30,
					discipline: {
						id: 20,
						enrollment: { id: 10, student: { id: 1, user: 'u1' } },
					},
				},
				time_slots: [{
					id: 1,
					range: 50,
					part: {
						id: 2,
						course: {
							id: 3,
							tu: 30,
							parts: [{ id: 2, course: 3 }],
							notes: [4],
						},
					},
				}],
			},
		}];

		const query = {
			fields: [
				'item',
				'range.id',
				'range.user_created',
				'range.tu',
				'range.time_slots.*',
				'range.time_slots.part.*',
				'range.time_slots.part.course.*',
				'range.time_slots.part.course.parts.*',
			],
			filter: { collection: { _eq: 'round' }, item: { _in: ['7'] } },
			deep: {
				range: { time_slots: { _sort: ['part.course.id', 'part.id', 'id'] } },
			},
		};

		test(oneLine`
			slices every collection the cases hop through by the path to the user:
			nothing on the way is bare
		`, async () => {
			permitting();
			feed(rows);

			expect(await tagsOf(asUser(), query)).toEqual([
				'configuration:item=7',
				'configuration:range.user_created=u1',
				'course:id=3',
				'course:tu.discipline.enrollment.student.user=u1',
				'discipline:enrollment.student.user=u1',
				'discipline:id=20',
				'enrollment:id=10',
				'enrollment:student.user=u1',
				'note:course.tu.discipline.enrollment.student.user=u1',
				'note:course=3',
				'part:course.tu.discipline.enrollment.student.user=u1',
				'part:course=3',
				'range:id=50',
				'range:user_created=u1',
				'slot:part.course.tu.discipline.enrollment.student.user=u1',
				'slot:range=50',
				'student:id=1',
				'student:user=u1',
				'tu:discipline.enrollment.student.user=u1',
				'tu:id=30',
			]);
		});

		test(oneLine`
			slices every collection by the student's key when the cases name the
			student through it: how a rule authored on the student is spelled
		`, async () => {
			permitting({ id: { _eq: 1 } });
			feed(rows);

			expect(await tagsOf(asUser(), query)).toEqual([
				'configuration:item=7',
				'configuration:range.user_created=u1',
				'course:id=3',
				'course:tu.discipline.enrollment.student=1',
				'discipline:enrollment.student=1',
				'discipline:id=20',
				'enrollment:id=10',
				'enrollment:student=1',
				'note:course.tu.discipline.enrollment.student=1',
				'note:course=3',
				'part:course.tu.discipline.enrollment.student=1',
				'part:course=3',
				'range:id=50',
				'range:user_created=u1',
				'slot:part.course.tu.discipline.enrollment.student=1',
				'slot:range=50',
				'student:id=1',
				'tu:discipline.enrollment.student=1',
				'tu:id=30',
			]);
		});

		test(oneLine`
			bares every hop when the cases name the student by a column no slice
			can name: the hop is the scope path, the column under it is not
		`, async () => {
			permitting({ name: { _eq: 'Ada' } });
			feed(rows);

			expect(await tagsOf(asUser(), query)).toEqual([
				'configuration:item=7',
				'configuration:range.user_created=u1',
				'course',
				'discipline',
				'enrollment',
				'note:course=3',
				'part',
				'range:id=50',
				'range:user_created=u1',
				'slot:range=50',
				'student',
				'tu',
			]);
		});

		describe('a to-many whose scope lacks the fk it hangs off', () => {
			// No parent-key pin can name the slots: only what bounds the node's own
			// rows is left to.
			beforeEach(() => {
				cursus.collections['slot']!.scopedCacheFields = ['part'];
			});

			afterEach(() => {
				cursus.collections['slot']!.scopedCacheFields = ['part', 'range'];
			});

			test(oneLine`
				slices it by its own case: the node's WHERE gates every row it
				returns, whichever way the read reached it
			`, async () => {
				permitting();
				feed(rows);

				const tags = await tagsOf(asUser(), query);

				expect(tags).toContain(
					'slot:part.course.tu.discipline.enrollment.student.user=u1',
				);

				expect(tags).not.toContain('slot');
			});

			test(oneLine`
				keeps it bare when its case names no slice
			`, async () => {
				permitting({ name: { _eq: 'Ada' } });
				feed(rows);

				const tags = await tagsOf(asUser(), query);

				expect(tags).toContain('slot');
				expect(tags.filter((tag) => tag.startsWith('slot:'))).toEqual([]);
			});
		});

		test.each([
			['a null hop', { tu: null, __scoped_cache_tu: null }],
			['a hop whose case withheld its row', { tu: 30, __scoped_cache_tu: null }],
		])(oneLine`
			tags no ancestor the ownership injection nested through %s: a chain
			reaching no row leaves the response as it was
		`, async (_shape, hop) => {
			permitting();

			feed([{
				...rows[0]!,
				range: { ...rows[0]!.range, ...hop },
			}]);

			const service = asUser();
			const tags = await tagsOf(service, query);

			for (const ancestor of ['tu', 'discipline', 'enrollment', 'student']) {
				expect(tags).not.toContain(ancestor);
				expect(tags.some((tag) => tag.startsWith(`${ancestor}:id=`))).toBe(false);
			}

			expect(tags).toContain('tu:discipline.enrollment.student.user=u1');
			expect(tags).toContain('range:id=50');

			// The foreign key the caller asked for is what the row carried, not what
			// the injected hop came back as.
			feed([{
				...rows[0]!,
				range: { ...rows[0]!.range, ...hop },
			}]);

			const [row] = await service.readByQuery(query, { emitEvents: false });

			expect((row as { range: { tu: unknown } }).range.tu).toBe(hop.tu);
		});
	});

	describe('a slice reversed off the root key', () => {
		const schema = new SchemaBuilder()
			.collection('student', (c) => {
				c.field('id').id();
				c.field('user').string();
				c.field('courses').o2m('course', 'student');
			})
			.collection('course', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('student').m2o('student');
			})
			.build();

		schema.collections['student']!.scopedCacheFields = ['user'];
		schema.collections['course']!.scopedCacheFields = ['student'];

		const rows = [
			{ id: 1, user: 'a', courses: [{ id: 10, title: 'c10', student: 1 }] },
			{ id: 5, user: 'x', courses: [{ id: 50, title: 'c50', student: 5 }] },
		];

		// One parent per branch, so the o2m pinner declines at a ceiling of 1 and
		// the merge has to answer for the courses on its own.
		beforeEach(() => {
			vi.mocked(scopedCacheMaxPinsPerCollection).mockReturnValue(1);
		});

		afterEach(() => {
			vi.mocked(scopedCacheMaxPinsPerCollection).mockReturnValue(250);
		});

		test(oneLine`
			stays bare under an _or the key bounds one branch of: the other branch's
			rows nest courses the reversed slice never names
		`, async () => {
			const service = new ItemsService('student', {
				knex: db,
				schema,
				accountability: null,
			});

			feed(rows);

			expect(await tagsOf(service, {
				fields: ['*', 'courses.*'],
				filter: { _or: [{ id: { _eq: 1 } }, { user: { _eq: 'x' } }] },
			})).toEqual(['course', 'student:id=1', 'student:user=x']);
		});

		test('reverses onto every key when each branch binds one', async () => {
			const service = new ItemsService('student', {
				knex: db,
				schema,
				accountability: null,
			});

			feed(rows);

			expect(await tagsOf(service, {
				fields: ['*', 'courses.*'],
				filter: { _or: [{ id: { _eq: 1 } }, { id: { _eq: 5 } }] },
			})).toEqual([
				'course:student=1',
				'course:student=5',
				'student:id=1',
				'student:id=5',
			]);
		});
	});

	describe('a to-many nested twice under aliases', () => {
		const schema = new SchemaBuilder()
			.collection('round', (c) => {
				c.field('id').id();
				c.field('days').o2m('day', 'round');
			})
			.collection('day', (c) => {
				c.field('id').id();
				c.field('date').string();
				c.field('round').m2o('round');
			})
			.build();

		schema.collections['day']!.scopedCacheFields = ['round'];

		const first = { id: 1, date: '2023-11-17', round: 1 };
		const last = { id: 2, date: '2023-11-19', round: 1 };

		test(oneLine`
			pins the child on its parent key through the alias, which names no field
		`, async () => {
			const service = new ItemsService('round', {
				knex: db,
				schema,
				accountability: null,
			});

			feed([{ id: 1, days: [first, last], start: [first], end: [last] }]);

			expect(await tagsOf(service, {
				fields: ['id', 'days.date', 'start.date', 'end.date'],
				alias: { start: 'days', end: 'days' },
				filter: { id: { _eq: 1 } },
				deep: {
					start: { _sort: ['date'], _limit: 1 },
					end: { _sort: ['-date'], _limit: 1 },
				},
			})).toEqual(['day:round=1', 'round:id=1']);
		});
	});

	describe('a to-one target nested again as a to-many under it', () => {
		const schema = new SchemaBuilder()
			.collection('slot', (c) => {
				c.field('id').id();
				c.field('part').m2o('part');
			})
			.collection('part', (c) => {
				c.field('id').id();
				c.field('course').m2o('course');
			})
			.collection('course', (c) => {
				c.field('id').id();
				c.field('parts').o2m('part', 'course');
			})
			.build();

		schema.collections['part']!.scopedCacheFields = ['course'];

		const fields = ['id', 'part.id', 'part.course.id', 'part.course.parts.id'];
		const filter = { id: { _in: [1, 2] } };

		const slot = (id: number, course: number | null) => {
			return {
				id,
				part: {
					id,
					course: course === null
						? null
						: { id: course, parts: [{ id, course }] },
				},
			};
		};

		test(oneLine`
			pins it on the parent key when the to-many hangs off its own foreign key
		`, async () => {
			const service = new ItemsService('slot', {
				knex: db,
				schema,
				accountability: null,
			});

			feed([slot(1, 1), slot(2, 2)]);

			expect(await tagsOf(service, { fields, filter })).toEqual([
				'course:id=1',
				'course:id=2',
				'part:course=1',
				'part:course=2',
				'slot:id=1',
				'slot:id=2',
			]);
		});

		// The o2m pins are one per distinct course, the m2o pins one per distinct
		// part, and each part has one course: the o2m pins pass the ceiling only
		// when the m2o pins do, so no path is left pinned over the dropped slice.
		test(oneLine`
			leaves it bare when the parent-key pins covering it pass the ceiling
		`, async () => {
			vi.mocked(scopedCacheMaxPinsPerCollection).mockReturnValue(1);

			const service = new ItemsService('slot', {
				knex: db,
				schema,
				accountability: null,
			});

			feed([slot(1, 1), slot(2, 2)]);

			expect(await tagsOf(service, { fields, filter })).toEqual([
				'course',
				'part',
				'slot:id=1',
				'slot:id=2',
			]);

			vi.mocked(scopedCacheMaxPinsPerCollection).mockReturnValue(250);
		});

		test(oneLine`
			leaves it bare when a row reached has that foreign key empty
		`, async () => {
			const service = new ItemsService('slot', {
				knex: db,
				schema,
				accountability: null,
			});

			feed([slot(1, 1), slot(2, null)]);

			expect(await tagsOf(service, { fields, filter })).toEqual([
				'course:id=1',
				'part',
				'slot:id=1',
				'slot:id=2',
			]);
		});
	});

	describe('a to-many sorted through to-one hops', () => {
		const schema = new SchemaBuilder()
			.collection('round', (c) => {
				c.field('id').id();
				c.field('slots').o2m('slot', 'round');
			})
			.collection('slot', (c) => {
				c.field('id').id();
				c.field('round').m2o('round');
				c.field('part').m2o('part');
			})
			.collection('part', (c) => {
				c.field('id').id();
				c.field('sort').integer();
				c.field('course').m2o('course');
			})
			.collection('course', (c) => {
				c.field('id').id();
				c.field('sort').integer();
			})
			.build();

		schema.collections['slot']!.scopedCacheFields = ['round'];
		schema.collections['part']!.scopedCacheFields = ['course'];

		const rows = [{
			id: 1,
			slots: [1, 2, 3].map((id) => {
				return { id, round: 1, part: { id, sort: 1, course: { id, sort: id } } };
			}),
		}];

		const sorted = (node: Record<string, unknown>) => {
			return {
				fields: ['id', 'slots.id', 'slots.part.id', 'slots.part.course.id'],
				filter: { id: { _eq: 1 } },
				deep: {
					slots: { _sort: ['part.course.sort', 'part.sort', 'id'], ...node },
				},
			};
		};

		const whole = [
			'course:id=1',
			'course:id=2',
			'course:id=3',
			'part:id=1',
			'part:id=2',
			'part:id=3',
			'round:id=1',
			'slot:round=1',
		];

		const service = () => {
			return new ItemsService('round', {
				knex: db,
				schema,
				accountability: null,
			});
		};

		test.each([
			['under the default limit', {}],
			['under a limit the rows stay short of', { _limit: 4 }],
			['with no limit', { _limit: -1 }],
		])('keeps the key pins %s', async (_shape, node) => {
			feed(rows);

			expect(await tagsOf(service(), sorted(node))).toEqual(whole);
		});

		test.each([
			['cut at the limit', { _limit: 3 }],
			['on a later page', { _limit: 5, _page: 2 }],
			['past an offset', { _limit: 5, _offset: 1 }],
		])('bares the sorted-through collections %s', async (_shape, node) => {
			feed(rows);

			expect(await tagsOf(service(), sorted(node))).toEqual([
				'course',
				'part',
				'round:id=1',
				'slot:round=1',
			]);
		});

		test('keeps the key pins when the cut sorts on an own column', async () => {
			feed(rows);

			expect(await tagsOf(service(), {
				...sorted({ _limit: 3 }),
				deep: { slots: { _sort: ['id'], _limit: 3 } },
			})).toEqual(whole);
		});
	});
});
