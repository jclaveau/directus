// The planner's Model deduplication (directus-model.ts), cut to one unicity field,
// for nested-write-dedup.feature. A schedule segment is unique by `name`; the
// create filter of test_nwd_segment:
//   1. answers a row repeating an earlier row's name with { sameRowAs } that row,
//      so rows of one create sharing a name become one row;
//   2. answers a row whose name is stored with that row's key, in one read for
//      the whole create (updateIfDuplicated, nothing to update here).
// The read runs on the mutation's transaction, so a segment inserted earlier in
// the same request counts as stored.

const SEGMENT_COLLECTION = 'test_nwd_segment';
const COURSE_SEGMENT_COLLECTION = 'test_nwd_course_segment';

// Only the junction-hook scenario's segments, so the other scenarios still hand
// every nested segment to the segment filter.
const JUNCTION_HOOK_PREFIX = 'jn-';

export default function registerHooks({ filter }, { services }) {
	// The planner's junction hook (student_schedule_segment--student_teaching-unit):
	// one read on the mutation's transaction, and a nested segment whose name is
	// stored becomes its key; a new one stays nested.
	const courseSegmentCreate = `${COURSE_SEGMENT_COLLECTION}.items.create`;

	filter(courseSegmentCreate, async (entries, _meta, context) => {
		if (!Array.isArray(entries)) {
			return entries;
		}

		const nestedNames = entries.flatMap((entry) => {
			const nestedSegment = entry && 'data' in entry
				? entry.data.segment
				: undefined;

			return typeof nestedSegment?.name === 'string'
				&& nestedSegment.name.startsWith(JUNCTION_HOOK_PREFIX)
				? [nestedSegment.name]
				: [];
		});

		if (nestedNames.length === 0) {
			return entries;
		}

		const storedSegments = await new services.ItemsService(SEGMENT_COLLECTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.transaction,
		}).readByQuery(
			{
				filter: { name: { _in: nestedNames } },
				fields: ['id', 'name'],
				limit: -1,
			},
			{ emitEvents: false },
		);

		const storedKeysByName = new Map(storedSegments.map((storedSegment) => {
			return [storedSegment.name, storedSegment.id];
		}));

		return entries.map((entry) => {
			const storedKey = entry && 'data' in entry
				? storedKeysByName.get(entry.data.segment?.name)
				: undefined;

			return storedKey === undefined
				? entry
				: { data: { ...entry.data, segment: storedKey } };
		});
	});

	filter(`${SEGMENT_COLLECTION}.items.create`, async (entries, _meta, context) => {
		if (!Array.isArray(entries)) {
			return entries;
		}

		const firstIndexByName = new Map();

		for (const [index, entry] of entries.entries()) {
			if (entry && 'data' in entry && !firstIndexByName.has(entry.data.name)) {
				firstIndexByName.set(entry.data.name, index);
			}
		}

		if (firstIndexByName.size === 0) {
			return entries;
		}

		const storedSegments = await new services.ItemsService(SEGMENT_COLLECTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.transaction,
		}).readByQuery(
			{
				filter: { name: { _in: [...firstIndexByName.keys()] } },
				fields: ['id', 'name'],
				limit: -1,
			},
			{ emitEvents: false },
		);

		const storedKeysByName = new Map(storedSegments.map((storedSegment) => {
			return [storedSegment.name, storedSegment.id];
		}));

		return entries.map((entry, index) => {
			if (!entry || !('data' in entry)) {
				return entry;
			}

			const firstIndex = firstIndexByName.get(entry.data.name);

			if (firstIndex !== index) {
				return { sameRowAs: firstIndex };
			}

			const storedKey = storedKeysByName.get(entry.data.name);

			return storedKey === undefined
				? entry
				: { key: storedKey };
		});
	});
}
