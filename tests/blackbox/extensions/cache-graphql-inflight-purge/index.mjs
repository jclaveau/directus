// The REST sibling of this window (cache-read-inflight-purge) is closed by comparing
// the purge counters a read captured before its query against the ones at fill time.
// A `/graphql` response is one cached entry assembled from several reads, and the
// aggregate GraphQLService hands to `respond` carries the tags of all of them — so
// unless it carries their counters too, the comparison has nothing to compare and
// every GraphQL entry is filled unguarded.
//
// Same deterministic seam as the REST case: a `<coll>.items.read` filter fires with
// the rows already fetched, so a write from here commits after the read's snapshot
// and before respond caches it.

const COLLECTION = 'gql_inflight_purge';

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
