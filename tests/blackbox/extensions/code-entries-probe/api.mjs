// A bundle declaring its entries in code, the way `defineBundleApi` builds
// them: an endpoint reporting what the bundle's migration left behind.
export default {
	format: 'scalabus/1',
	entries: [
		{
			type: 'endpoint',
			name: 'code-entries-probe',
			config: (router, { database }) => {
				router.get('/', async (_req, res) => {
					const migrationRow = await database('directus_migrations')
						.select('version')
						.where('version', 'code-entries-probe:20990101A')
						.first();

					res.json({
						data: {
							table_exists: await database.schema.hasTable('code_entries_probe'),
							migration_version: migrationRow?.version ?? null,
						},
					});
				});
			},
		},
		{
			type: 'migration',
			name: '20990101A-create-probe-table',
			config: {
				phase: 'before-schema',
				up: async (knex) => {
					await knex.schema.createTable('code_entries_probe', (table) => {
						table.increments('id');
					});
				},
				down: async (knex) => {
					await knex.schema.dropTable('code_entries_probe');
				},
			},
		},
	],
};
