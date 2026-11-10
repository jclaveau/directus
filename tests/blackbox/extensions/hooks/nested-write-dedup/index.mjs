// The planner's Model deduplication (directus-model.ts), cut to one unicity field,
// for nested-write-dedup.feature. A schedule segment is unique by `name`; the
// create filter of test_nwd_segment, as the planner's segment hook does:
//   1. refuses a create whose rows share a name (refuseRowsSharingUnicity);
//   2. answers a row whose name is stored with that row's key, in one read for
//      the whole create (updateIfDuplicated, nothing to update here).
// The read runs on the mutation's transaction, so a segment inserted earlier in
// the same request counts as stored.

import { RecordNotUniqueError } from '@directus/errors';

const SEGMENT_COLLECTION = 'test_nwd_segment';

export default function registerHooks({ filter }, { services }) {
	filter(`${SEGMENT_COLLECTION}.items.create`, async (entries, _meta, context) => {
		if (!Array.isArray(entries)) {
			return entries;
		}

		const segmentNames = entries.flatMap((entry) => {
			return entry && 'data' in entry
				? [entry.data.name]
				: [];
		});

		const seenNames = new Set();

		for (const segmentName of segmentNames) {
			if (seenNames.has(segmentName)) {
				throw new RecordNotUniqueError({
					collection: SEGMENT_COLLECTION,
					field: 'name',
					value: segmentName,
				});
			}

			seenNames.add(segmentName);
		}

		if (segmentNames.length === 0) {
			return entries;
		}

		const storedSegments = await new services.ItemsService(SEGMENT_COLLECTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.transaction,
		}).readByQuery(
			{
				filter: { name: { _in: segmentNames } },
				fields: ['id', 'name'],
				limit: -1,
			},
			{ emitEvents: false },
		);

		const storedKeysByName = new Map(storedSegments.map((storedSegment) => {
			return [storedSegment.name, storedSegment.id];
		}));

		return entries.map((entry) => {
			if (!entry || !('data' in entry)) {
				return entry;
			}

			const storedKey = storedKeysByName.get(entry.data.name);

			return storedKey === undefined
				? entry
				: { key: storedKey };
		});
	});
}
