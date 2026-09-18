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

// The write-side snapshot ran behind a "no scope fields declared" early return until
// the key axis made it run for every mutation, so it now meets collections absent
// from the schema. Every mutation reaching it dereferences that collection first, so
// only a direct call gets here today — the guard is what keeps a caller that stops
// doing so from throwing on `.primary` of undefined.
describe(oneLine`
	the write-side snapshot on a collection the schema does not know
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

		expect(await service.scopedCache.snapshot([1])).toEqual([]);
	});

	test('resolves the key slice on a collection it does know', async () => {
		const service = new ItemsService('articles', {
			knex: db,
			schema,
			accountability: null,
		});

		expect(await service.scopedCache.snapshot([1])).toEqual([
			{ collection: 'articles', field: 'id', value: 1, type: 'integer' },
		]);
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

		const rows = [{ id: 1, enrollment: { id: 10, student: { id: 100 } } }];

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

			expect(service.scopedCache.ownershipPathsToInject({ fields: ['*'] }))
				.toEqual(['enrollment.id', 'enrollment.student.id']);

			expect(service.scopedCache.ownershipPathsToInject({ fields: ['*.*'] }))
				.toEqual(['enrollment.student.id']);

			expect(service.scopedCache.ownershipPathsToInject({ fields: ['*.*.*'] }))
				.toEqual([]);
		});

		test('stays nested in the response a depth wildcard asked for', async () => {
			const service = new ItemsService('course', {
				knex: db,
				schema: ownership,
				accountability: null,
			});

			feed(rows);

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

		ownership.collections['root']!.scopedCacheFields = ['name'];
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
			owner: { id: 1, grandowner: { id: 1, root: { id: 1 } } },
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

		test('bares what a case hopping out of it reaches', async () => {
			permitting({ grandowner: { root: { name: { _eq: 'open' } } } });
			feed(rows);

			expect(await tagsOf(asUser(), {
				fields: ['*'],
				filter: { owner: { id: { _eq: 1 } } },
			})).toEqual(['grandowner:id=1', 'note:owner=1', 'owner:id=1', 'root']);
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
});
