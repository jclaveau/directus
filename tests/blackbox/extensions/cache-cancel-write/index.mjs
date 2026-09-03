// Cancel (return null) on UPDATE and DELETE against the scoped cache
// (cache-cancel-write.test.ts). A create veto is covered in cache-takeover-scope;
// this covers the other two mutation events. A pure veto changed nothing → no purge.
// A veto that declared a slice via `scopedCache.purgeBy` still purges it — a cancel
// can touch state out of band — matching the create cancel path and #292's fix.
//
//   editable.items.update:
//     - note 'reject' → veto, declare nothing → no purge.
//     - note 'flag'   → veto, but declare the row's space slice → precise purge.
//   removable.items.delete (signal read off the row, since DELETE has no body):
//     - mode 'protect' → veto, declare nothing → no purge, row survives.
//     - mode 'flag'    → veto, but declare the row's space slice → precise purge.

const EDITABLE = 'test_items_editable';
const REMOVABLE = 'test_items_removable';

function serviceFor(services, collection, context) {
	return new services.ItemsService(collection, {
		schema: context.schema,
		accountability: context.accountability,
		knex: context.database,
	});
}

// Purge the collection's own `space` slice, reusing a lookup's returned tags so the
// declaration can't drift from the cached slice.
async function purgeSpaceSlice(service, space, context) {
	const affected = await service.readByQuery(
		{ filter: { space: { _eq: space } }, fields: ['id'], limit: 1 },
		{ emitEvents: false },
	);

	context.scopedCache?.purgeBy(affected.getMeta?.()?.scopedCacheTags ?? []);
}

export default function registerHooks({ filter }, { services }) {
	filter(`${EDITABLE}.items.update.one`, async (payload, _meta, context) => {
		if (payload.note !== 'reject' && payload.note !== 'flag') {
			return payload;
		}

		if (payload.note === 'flag') {
			const service = serviceFor(services, EDITABLE, context);

			const [row] = await service.readMany(
				[payload.id],
				{ fields: ['space'], limit: 1 },
				{ emitEvents: false },
			);

			if (row) {
				await purgeSpaceSlice(service, row.space, context);
			}
		}

		return null;
	});

	filter(`${REMOVABLE}.items.delete`, async (keys, _meta, context) => {
		const service = serviceFor(services, REMOVABLE, context);

		const [row] = await service.readMany(
			keys,
			{ fields: ['space', 'mode'], limit: 1 },
			{ emitEvents: false },
		);

		if (!row || (row.mode !== 'protect' && row.mode !== 'flag')) {
			return keys;
		}

		if (row.mode === 'flag') {
			await purgeSpaceSlice(service, row.space, context);
		}

		return null;
	});
}
