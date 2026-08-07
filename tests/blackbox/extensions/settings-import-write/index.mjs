// Stands in for a config-sync tool importing the settings singleton
// (cache-config-broadcast.test.ts). Such a tool writes through a plain
// `ItemsService('directus_settings')`, never through `SettingsService`, so every
// guarantee bolted onto that subclass is silently skipped — which is how a
// `cache_ttl` reset reached the DB in production while the running nodes kept
// serving the previous value.
//
// Over HTTP there is no other way to reach that path: `PATCH /settings` always
// routes through `SettingsService`. Hence this endpoint.
//   POST /   { "cache_ttl": "<duration>" | null }

export default function registerEndpoint(router, { services, database, getSchema }) {
	router.post('/', async (req, res) => {
		// A bare route has no asyncHandler wrapper, so a throw here is an unhandled
		// rejection and takes the whole test shard down with the server.
		try {
			const schema = await getSchema();

			const settingsService = new services.ItemsService('directus_settings', {
				schema,
				knex: database,
			});

			const cacheTtl = req.body.cache_ttl ?? null;
			await settingsService.upsertSingleton({ cache_ttl: cacheTtl });

			res.json({ cache_ttl: cacheTtl });
		}
		catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});
}
