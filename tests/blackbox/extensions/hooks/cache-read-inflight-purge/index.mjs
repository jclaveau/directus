// A `<coll>.items.read` filter fires with the rows ALREADY fetched, so a write from
// here commits after the read's snapshot and before respond caches it — the
// in-flight window, made deterministic. The purge it raises cannot reach an entry
// not indexed yet, so unguarded the fill stores rows already superseded.

const COLLECTION = 'read_inflight_purge';

let alreadyFired = false;

export default function registerHooks({ filter }, { services }) {
	filter(`${COLLECTION}.items.read`, async (payload, _meta, context) => {
		// Set before the await so the mutation's own reads cannot re-enter, and so
		// the test's second read runs against an untouched hook.
		if (alreadyFired) {
			return payload;
		}

		alreadyFired = true;

		const [row] = payload;

		if (!row) {
			return payload;
		}

		await new services.ItemsService(COLLECTION, {
			schema: context.schema,
			knex: context.database,
		}).updateOne(row.id, { label: 'v2' });

		return payload;
	});
}
