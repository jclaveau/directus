// A read hook restating a pin the read already computed
// (cache-hook-restated-pin-view.test.ts). Each read of one row by its key adds the
// row's `bio`, which the read never selected, and names the row it read it from
// through one of the two hook channels. The pin is the one the read computed for
// its own key, so it only reaches the index if the collection loses its view.
//
// `bio` is read with the raw knex, as enrichment outside the AST does: a read
// through the service would file its own view of `bio` beside the read's.

const DEPEND_ON = 'hook_restated_depend_on';
const CACHE_SCOPE = 'hook_restated_cache_scope';

export default function registerHooks({ filter }, { services }) {
	const bioOf = async (collection, id, context) => {
		const row = await context.database(collection)
			.where({ id })
			.first('bio');

		return row.bio;
	};

	filter(`${DEPEND_ON}.items.read`, async (records, _meta, context) => {
		for (const record of records) {
			// The lookup names the row by its key and selects nothing the read did
			// not: all it adds is the pin.
			const service = new services.ItemsService(DEPEND_ON, {
				schema: context.schema,
				accountability: context.accountability,
				knex: context.database,
			});

			await context.scopedCache.dependOn(
				service.readByQuery(
					{ filter: { id: { _eq: record.id } }, fields: ['id'], limit: 1 },
					{ emitEvents: false },
				),
			);

			record.bio = await bioOf(DEPEND_ON, record.id, context);
		}

		return records;
	});

	filter(`${CACHE_SCOPE}.items.read`, async (records, _meta, context) => {
		for (const record of records) {
			record.bio = await bioOf(CACHE_SCOPE, record.id, context);
		}

		return records;
	});

	filter('cache.scope', (pins, meta) => {
		if (meta.collection !== CACHE_SCOPE) {
			return pins;
		}

		// Copies of the read's own key pins: a pin built from `record.id` would
		// carry the value in another form than the key the read computed, and so be
		// a new pin, which dropped the view even before the fix.
		return [
			...pins,
			...pins
				.filter((pin) => pin.collection === CACHE_SCOPE)
				.map((pin) => ({ ...pin })),
		];
	});
}
