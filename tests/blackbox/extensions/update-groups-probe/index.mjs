// Records what the update events actually deliver, for update-groups.test.ts.
//
// Every extension here loads into every instance, so this one only reacts to
// its own collection and swallows its own failures: the log table exists for
// this suite alone, and a throwing filter would take unrelated suites down.
//
// Row markers drive the behaviours end to end, so the test needs no control
// endpoint:
//   name 'cancel-me'  → the grouped filter's mapUpdateRows returns null for that
//     row, cancelling it.
//   name 'rewrite-me' → mapUpdateRows rewrites that row, splitting its group.
//   status 'legacy-shape' → the grouped filter answers with that group's
//     payload alone, the shape it had before the event carried groups.
//   status 'drop-key' → the grouped filter drops that group's first key,
//     cancelling that row.
//   status 'strip-name' → the grouped filter deletes `name` off the list, the
//     way a hook written for one payload strips a field.
//   status 'check-status' → the grouped filter reads `status` off the list, the
//     way a hook written for one payload refuses a value.
// The name is read back from the row, since the event carries only what is
// being written. The per-row events are recorded so the suite can show none
// fires.

import { mapUpdateRows } from '@directus/utils';

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

		const statuses = Array.isArray(payload)
			? payload.map((group) => group?.data?.status)
			: [];

		if (statuses.includes('strip-name')) {
			delete payload.name;

			return payload;
		}

		if (statuses.includes('check-status')) {
			if (payload.status === 'check-status') {
				throw new Error('The status "check-status" is refused');
			}

			return payload;
		}

		const legacyGroup = Array.isArray(payload)
			? payload.find((group) => group?.data?.status === 'legacy-shape')
			: undefined;

		if (legacyGroup) {
			return legacyGroup.data;
		}

		if (!Array.isArray(payload)) {
			return payload;
		}

		const groups = payload.map((group) => {
			return group?.data?.status === 'drop-key'
				? { ...group, keys: group.keys.slice(1) }
				: group;
		});

		return mapUpdateRows(groups, async (data, key) => {
			const row = await database(COLLECTION)
				.where({ id: key })
				.first();

			if (row?.name === 'cancel-me') {
				return null;
			}

			if (row?.name === 'rewrite-me') {
				return { ...data, name: 'rewritten' };
			}

			return data;
		});
	});

	filter(`${COLLECTION}.items.update.one`, async (payload) => {
		await record('items.update.one', 'filter', payload);

		return payload;
	});

	action(`${COLLECTION}.items.update`, async (meta) => {
		await record('items.update', 'action', meta.payload);
	});

	action(`${COLLECTION}.items.update.one`, async (meta) => {
		await record('items.update.one', 'action', meta.payload);
	});
}
