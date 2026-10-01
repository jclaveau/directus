// The one-shot sibling (cache-read-inflight-purge) crosses ONE read. This one
// crosses every read that comes through, so a burst of concurrent reads ends in as
// many concurrent guarded evictions — the load that made two evictions probe the
// store under one shared key and read each other's delete as a swallowed write
// (https://github.com/jclaveau/directus/issues/507).

const COLLECTION = 'read_inflight_burst';

export default function registerHooks({ filter }, { services }) {
	filter(`${COLLECTION}.items.read`, async (payload, _meta, context) => {
		// The service below carries no accountability, so this is how its own reads
		// are told from the requests being crossed.
		if (!context.accountability) {
			return payload;
		}

		const [row] = payload;

		if (!row) {
			return payload;
		}

		await new services.ItemsService(COLLECTION, {
			schema: context.schema,
			knex: context.database,
		}).updateOne(row.id, { label: `crossed-${Date.now()}` });

		return payload;
	});
}
