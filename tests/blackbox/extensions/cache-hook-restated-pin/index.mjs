// A read hook restating a pin the read already computed
// (cache-hook-restated-pin-view.test.ts). Each read of one row by its key adds the
// row's `bio`, which the read never selected, and names the row it read it from
// through one of the two hook channels. The pin is the one the read computed for
// its own key, so it only reaches the index if the collection loses its view.

const DEPEND_ON = 'hook_restated_depend_on';
const CACHE_SCOPE = 'hook_restated_cache_scope';

export default function registerHooks({ filter }, { services }) {
	const serviceOf = (collection, context) => {
		return new services.ItemsService(collection, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});
	};

	filter(`${DEPEND_ON}.items.read`, async (records, _meta, context) => {
		for (const record of records) {
			const [row] = await context.scopedCache.dependOn(
				serviceOf(DEPEND_ON, context).readByQuery(
					{ filter: { id: { _eq: record.id } }, fields: ['bio'], limit: 1 },
					{ emitEvents: false },
				),
			);

			record.bio = row.bio;
		}

		return records;
	});

	filter(`${CACHE_SCOPE}.items.read`, async (records, _meta, context) => {
		for (const record of records) {
			const [row] = await serviceOf(CACHE_SCOPE, context).readByQuery(
				{ filter: { id: { _eq: record.id } }, fields: ['bio'], limit: 1 },
				{ emitEvents: false },
			);

			record.bio = row.bio;
		}

		return records;
	});

	filter('cache.scope', (pins, meta) => {
		if (meta.collection !== CACHE_SCOPE) {
			return pins;
		}

		return [
			...pins,
			...meta.records.map((record) => {
				return { collection: CACHE_SCOPE, field: 'id', value: record.id };
			}),
		];
	});
}
