// A read hook that waits: the cache audit's in-flight witness. Once the flag
// row is armed, the next read of HOLD — the replay — answers after a pause
// long enough for the history to list the run open and for a second run asked
// for meanwhile to be refused by it.

const HOLD = 'test_cache_audit_hold';
const HOLD_FLAG = 'test_cache_audit_hold_flag';
const HOLD_MS = 6000;

export default function registerHooks({ filter }, { database }) {
	filter(`${HOLD}.items.read`, async (records, _meta, context) => {
		const flag = await context.database(HOLD_FLAG).first('id', 'armed');

		// Seeded after HOLD, and armed once: the create's own read-back and every
		// read after the held one answer at once.
		if (flag === undefined || flag.armed !== 'yes') {
			return records;
		}

		await database(HOLD_FLAG).where({ id: flag.id })
			.update({ armed: 'no' });

		await new Promise((resolve) => setTimeout(resolve, HOLD_MS));

		return records;
	});
}
