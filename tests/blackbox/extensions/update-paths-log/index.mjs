// Records that an update event fired for the probe collection, so
// update-paths.test.ts can tell an ordinary update from one run with
// `emitEvents: false`.
//
// Every extension here loads into every instance, so this reacts only to its own
// collection and swallows its own failures: the log table exists for this suite
// alone, and a throwing hook would take unrelated shards down with it.

const COLLECTION = 'test_update_paths';
const LOG = 'test_update_paths_log';

export default function registerHooks({ filter, action }, { database }) {
	async function record(phase) {
		try {
			await database(LOG).insert({ phase });
		}
		catch {
			// Not this suite: the log table isn't there.
		}
	}

	filter(`${COLLECTION}.items.update`, async (payload) => {
		await record('filter');

		return payload;
	});

	action(`${COLLECTION}.items.update`, async () => {
		await record('action');
	});
}
