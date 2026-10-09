// Records what the create events actually deliver, for create-groups.test.ts.
//
// Every extension here loads into every instance, so this one only reacts to
// its own collection and swallows its own failures: the log table exists for
// this suite alone, and a throwing filter would take unrelated suites down.
//
// The grouped filter acts on a row's name:
//   'legacy-shape'  → answers with that row's payload alone, the shape the
//     event had before it carried entries.
//   'twin-of-first' → answers { sameRowAs: 0 }, the row the create starts with.
//   'cancel-in-group' → answers null for that row.
//   'strip-name' → deletes `name` off the list, the way a hook written for one
//     payload strips a field.
//   'check-name' → reads `name` off the list, the way a hook written for one
//     payload refuses a value.
//   'take-over' → inserts that row itself and answers { key } with its id,
//     taking the row over.

const COLLECTION = 'test_create_groups';
const LOG = 'test_create_groups_log';

export default function registerHooks({ filter, action }, { database }) {
	async function record(event, phase, payload) {
		try {
			await database(LOG).insert({
				event,
				phase,
				payload: JSON.stringify(payload ?? null),
			});
		}
		catch {
			// Not this suite: the log table isn't there.
		}
	}

	filter(`${COLLECTION}.items.create`, async (entries) => {
		await record('items.create', 'filter', entries);

		if (!Array.isArray(entries)) {
			return entries;
		}

		const names = entries.map((entry) => entry?.data?.name);

		if (names.includes('strip-name')) {
			delete entries.name;

			return entries;
		}

		if (names.includes('check-name')) {
			if (entries.name === 'check-name') {
				throw new Error('The name "check-name" is refused');
			}

			return entries;
		}

		const legacyEntry = entries.find((entry) => {
			return entry?.data?.name === 'legacy-shape';
		});

		if (legacyEntry) {
			return legacyEntry.data;
		}

		return Promise.all(entries.map(async (entry) => {
			if (entry?.data?.name === 'take-over') {
				const [insertedRow] = await database(COLLECTION)
					.insert({ name: 'take-over' }, ['id']);

				return { key: insertedRow.id };
			}

			if (entry?.data?.name === 'twin-of-first') {
				return { sameRowAs: 0 };
			}

			if (entry?.data?.name === 'cancel-in-group') {
				return null;
			}

			return entry;
		}));
	});

	filter(`${COLLECTION}.items.create.one`, async (payload) => {
		await record('items.create.one', 'filter', payload);

		return payload;
	});

	action(`${COLLECTION}.items.create`, async (meta) => {
		await record('items.create', 'action', meta.payload);
	});

	action(`${COLLECTION}.items.create.one`, async (meta) => {
		await record('items.create.one', 'action', meta.payload);
	});
}
