// The planner's Model deduplication (directus-model.ts), cut to one unicity field,
// for nested-write-dedup.feature and nested-write-dedup-cache.feature. A schedule
// segment is unique by `name`; the create filter of test_nwd_segment:
//   1. answers a row repeating an earlier row's name and every other field with
//      { sameRowAs } that row, so identical rows of one create become one row;
//      a row sharing the name but not every field is refused, as the unique
//      index would;
//   2. answers a row whose name is stored with that row's key, in one read for
//      the whole create (updateIfDuplicated, nothing to update here).
// The read runs on the mutation's transaction, so a segment inserted earlier in
// the same request counts as stored. test_nwdc_segment does the same, and a
// stored row whose payload changes its discipline or label is updated
// (updateIfDuplicated). Rows without a `name` count as one name.

import { RecordNotUniqueError } from '@directus/errors';

const SEGMENT_COLLECTION = 'test_nwd_segment';
const COURSE_SEGMENT_COLLECTION = 'test_nwd_course_segment';
const CACHED_SEGMENT_COLLECTION = 'test_nwdc_segment';
const UPDATABLE_SEGMENT_FIELDS = ['discipline', 'label'];

// Only the junction-hook scenarios' segments, so the other scenarios still hand
// every nested segment to the segment filter.
const JUNCTION_HOOK_PREFIXES = ['jn-', 'dp-'];

// A row's fields in key order, so two rows listing one payload in another
// order sign the same.
function rowSignatureOf(rowData) {
	const fieldNames = Object.keys(rowData).sort();

	return JSON.stringify(fieldNames.map((fieldName) => {
		return [fieldName, rowData[fieldName]];
	}));
}

// A row repeating the name of the row at firstIndex is that row when every
// field matches; otherwise the two would collide on the unique `name`.
function answerRepeatedRow(entries, firstIndex, index, collection) {
	const repeatedData = entries[index].data;

	if (
		rowSignatureOf(entries[firstIndex].data) !== rowSignatureOf(repeatedData)
	) {
		throw new RecordNotUniqueError({
			collection,
			field: 'name',
			value: repeatedData.name,
		});
	}

	return { sameRowAs: firstIndex };
}

export default function registerHooks({ filter }, { services }) {
	// The planner's junction hooks (student_schedule_segment--student_*): a row
	// repeating an earlier row's course and segment name answers { sameRowAs }
	// that row; one read on the mutation's transaction, and a nested segment
	// whose name is stored becomes its key; a new one stays nested.
	const courseSegmentCreate = `${COURSE_SEGMENT_COLLECTION}.items.create`;

	filter(courseSegmentCreate, async (entries, _meta, context) => {
		if (!Array.isArray(entries)) {
			return entries;
		}

		const firstIndexByLink = new Map();

		for (const [index, entry] of entries.entries()) {
			const nestedName = entry && 'data' in entry
				? entry.data.segment?.name
				: undefined;

			const courseSegmentLink = JSON.stringify([entry?.data?.course, nestedName]);

			if (
				typeof nestedName === 'string'
				&& JUNCTION_HOOK_PREFIXES.some((junctionPrefix) => {
					return nestedName.startsWith(junctionPrefix);
				})
				&& !firstIndexByLink.has(courseSegmentLink)
			) {
				firstIndexByLink.set(courseSegmentLink, index);
			}
		}

		if (firstIndexByLink.size === 0) {
			return entries;
		}

		const nestedNames = [...firstIndexByLink.keys()].map((courseSegmentLink) => {
			return JSON.parse(courseSegmentLink)[1];
		});

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

		return entries.map((entry, index) => {
			if (!entry || !('data' in entry)) {
				return entry;
			}

			const nestedName = entry.data.segment?.name;

			const firstIndex = firstIndexByLink.get(
				JSON.stringify([entry.data.course, nestedName]),
			);

			if (firstIndex === undefined) {
				return entry;
			}

			if (firstIndex !== index) {
				return { sameRowAs: firstIndex };
			}

			const storedKey = storedKeysByName.get(nestedName);

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
				return answerRepeatedRow(entries, firstIndex, index, SEGMENT_COLLECTION);
			}

			const storedKey = storedKeysByName.get(entry.data.name);

			return storedKey === undefined
				? entry
				: { key: storedKey };
		});
	});

	// The planner's updateIfDuplicated: a stored row the payload leaves unchanged
	// is taken over inert (skipPurgeFor); one whose discipline or label differs
	// is updated on the mutation's transaction, and the discipline slice it was
	// read under declared for its key: the snapshot after the write sees only
	// the slice it moved to.
	filter(
		`${CACHED_SEGMENT_COLLECTION}.items.create`,
		async (entries, _meta, context) => {
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

			const storedSegments = await new services.ItemsService(
				CACHED_SEGMENT_COLLECTION,
				{
					schema: context.schema,
					accountability: context.accountability,
					knex: context.transaction,
				},
			).readByQuery(
				{
					filter: { name: { _in: [...firstIndexByName.keys()] } },
					fields: ['id', 'name', ...UPDATABLE_SEGMENT_FIELDS],
					limit: -1,
				},
				{ emitEvents: false },
			);

			const storedSegmentsByName = new Map(
				storedSegments.map((storedSegment) => {
					return [storedSegment.name, storedSegment];
				}),
			);

			const answeredEntries = [];

			for (const [index, entry] of entries.entries()) {
				if (!entry || !('data' in entry)) {
					answeredEntries.push(entry);
					continue;
				}

				const firstIndex = firstIndexByName.get(entry.data.name);

				if (firstIndex !== index) {
					answeredEntries.push(answerRepeatedRow(
						entries,
						firstIndex,
						index,
						CACHED_SEGMENT_COLLECTION,
					));

					continue;
				}

				const storedSegment = storedSegmentsByName.get(entry.data.name);

				if (storedSegment === undefined) {
					answeredEntries.push(entry);
					continue;
				}

				const changedFields = UPDATABLE_SEGMENT_FIELDS.filter((fieldName) => {
					return fieldName in entry.data
						&& entry.data[fieldName] !== storedSegment[fieldName];
				});

				if (changedFields.length === 0) {
					context.scopedCache?.skipPurgeFor(storedSegment.id);
					answeredEntries.push({ key: storedSegment.id });
					continue;
				}

				await context.transaction(CACHED_SEGMENT_COLLECTION)
					.where({ id: storedSegment.id })
					.update(Object.fromEntries(changedFields.map((fieldName) => {
						return [fieldName, entry.data[fieldName]];
					})));

				context.scopedCache?.purgeBy(
					{
						collection: CACHED_SEGMENT_COLLECTION,
						pinnedScope: { discipline: [storedSegment.discipline] },
					},
					{ forKey: storedSegment.id },
				);

				answeredEntries.push({ key: storedSegment.id });
			}

			return answeredEntries;
		},
	);
}
