import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	CreateItem,
	DeleteCollection,
	DeleteField,
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
// The shapes the walk itself is about, each hung off a root of its own so the
// exact purged-tag list the rules above assert stays theirs.
const WALK_ROOT = 'test_items_cascade_walk_root';
const WALK_MID = 'test_items_cascade_walk_mid';
const WALK_SHARED = 'test_items_cascade_walk_shared';
const WALK_DEEP = 'test_items_cascade_walk_deep';
const CYCLE_A = 'test_items_cascade_cycle_a';
const CYCLE_B = 'test_items_cascade_cycle_b';
const DIAMOND_ROOT = 'test_items_cascade_diamond_root';
const DIAMOND_LEFT = 'test_items_cascade_diamond_left';
const DIAMOND_RIGHT = 'test_items_cascade_diamond_right';
const DIAMOND_LEAF = 'test_items_cascade_diamond_leaf';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-cache-tags';
const purgedTagsHeader = 'x-cache-purged-tags';

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
		env[vendor]['CACHE_PURGED_TAGS_HEADER'] = purgedTagsHeader;
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
		let walkRoot: number;
		let cycleRoot: number;
		let diamondRoot: number;

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
						WALK_ROOT,
						WALK_MID,
						WALK_SHARED,
						WALK_DEEP,
						CYCLE_A,
						CYCLE_B,
						DIAMOND_ROOT,
						DIAMOND_LEFT,
						DIAMOND_RIGHT,
						DIAMOND_LEAF,
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

			// A collection two rules reach: nulled straight off the root, and cascaded
			// into from the row below it. Reporting it on the first rule must not
			// retire it from the walk, or nothing under it is ever reached — which is
			// what WALK_DEEP below is here to catch.
			await CreateFieldM2O(vendor, {
				collection: WALK_SHARED,
				field: 'root',
				otherCollection: WALK_ROOT,
				relationSchema: { on_delete: 'SET NULL' },
			});

			await CreateFieldM2O(vendor, {
				collection: WALK_MID,
				field: 'root',
				otherCollection: WALK_ROOT,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: WALK_SHARED,
				field: 'mid',
				otherCollection: WALK_MID,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: WALK_DEEP,
				field: 'shared',
				otherCollection: WALK_SHARED,
				relationSchema: { on_delete: 'CASCADE' },
			});

			// Two collections cascading into each other: the walk has to report both
			// and stop, rather than follow the cycle round again.
			await CreateFieldM2O(vendor, {
				collection: CYCLE_B,
				field: 'root',
				otherCollection: CYCLE_A,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: CYCLE_A,
				field: 'peer',
				otherCollection: CYCLE_B,
				relationSchema: { on_delete: 'CASCADE' },
			});

			// Two paths onto one leaf: it is reached twice and must be named once.
			await CreateFieldM2O(vendor, {
				collection: DIAMOND_LEFT,
				field: 'root',
				otherCollection: DIAMOND_ROOT,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: DIAMOND_RIGHT,
				field: 'root',
				otherCollection: DIAMOND_ROOT,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: DIAMOND_LEAF,
				field: 'left',
				otherCollection: DIAMOND_LEFT,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: DIAMOND_LEAF,
				field: 'right',
				otherCollection: DIAMOND_RIGHT,
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

			const [walkRoots, cycleRoots, diamondRoots] = await Promise.all([
				CreateItem(vendor, {
					collection: WALK_ROOT,
					item: [{ label: 'walk-root' }],
				}),
				CreateItem(vendor, {
					collection: CYCLE_A,
					item: [{ label: 'cycle-root' }],
				}),
				CreateItem(vendor, {
					collection: DIAMOND_ROOT,
					item: [{ label: 'diamond-root' }],
				}),
			]);

			walkRoot = walkRoots[0].id;
			cycleRoot = cycleRoots[0].id;
			diamondRoot = diamondRoots[0].id;

			const [mids, lefts, rights] = await Promise.all([
				CreateItem(vendor, {
					collection: WALK_MID,
					item: [{ label: 'walk-mid', root: walkRoot }],
				}),
				CreateItem(vendor, {
					collection: DIAMOND_LEFT,
					item: [{ label: 'diamond-left', root: diamondRoot }],
				}),
				CreateItem(vendor, {
					collection: DIAMOND_RIGHT,
					item: [{ label: 'diamond-right', root: diamondRoot }],
				}),
				CreateItem(vendor, {
					collection: CYCLE_B,
					item: [{ label: 'cycle-child', root: cycleRoot }],
				}),
			]);

			// The row the cascade path reaches, beside a sibling the nullify path
			// reaches: only the first carries anything below it.
			const shared = await CreateItem(vendor, {
				collection: WALK_SHARED,
				item: [
					{ label: 'walk-shared-cascaded', mid: mids[0].id },
					{ label: 'walk-shared-nulled', root: walkRoot },
				],
			});

			await Promise.all([
				CreateItem(vendor, {
					collection: WALK_DEEP,
					item: [{ label: 'walk-deep', shared: shared[0].id }],
				}),
				CreateItem(vendor, {
					collection: DIAMOND_LEAF,
					item: [{
						label: 'diamond-leaf',
						left: lefts[0].id,
						right: rights[0].id,
					}],
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

			// The two cascade into each other, so neither can go while the other's
			// foreign key still names it.
			await DeleteField(vendor, { collection: CYCLE_A, field: 'peer' });

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
				DeleteCollection(vendor, { collection: WALK_DEEP }),
				DeleteCollection(vendor, { collection: DIAMOND_LEAF }),
			]);

			await Promise.all([
				DeleteCollection(vendor, { collection: WALK_SHARED }),
				DeleteCollection(vendor, { collection: DIAMOND_LEFT }),
				DeleteCollection(vendor, { collection: DIAMOND_RIGHT }),
				DeleteCollection(vendor, { collection: CYCLE_B }),
			]);

			await Promise.all([
				DeleteCollection(vendor, { collection: WALK_MID }),
			]);

			await Promise.all([
				DeleteCollection(vendor, { collection: PARENT }),
				DeleteCollection(vendor, { collection: SIBLING }),
				DeleteCollection(vendor, { collection: SELF }),
				DeleteCollection(vendor, { collection: WALK_ROOT }),
				DeleteCollection(vendor, { collection: CYCLE_A }),
				DeleteCollection(vendor, { collection: DIAMOND_ROOT }),
			]);
		});

		function read(collection: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.set('Authorization', auth);
		}

		// Bounded by `_eq` on the collection's one scope field and touching no other
		// collection, so the tag header below is the read's whole tag set.
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

			// The paired witness: without it the control below could pass because the
			// read fell back to the bare tag, not because the purge spared it.
			expect(keptSlice.headers[cacheTagsHeader])
			.toBe(`${SCOPED_CHILD}:owner=b`);

			const deleted = await request(url)
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

			// Every collection the rules reach, each named once: a collection purged
			// both by its own tags and collection-wide would appear twice. The deleted
			// row names its own key slice on top — the primary key pins every
			// collection, declared scope fields or not.
			expect(deleted.headers[purgedTagsHeader].split(', ').sort()).toEqual([
				CHILD,
				GRANDCHILD,
				NULLED,
				PARENT,
				`${PARENT}:id=${doomedRuleParent}`,
				SCOPED_CHILD,
				...(supportsSetDefault
					? [DEFAULTED]
					: []),
			].sort());
		});

		it.runIf(supportsSetDefault)(oneLine`
			a delete purges a collection whose foreign key it resets to a default
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [warmed, control] = await Promise.all([
				read(DEFAULTED),
				read(SIBLING),
			]);

			expect(warmed.headers[cacheStatusHeader]).toBe('MISS');
			expect(control.headers[cacheStatusHeader]).toBe('MISS');

			await request(url)
				.delete(`/items/${PARENT}/${doomedDefaultParent}`)
				.set('Authorization', auth);

			const [defaulted, controlAfter] = await Promise.all([
				read(DEFAULTED),
				read(SIBLING),
			]);

			expect(defaulted.headers[cacheStatusHeader]).toBe('MISS');

			// Unrelated to the parent, so a whole-namespace flush is the only thing
			// that would cool it.
			expect(controlAfter.headers[cacheStatusHeader]).toBe('HIT');

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

			const [branch, control] = await Promise.all([
				readSlice(SELF, 'branch'),
				read(SIBLING),
			]);

			expect(control.headers[cacheStatusHeader]).toBe('MISS');
			expect(branch.headers[cacheStatusHeader]).toBe('MISS');
			expect(branch.headers[cacheTagsHeader]).toBe(`${SELF}:owner=branch`);
			expect(branch.body.data).toHaveLength(1);

			await request(url)
				.delete(`/items/${SELF}/${selfRoot}`)
				.set('Authorization', auth);

			const [branchAfter, controlAfter] = await Promise.all([
				readSlice(SELF, 'branch'),
				read(SIBLING),
			]);

			// Nothing relates SIBLING to SELF, so this is what separates the purge
			// below from a whole-namespace flush.
			expect(controlAfter.headers[cacheStatusHeader]).toBe('HIT');

			// The service was handed the root key alone, so its snapshot never saw the
			// slice the branch row lived in — and the branch row went with the root.
			expect(branchAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(branchAfter.body.data).toHaveLength(0);
		});

		it(oneLine`
			keeps walking a collection a cascade reaches after a nullify already
			reported it, so what hangs below it is purged too
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [deep, shared, control] = await Promise.all([
				read(WALK_DEEP),
				read(WALK_SHARED),
				read(SIBLING),
			]);

			for (const response of [deep, shared, control]) {
				expect(response.headers[cacheStatusHeader]).toBe('MISS');
			}

			const deleted = await request(url)
				.delete(`/items/${WALK_ROOT}/${walkRoot}`)
				.set('Authorization', auth);

			const [deepAfter, sharedAfter, controlAfter] = await Promise.all([
				read(WALK_DEEP),
				read(WALK_SHARED),
				read(SIBLING),
			]);

			// The finding: the shared collection is reported by the root's own SET NULL
			// first. Retiring it from the walk there would leave this one unreached,
			// serving rows the cascade below has removed.
			expect(deepAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(sharedAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(controlAfter.headers[cacheStatusHeader]).toBe('HIT');

			expect(deepAfter.body.data).toHaveLength(0);

			// One of the two went with the cascade, the other survived the nullify —
			// which is what makes the shared collection reachable both ways.
			expect(sharedAfter.body.data).toHaveLength(1);
			expect(sharedAfter.body.data[0].root).toBe(null);

			expect(deleted.headers[purgedTagsHeader].split(', ').sort()).toEqual([
				WALK_ROOT,
				`${WALK_ROOT}:id=${walkRoot}`,
				WALK_MID,
				WALK_SHARED,
				WALK_DEEP,
			].sort());
		});

		it(oneLine`
			reports both collections of a cascade cycle and terminates, rather than
			following the cycle round again
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [child, control] = await Promise.all([
				read(CYCLE_B),
				read(SIBLING),
			]);

			expect(child.headers[cacheStatusHeader]).toBe('MISS');
			expect(control.headers[cacheStatusHeader]).toBe('MISS');

			// Returning at all is half the assertion: the walk revisits the root
			// through the cycle, and only the seeded walk set stops it there.
			const deleted = await request(url)
				.delete(`/items/${CYCLE_A}/${cycleRoot}`)
				.set('Authorization', auth);

			const [childAfter, controlAfter] = await Promise.all([
				read(CYCLE_B),
				read(SIBLING),
			]);

			expect(childAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(controlAfter.headers[cacheStatusHeader]).toBe('HIT');
			expect(childAfter.body.data).toHaveLength(0);

			// Each collection once, the root included: coming back round to it must
			// not name it a second time. And the root's own key slice is gone with it —
			// the cycle names the root a collection the delete CHANGED, which purges
			// every slice it has, so pinning the deleted row on top would be naming
			// keys the wider purge already covers.
			expect(deleted.headers[purgedTagsHeader].split(', ').sort()).toEqual([
				CYCLE_A,
				CYCLE_B,
			].sort());
		});

		it(oneLine`
			names a leaf two cascade paths both reach exactly once
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [leaf, control] = await Promise.all([
				read(DIAMOND_LEAF),
				read(SIBLING),
			]);

			expect(leaf.headers[cacheStatusHeader]).toBe('MISS');
			expect(control.headers[cacheStatusHeader]).toBe('MISS');

			const deleted = await request(url)
				.delete(`/items/${DIAMOND_ROOT}/${diamondRoot}`)
				.set('Authorization', auth);

			const [leafAfter, controlAfter] = await Promise.all([
				read(DIAMOND_LEAF),
				read(SIBLING),
			]);

			expect(leafAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(controlAfter.headers[cacheStatusHeader]).toBe('HIT');
			expect(leafAfter.body.data).toHaveLength(0);

			const purged = deleted.headers[purgedTagsHeader].split(', ');

			// A purge naming a collection twice pays for the whole scan twice, and the
			// sorted comparison below is the only thing that would notice.
			expect(purged.filter((tag: string) => tag === DIAMOND_LEAF))
				.toHaveLength(1);

			expect(purged.sort()).toEqual([
				DIAMOND_ROOT,
				`${DIAMOND_ROOT}:id=${diamondRoot}`,
				DIAMOND_LEFT,
				DIAMOND_RIGHT,
				DIAMOND_LEAF,
			].sort());
		});
	});
});
