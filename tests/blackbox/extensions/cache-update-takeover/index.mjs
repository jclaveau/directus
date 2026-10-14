// Update hooks taking a row over, for cache-update-takeover.test.ts. Each writes
// the row it takes over itself, out of band, so the scoped cache has to purge it
// whatever Directus does next.
//
//   body 'take-over-twice' (test_takeover_refused) → writes the group's first row
//     'taken-over' and answers with it twice, which Directus refuses.
//   body 'take-over-sibling' (test_takeover_upsert_child) → writes the row marked
//     'sibling' 'taken-over' and adds it to the answer, a row the upsert never sent.
//   body 'take-over-inert' (test_takeover_inert) → writes nothing, declares the
//     row inert through skipPurgeFor with a zero leading its key, and takes it over.

const REFUSED = 'test_takeover_refused';
const UPSERT_CHILD = 'test_takeover_upsert_child';
const INERT = 'test_takeover_inert';

export default function registerHooks({ filter }) {
	filter(`${REFUSED}.items.update`, async (groups, _meta, { database }) => {
		const takenOverGroup = groups.find((group) => {
			return group?.data?.body === 'take-over-twice';
		});

		if (!takenOverGroup) {
			return groups;
		}

		const [takenOverKey] = takenOverGroup.keys;

		await database(REFUSED)
			.where({ id: takenOverKey })
			.update({ body: 'taken-over' });

		return [{ key: takenOverKey }, { key: takenOverKey }];
	});

	filter(`${UPSERT_CHILD}.items.update`, async (groups, _meta, { database }) => {
		const takesOverSibling = groups.some((group) => {
			return group?.data?.body === 'take-over-sibling';
		});

		if (!takesOverSibling) {
			return groups;
		}

		const sibling = await database(UPSERT_CHILD)
			.where({ marker: 'sibling' })
			.first();

		await database(UPSERT_CHILD)
			.where({ id: sibling.id })
			.update({ body: 'taken-over' });

		return [...groups, { key: sibling.id }];
	});

	filter(`${INERT}.items.update`, async (groups, _meta, { scopedCache }) => {
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
	});
}
