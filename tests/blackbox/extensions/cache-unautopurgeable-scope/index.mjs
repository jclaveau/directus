// The UNAUTOPURGEABLE-scope safety net (#292). A read hook that scopes TO a value
// slice on a field the target collection isn't scoped on declares a tag no write can
// auto-purge. Rather than cache a response that would go stale, the framework leaves
// it UNCACHED (and surfaces an `unautopurgeable_scope` anomaly) — UNLESS the hook
// marks it `manuallyPurged`, asserting it reproduces the tag via its own purgeBy.
//
//   - CANCEL_READ: unautopurgeable scopeTo, no flag → the read is never cached.
//   - MANUAL_READ: same tag with `manuallyPurged: true`, plus a matching purgeBy on
//     the dep's update → cached AND correctly invalidated (valid custom pairing).

const CANCEL_READ = 'p_unauto_read';
const CANCEL_DEP = 'p_unauto_dep';
const MANUAL_READ = 'p_manual_read';
const MANUAL_DEP = 'p_manual_dep';

// A custom slice on `ghost`, a field neither dependency is scoped on — so it's
// unautopurgeable by the dependency's own auto-purge.
const customTag = (collection) => ({ collection, field: 'ghost', value: 'g' });

export default function registerHooks({ filter }) {
	// No `manuallyPurged` → the read carries an unautopurgeable tag → not cacheable.
	filter(`${CANCEL_READ}.items.read`, (records, _meta, context) => {
		context.scopedCache?.scopeTo(customTag(CANCEL_DEP));
		return records;
	});

	// `manuallyPurged: true` → the author owns reproduction, so the read is cached.
	filter(`${MANUAL_READ}.items.read`, (records, _meta, context) => {
		context.scopedCache?.scopeTo(customTag(MANUAL_DEP), { manuallyPurged: true });
		return records;
	});

	// The promised reproduction: a MANUAL_DEP update purges the same custom slice, so
	// the manuallyPurged read is invalidated on a dependency write.
	filter(`${MANUAL_DEP}.items.update`, (payload, _meta, context) => {
		context.scopedCache?.purgeBy(customTag(MANUAL_DEP));
		return payload;
	});
}
