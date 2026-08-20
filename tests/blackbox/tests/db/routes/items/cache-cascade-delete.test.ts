import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Scoped purging is driven by ItemsService: snapshot the mutated collection's scope
// values, then purge its tags. A database-level ON DELETE never goes through the
// service — no call, no items.delete event, no snapshot, no purge. What each rule
// leaves behind:
//   - CASCADE removes the rows underneath, so their entries describe rows that are
//     gone, and it propagates to their own children.
//     - Into the same collection too: the service only ever knew the key it was
//       handed, so descendants it never saw keep their slices warm.
//   - SET NULL and SET DEFAULT are the quieter half: the rows survive carrying a
//     changed foreign key, so they keep being served under a slice they have left.
//     Neither propagates — nothing below a surviving row changes.
//   - NO ACTION and RESTRICT change nothing: the database refuses the delete rather
//     than touch the rows, so purging them would be over-purging.
// Purging the bare collection tag reaches none of the value slices, which is why the
// collections below are sliced and read under a bounded filter.

const PARENT = 'test_items_cascade_parent';
const CHILD = 'test_items_cascade_child';
const GRANDCHILD = 'test_items_cascade_grandchild';
const NULLED = 'test_items_cascade_nulled';
const NULLED_CHILD = 'test_items_cascade_nulled_child';
const SIBLING = 'test_items_cascade_sibling';
const SCOPED_CHILD = 'test_items_cascade_scoped_child';
const DEFAULTED = 'test_items_cascade_defaulted';
const RESTRICTED = 'test_items_cascade_restricted';
const SELF = 'test_items_cascade_self';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-cache-tags';

// InnoDB rejects a table definition carrying ON DELETE SET DEFAULT and Oracle has no
// such rule at all; postgres, sqlite and mssql all take it.
const vendorsRejectingSetDefault = ['mysql', 'mysql5', 'maria', 'oracle'];

describe(oneLine`
	deleting a parent purges the collections its foreign keys cascade into
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		// Proves the reads below are pinned to a value slice instead of falling back to
		// the bare collection tag, which is the whole subject.
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-cascade-${vendor}`;

		let instance: ChildProcess;
		let doomedParent: number;
		let doomedRuleParent: number;
		let doomedDefaultParent: number;
		let survivingParent: number;
		let selfRoot: number;

		const supportsSetDefault = vendorsRejectingSetDefault.includes(vendor) === false;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					...[
						PARENT,
						CHILD,
						GRANDCHILD,
						NULLED,
						NULLED_CHILD,
						SIBLING,
						RESTRICTED,
						...(supportsSetDefault
							? [DEFAULTED]
							: []),
					].map((collection) => {
						return {
							collection,
							fields: [{ field: 'label', type: 'string', meta: {} }],
						};
					}),
					// Sliced by `owner`: a read bounded to one value is indexed under
					// that slice alone and never under the bare collection tag.
					...[SCOPED_CHILD, SELF].map((collection) => {
						return {
							collection,
							meta: { scoped_cache_fields: ['owner'] },
							fields: [
								{ field: 'label', type: 'string', meta: {} },
								{ field: 'owner', type: 'string', meta: {} },
							],
						};
					}),
				],
			});

			// The cascade is the subject: SET NULL (the helper's default) would leave the
			// child rows in place and there would be nothing to go stale.
			await CreateFieldM2O(vendor, {
				collection: CHILD,
				field: 'parent',
				otherCollection: PARENT,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: GRANDCHILD,
				field: 'child',
				otherCollection: CHILD,
				relationSchema: { on_delete: 'CASCADE' },
			});

			// The other half: these rows outlive the parent, carrying a nulled FK.
			await CreateFieldM2O(vendor, {
				collection: NULLED,
				field: 'parent',
				otherCollection: PARENT,
				relationSchema: { on_delete: 'SET NULL' },
			});

			// Below a nulled row nothing changes, so this one must stay warm.
			await CreateFieldM2O(vendor, {
				collection: NULLED_CHILD,
				field: 'nulled',
				otherCollection: NULLED,
				relationSchema: { on_delete: 'CASCADE' },
			});

			// The regression: this collection is sliced, so its cached reads are indexed
			// under `owner=<value>` where the bare collection tag never reaches them.
			await CreateFieldM2O(vendor, {
				collection: SCOPED_CHILD,
				field: 'parent',
				otherCollection: PARENT,
				relationSchema: { on_delete: 'CASCADE' },
			});

			// The rows survive carrying the column default, which is null here — the
			// same end state as SET NULL, reached through a rule of its own.
			if (supportsSetDefault) {
				await CreateFieldM2O(vendor, {
					collection: DEFAULTED,
					field: 'parent',
					otherCollection: PARENT,
					relationSchema: { on_delete: 'SET DEFAULT' },
				});
			}

			// Related to the parent and changed by nothing: the database refuses a
			// delete rather than touch these rows, so purging them is over-purging.
			await CreateFieldM2O(vendor, {
				collection: RESTRICTED,
				field: 'parent',
				otherCollection: PARENT,
				relationSchema: { on_delete: 'NO ACTION' },
			});

			// A collection cascading into itself: the rows the database removes are its
			// own, and the service only ever knew about the key it was handed.
			await CreateFieldM2O(vendor, {
				collection: SELF,
				field: 'parent',
				otherCollection: SELF,
				relationSchema: { on_delete: 'CASCADE' },
			});

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [
					{ label: 'doomed' },
					{ label: 'doomed-by-rule' },
					{ label: 'doomed-by-default' },
					{ label: 'survivor' },
				],
			});

			doomedParent = parents[0].id;
			doomedRuleParent = parents[1].id;
			doomedDefaultParent = parents[2].id;
			survivingParent = parents[3].id;

			const [children, nulled, selfRoots] = await Promise.all([
				CreateItem(vendor, {
					collection: CHILD,
					item: [{ label: 'child-of-doomed', parent: doomedParent }],
				}),
				CreateItem(vendor, {
					collection: NULLED,
					item: [{ label: 'nulled-by-doomed', parent: doomedParent }],
				}),
				CreateItem(vendor, {
					collection: SELF,
					item: [{ label: 'self-root', owner: 'root' }],
				}),
			]);

			selfRoot = selfRoots[0].id;

			await Promise.all([
				CreateItem(vendor, {
					collection: SELF,
					item: [{ label: 'self-branch', owner: 'branch', parent: selfRoot }],
				}),
				CreateItem(vendor, {
					collection: SCOPED_CHILD,
					item: [
						{ label: 'doomed-slice', owner: 'a', parent: doomedRuleParent },
						{ label: 'kept-slice', owner: 'b', parent: survivingParent },
					],
				}),
				CreateItem(vendor, {
					collection: RESTRICTED,
					item: [{ label: 'kept', parent: survivingParent }],
				}),
				...(supportsSetDefault
					? [CreateItem(vendor, {
						collection: DEFAULTED,
						item: [{ label: 'defaulted', parent: doomedDefaultParent }],
					})]
					: []),
				CreateItem(vendor, {
					collection: GRANDCHILD,
					item: [{ label: 'grandchild-of-doomed', child: children[0].id }],
				}),
				CreateItem(vendor, {
					collection: NULLED_CHILD,
					item: [{ label: 'child-of-nulled', nulled: nulled[0].id }],
				}),
				CreateItem(vendor, {
					collection: SIBLING,
					item: [{ label: 'untouched' }],
				}),
			]);

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();

			// Depth first: every FK must go before the collection it points at.
			await DeleteCollection(vendor, { collection: GRANDCHILD });
			await DeleteCollection(vendor, { collection: NULLED_CHILD });

			await Promise.all([
				DeleteCollection(vendor, { collection: CHILD }),
				DeleteCollection(vendor, { collection: NULLED }),
				DeleteCollection(vendor, { collection: SCOPED_CHILD }),
				DeleteCollection(vendor, { collection: RESTRICTED }),
				...(supportsSetDefault
					? [DeleteCollection(vendor, { collection: DEFAULTED })]
					: []),
			]);

			await Promise.all([
				DeleteCollection(vendor, { collection: PARENT }),
				DeleteCollection(vendor, { collection: SIBLING }),
				DeleteCollection(vendor, { collection: SELF }),
			]);
		});

		function read(collection: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.set('Authorization', auth);
		}

		// `fields` excludes the foreign key so the field map holds this collection alone
		// and the tag header below is the read's whole tag set, not a prefix of it.
		function readSlice(collection: string, owner: string) {
			const sliceQuery = `fields=id,label,owner&filter[owner][_eq]=${owner}`;

			return request(getUrl(vendor, env))
				.get(`/items/${collection}?${sliceQuery}`)
				.set('Authorization', auth);
		}

		it(oneLine`
			a delete purges what it cascades into and what it nulls, and nothing past a
			nulled row
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warmed = await Promise.all([
				read(CHILD),
				read(GRANDCHILD),
				read(NULLED),
				read(NULLED_CHILD),
				read(SIBLING),
			]);

			for (const response of warmed) {
				expect(response.headers[cacheStatusHeader]).toBe('MISS');
			}

			await request(url)
				.delete(`/items/${PARENT}/${doomedParent}`)
				.set('Authorization', auth);

			const [child, grandchild, nulled, nulledChild, sibling] = await Promise.all([
				read(CHILD),
				read(GRANDCHILD),
				read(NULLED),
				read(NULLED_CHILD),
				read(SIBLING),
			]);

			expect(child.headers[cacheStatusHeader]).toBe('MISS');
			expect(grandchild.headers[cacheStatusHeader]).toBe('MISS');

			// The nulled rows survive, so this entry is not describing absent rows — it
			// is describing them under a foreign key they no longer carry.
			expect(nulled.headers[cacheStatusHeader]).toBe('MISS');

			// SET NULL does not propagate, so purging past it would be over-purging.
			expect(nulledChild.headers[cacheStatusHeader]).toBe('HIT');

			// The control: a coarse "purge everything on any delete" would drop this too,
			// so it is what keeps the assertions above meaningful.
			expect(sibling.headers[cacheStatusHeader]).toBe('HIT');

			// Non-vacuity: the rows really did cascade away, so a served HIT above would
			// have been a cache entry describing rows that no longer exist.
			expect(child.body.data).toHaveLength(0);
			expect(grandchild.body.data).toHaveLength(0);
			expect(sibling.body.data).toHaveLength(1);

			// The distinction from a cascade: still one row, now pointing at nothing.
			expect(nulled.body.data).toHaveLength(1);
			expect(nulled.body.data[0].parent).toBe(null);
			expect(nulledChild.body.data).toHaveLength(1);
		});

		it(oneLine`
			a delete purges the value slices of a collection it changes, not only its
			bare tag
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [doomedSlice, keptSlice, restricted] = await Promise.all([
				readSlice(SCOPED_CHILD, 'a'),
				readSlice(SCOPED_CHILD, 'b'),
				read(RESTRICTED),
			]);

			for (const response of [doomedSlice, keptSlice, restricted]) {
				expect(response.headers[cacheStatusHeader]).toBe('MISS');
			}

			// Non-vacuity: the bare collection tag a cascade already emits would purge a
			// bare-tagged read on its own, and the assertions below would prove nothing.
			expect(doomedSlice.headers[cacheTagsHeader])
			.toBe(`${SCOPED_CHILD}:owner=a`);

			await request(url)
				.delete(`/items/${PARENT}/${doomedRuleParent}`)
				.set('Authorization', auth);

			const [
				doomedSliceAfter,
				keptSliceAfter,
				restrictedAfter,
			] = await Promise.all([
				readSlice(SCOPED_CHILD, 'a'),
				readSlice(SCOPED_CHILD, 'b'),
				read(RESTRICTED),
			]);

			expect(doomedSliceAfter.headers[cacheStatusHeader]).toBe('MISS');

			// The accepted over-purge: which slices the database changed is unresolvable
			// once the rows are gone, so every slice of the collection goes.
			expect(keptSliceAfter.headers[cacheStatusHeader]).toBe('MISS');

			// NO ACTION cannot change a row — the database refuses the delete instead —
			// so this collection is none of the walk's business.
			expect(restrictedAfter.headers[cacheStatusHeader]).toBe('HIT');

			expect(doomedSliceAfter.body.data).toHaveLength(0);

			// Purged without being deleted, which is what separates the over-purge above
			// from a cascade.
			expect(keptSliceAfter.body.data).toHaveLength(1);
			expect(restrictedAfter.body.data).toHaveLength(1);
		});

		it.runIf(supportsSetDefault)(oneLine`
			a delete purges a collection whose foreign key it resets to a default
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warmed = await read(DEFAULTED);

			expect(warmed.headers[cacheStatusHeader]).toBe('MISS');

			await request(url)
				.delete(`/items/${PARENT}/${doomedDefaultParent}`)
				.set('Authorization', auth);

			const defaulted = await read(DEFAULTED);

			expect(defaulted.headers[cacheStatusHeader]).toBe('MISS');

			// The row outlived its parent, so the entry was serving it under a foreign
			// key it no longer carries.
			expect(defaulted.body.data).toHaveLength(1);
			expect(defaulted.body.data[0].parent).toBe(null);
		});

		it(oneLine`
			a delete purges the slices a collection cascades into itself
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const branch = await readSlice(SELF, 'branch');

			expect(branch.headers[cacheStatusHeader]).toBe('MISS');
			expect(branch.headers[cacheTagsHeader]).toBe(`${SELF}:owner=branch`);
			expect(branch.body.data).toHaveLength(1);

			await request(url)
				.delete(`/items/${SELF}/${selfRoot}`)
				.set('Authorization', auth);

			const branchAfter = await readSlice(SELF, 'branch');

			// The service was handed the root key alone, so its snapshot never saw the
			// slice the branch row lived in — and the branch row went with the root.
			expect(branchAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(branchAfter.body.data).toHaveLength(0);
		});
	});
});
