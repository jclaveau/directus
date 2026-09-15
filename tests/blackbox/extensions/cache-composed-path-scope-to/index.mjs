// A read hook that scopes TO a COMPOSED path of a foreign collection: `course` is
// scoped on `unit`, `unit` on `owner`, so a course write emits `course:unit.owner=…`
// beside its flat slice. The audit that cancels caching over a tag no write
// reproduces has to recognise that derived path as one a write emits.
//
// The dependency is read for its purge counters: a foreign tag declared without
// them leaves the response uncached whatever else the audit decides.

const READ = 'p_composed_scope_read';
const COURSE = 'p_composed_scope_course';

export default function registerHooks({ filter }, { services }) {
	filter(`${READ}.items.read`, async (records, _meta, context) => {
		const courses = await new services.ItemsService(COURSE, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		}).readByQuery(
			{ fields: ['id', 'unit.owner'], sort: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		context.scopedCache?.scopeTo(
			{ collection: COURSE, field: 'unit.owner', value: courses[0]?.unit?.owner },
			{ epochs: courses.getMeta?.()?.scopedCacheEpochs },
		);

		return records;
	});
}
