// Records what the update events actually deliver, for batch-update-groups.test.ts.
//
// Every extension here loads into every instance, so this one only reacts to
// its own collection and swallows its own failures: the log table exists for
// this suite alone, and a throwing filter would take unrelated suites down.
//
// Two row payloads drive the per-row behaviours end to end, so the test needs no
// control endpoint:
//   name 'cancel-me'  → the per-row filter returns null, cancelling that row.
//   name 'rewrite-me' → the per-row filter rewrites it, splitting its group.

const COLLECTION = 'test_update_groups';
const LOG = 'test_update_groups_log';

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

	filter(`${COLLECTION}.items.update`, async (payload) => {
		await record('items.update', 'filter', payload);

		return payload;
	});

	filter(`${COLLECTION}.items.update.one`, async (payload) => {
		await record('items.update.one', 'filter', payload);

		if (payload.name === 'cancel-me') {
			return null;
		}

		if (payload.name === 'rewrite-me') {
			return { ...payload, name: 'rewritten' };
		}

		return payload;
	});

	action(`${COLLECTION}.items.update`, async (meta) => {
		await record('items.update', 'action', meta.payload);
	});

	action(`${COLLECTION}.items.update.one`, async (meta) => {
		await record('items.update.one', 'action', meta.payload);
	});
}
