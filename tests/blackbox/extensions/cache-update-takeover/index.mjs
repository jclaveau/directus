// Update hooks taking a row over, for cache-update-takeover.test.ts. Each writes
// the row it takes over itself, through the update's transaction, so the scoped
// cache has to purge it whatever Directus does next.
//
//   body 'take-over-twice' (test_takeover_refused) → writes the group's first row
//     'taken-over' and answers with it twice, which Directus refuses, taking the
//     write back.
//   body 'take-over-twice' (test_takeover_refused_pooled) → the same, written
//     through the extension's `database`, the pool, so the write is committed
//     whether Directus accepts the answer or not.
//   body 'take-over-sibling' (test_takeover_upsert_child) → writes the row marked
//     'sibling' 'taken-over' and adds it to the answer, a row the upsert never sent.
//   body 'take-over-inert' (test_takeover_inert, test_takeover_inert_big) →
//     writes nothing, declares the row inert through skipPurgeFor with a zero
//     leading its key, and takes it over.
//   body 'move-to-b' (test_takeover_moved) → moves its rows to slot 'b' and takes
//     them over, declaring nothing.
//   body 'move-both' (test_takeover_partly_declared) → moves its first row to slot
//     'c' and its second to 'd', takes both over, and declares the slice only the
//     first row left.
//   body 'write-then-throw' (test_takeover_hook_threw) → writes the row
//     'written-by-hook' through the extension's `database`, declares the
//     collection whole through purgeBy, then throws.
//   body 'take-over' (test_takeover_create_failed), on create → writes the row
//     marked 'taken' 'taken-over' through the extension's `database` and takes
//     it over. The create's other row reuses a stored key, so its insert fails.
//   body 'take-over' (test_takeover_nested_child), on create → the same on the
//     row marked 'taken', the create nested in a parent's update.
//   body 'write-then-throw' (test_takeover_nested_child) → the same as on
//     test_takeover_hook_threw, the update nested in a parent's update.
//   body 'take-over-inert' (test_takeover_create_declared), on create → writes
//     nothing, takes the seeded row over declaring it inert through
//     skipPurgeFor, and declares test_takeover_create_foreign through purgeBy.

import { mapCreateRows } from '@directus/utils';

const refusedCollection = 'test_takeover_refused';
const pooledCollection = 'test_takeover_refused_pooled';
const upsertChildCollection = 'test_takeover_upsert_child';
const inertCollection = 'test_takeover_inert';
const bigInertCollection = 'test_takeover_inert_big';
const movedCollection = 'test_takeover_moved';
const partlyDeclaredCollection = 'test_takeover_partly_declared';
const hookThrewCollection = 'test_takeover_hook_threw';
const createFailedCollection = 'test_takeover_create_failed';
const nestedChildCollection = 'test_takeover_nested_child';
const createDeclaredCollection = 'test_takeover_create_declared';
const createForeignCollection = 'test_takeover_create_foreign';

export default function registerHooks({ filter }, { database }) {
	const takeOverTwiceThrough = (collection, writerOf) => {
		return async (groups, _meta, context) => {
			const takenOverGroup = groups.find((group) => {
				return group?.data?.body === 'take-over-twice';
			});

			if (!takenOverGroup) {
				return groups;
			}

			const [takenOverKey] = takenOverGroup.keys;

			await writerOf(context)(collection)
				.where({ id: takenOverKey })
				.update({ body: 'taken-over' });

			return [{ key: takenOverKey }, { key: takenOverKey }];
		};
	};

	filter(
		`${refusedCollection}.items.update`,
		takeOverTwiceThrough(refusedCollection, ({ transaction }) => transaction),
	);

	filter(
		`${pooledCollection}.items.update`,
		takeOverTwiceThrough(pooledCollection, () => database),
	);

	filter(
		`${upsertChildCollection}.items.update`,
		async (groups, _meta, { transaction }) => {
			const takesOverSibling = groups.some((group) => {
				return group?.data?.body === 'take-over-sibling';
			});

			if (!takesOverSibling) {
				return groups;
			}

			const siblingRow = await transaction(upsertChildCollection)
				.where({ marker: 'sibling' })
				.first();

			await transaction(upsertChildCollection)
				.where({ id: siblingRow.id })
				.update({ body: 'taken-over' });

			return [...groups, { key: siblingRow.id }];
		},
	);

	const takeOverInert = async (groups, _meta, { scopedCache }) => {
		const inertGroup = groups.find((group) => {
			return group?.data?.body === 'take-over-inert';
		});

		if (!inertGroup) {
			return groups;
		}

		return inertGroup.keys.map((key) => {
			scopedCache.skipPurgeFor(`0${key}`);

			return { key };
		});
	};

	filter(`${inertCollection}.items.update`, takeOverInert);
	filter(`${bigInertCollection}.items.update`, takeOverInert);

	filter(
		`${movedCollection}.items.update`,
		async (groups, _meta, { transaction }) => {
			const movedGroup = groups.find((group) => {
				return group?.data?.body === 'move-to-b';
			});

			if (!movedGroup) {
				return groups;
			}

			await transaction(movedCollection)
				.whereIn('id', movedGroup.keys)
				.update({ slot: 'b', body: 'moved' });

			return movedGroup.keys.map((key) => ({ key }));
		},
	);

	filter(
		`${partlyDeclaredCollection}.items.update`,
		async (groups, _meta, { transaction, scopedCache }) => {
			const movedGroup = groups.find((group) => {
				return group?.data?.body === 'move-both';
			});

			if (!movedGroup) {
				return groups;
			}

			const [declaredKey, undeclaredKey] = movedGroup.keys;

			await transaction(partlyDeclaredCollection)
				.where({ id: declaredKey })
				.update({ slot: 'c', body: 'moved' });

			await transaction(partlyDeclaredCollection)
				.where({ id: undeclaredKey })
				.update({ slot: 'd', body: 'moved' });

			scopedCache.purgeBy(
				{ collection: partlyDeclaredCollection, pinnedScope: { slot: ['a'] } },
				{ forKey: declaredKey },
			);

			return movedGroup.keys.map((key) => ({ key }));
		},
	);

	filter(
		`${hookThrewCollection}.items.update`,
		async (groups, _meta, { scopedCache }) => {
			const throwingGroup = groups.find((group) => {
				return group?.data?.body === 'write-then-throw';
			});

			if (!throwingGroup) {
				return groups;
			}

			await database(hookThrewCollection)
				.whereIn('id', throwingGroup.keys)
				.update({ body: 'written-by-hook' });

			scopedCache.purgeBy({ collection: hookThrewCollection });

			throw new Error('The body "write-then-throw" is refused');
		},
	);

	const takeOverMarkedTaken = (collection) => {
		return (entries) => {
			return mapCreateRows(entries, async (payload) => {
				if (payload?.body !== 'take-over') {
					return payload;
				}

				const takenRow = await database(collection)
					.where({ marker: 'taken' })
					.first();

				await database(collection)
					.where({ id: takenRow.id })
					.update({ body: 'taken-over' });

				return takenRow.id;
			});
		};
	};

	filter(
		`${createFailedCollection}.items.create`,
		takeOverMarkedTaken(createFailedCollection),
	);

	filter(
		`${nestedChildCollection}.items.create`,
		takeOverMarkedTaken(nestedChildCollection),
	);

	filter(
		`${nestedChildCollection}.items.update`,
		async (groups, _meta, { scopedCache }) => {
			const throwingGroup = groups.find((group) => {
				return group?.data?.body === 'write-then-throw';
			});

			if (!throwingGroup) {
				return groups;
			}

			await database(nestedChildCollection)
				.whereIn('id', throwingGroup.keys)
				.update({ body: 'written-by-hook' });

			scopedCache.purgeBy({ collection: nestedChildCollection });

			throw new Error('The body "write-then-throw" is refused');
		},
	);

	filter(
		`${createDeclaredCollection}.items.create`,
		(entries, _meta, { scopedCache }) => {
			return mapCreateRows(entries, async (payload) => {
				if (payload?.body !== 'take-over-inert') {
					return payload;
				}

				const inertRow = await database(createDeclaredCollection).first();

				scopedCache.skipPurgeFor(inertRow.id);
				scopedCache.purgeBy({ collection: createForeignCollection });

				return inertRow.id;
			});
		},
	);
}
