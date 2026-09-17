// A read hook that writes: the cache audit's `raced` witness. Once the flag row
// is armed, the next read of RACE moves a row through the API — which purges
// the very entry the audit is replaying — and answers the moved value. The
// audit then sees a diff over an entry that is gone, and calls it raced: the
// purge doing its job under the replay, not staleness.

const RACE = 'test_cache_audit_race';
const RACE_FLAG = 'test_cache_audit_race_flag';

export default function registerHooks({ filter }, { services, database }) {
	filter(`${RACE}.items.read`, async (records, _meta, context) => {
		const flag = await context.database(RACE_FLAG).first('id', 'armed');

		// Seeded after RACE, and armed once: the create's own read-back and every
		// read after the race find nothing to do.
		if (flag === undefined || flag.armed !== 'yes') {
			return records;
		}

		await database(RACE_FLAG).where({ id: flag.id })
			.update({ armed: 'no' });

		const rows = new services.ItemsService(RACE, {
			schema: context.schema,
			knex: database,
		});

		for (const record of records) {
			await rows.updateOne(record.id, { amount: 'moved' });
		}

		return records.map((record) => ({ ...record, amount: 'moved' }));
	});
}
