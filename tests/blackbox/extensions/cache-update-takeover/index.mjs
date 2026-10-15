// Update hooks taking a row over, for cache-update-takeover.test.ts. Each writes
// the row it takes over itself, through the update's transaction, so the scoped
// cache has to purge it whatever Directus does next.
//
//   body 'take-over-twice' (test_takeover_refused) → writes the group's first row
//     'taken-over' and answers with it twice, which Directus refuses, taking the
//     write back.
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

const refusedCollection = 'test_takeover_refused';
const upsertChildCollection = 'test_takeover_upsert_child';
const inertCollection = 'test_takeover_inert';
const bigInertCollection = 'test_takeover_inert_big';
const movedCollection = 'test_takeover_moved';
const partlyDeclaredCollection = 'test_takeover_partly_declared';

export default function registerHooks({ filter }) {
	filter(
		`${refusedCollection}.items.update`,
		async (groups, _meta, { transaction }) => {
			const takenOverGroup = groups.find((group) => {
				return group?.data?.body === 'take-over-twice';
			});

			if (!takenOverGroup) {
				return groups;
			}

			const [takenOverKey] = takenOverGroup.keys;

			await transaction(refusedCollection)
				.where({ id: takenOverKey })
				.update({ body: 'taken-over' });

			return [{ key: takenOverKey }, { key: takenOverKey }];
		},
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
}
