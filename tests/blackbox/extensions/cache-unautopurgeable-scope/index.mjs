// The UNAUTOPURGEABLE-scope safety net (#292). A read hook that scopes TO a value
// slice on a field the target collection isn't scoped on declares a tag no write can
// auto-purge. Rather than cache a response that would go stale, the framework leaves
// it UNCACHED (and surfaces an `unautopurgeable_scope` anomaly) — UNLESS the hook
// marks it `manuallyPurged`, asserting it reproduces the tag via its own purgeBy.
//
//   - CANCEL_READ: unautopurgeable scopeTo, no flag → the read is never cached.
//   - MANUAL_READ: same tag with `manuallyPurged: true` AND the dependency's own
//     purge counters, plus a matching purgeBy on the dep's update → cached AND
//     correctly invalidated (valid custom pairing).
//   - MANUAL_BARE_READ: the same flag with NO counters → still not cached. The flag
//     says a WRITE reproduces the tag; it says nothing about a purge that already
//     landed while the read was running, and there is no taking that counter after
//     the rows are read.
//   - COVERED_READ: the same unreproducible tag, but on a collection the response
//     already carries a reproducible tag for → cached. A write to that collection
//     purges the entry through the OTHER tag, so no staleness is possible and the
//     audit has nothing to cancel.

const CANCEL_READ = 'p_unauto_read';
const CANCEL_DEP = 'p_unauto_dep';
const MANUAL_READ = 'p_manual_read';
const MANUAL_DEP = 'p_manual_dep';
const SCOPE_HOOK_READ = 'p_unauto_scope_hook';
const MANUAL_BARE_READ = 'p_manual_bare_read';
const COVERED_READ = 'p_unauto_covered';

// A custom slice on `ghost`, a field neither dependency is scoped on — so it's
// unautopurgeable by the dependency's own auto-purge.
const customTag = (collection) => ({ collection, field: 'ghost', value: 'g' });

export default function registerHooks({ filter }, { services }) {
	// No `manuallyPurged` → the read carries an unautopurgeable tag → not cacheable.
	filter(`${CANCEL_READ}.items.read`, (records, _meta, context) => {
		context.scopedCache?.scopeTo(customTag(CANCEL_DEP));
		return records;
	});

	// `manuallyPurged: true` → the author owns reproduction, so the read is cached.
	//
	// The counters ride along too, and the two answer different questions:
	// `manuallyPurged` says a WRITE to MANUAL_DEP will reproduce this custom slice,
	// `epochs` says whether a purge of MANUAL_DEP already landed while this read was
	// running. Without them the response is left uncached whatever the flag says, so
	// the dependency is read here for the one thing that read takes before it runs —
	// its own counters.
	filter(`${MANUAL_READ}.items.read`, async (records, _meta, context) => {
		const dependency = await new services.ItemsService(MANUAL_DEP, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		}).readByQuery({ fields: ['id'], limit: 1 }, { emitEvents: false });

		context.scopedCache?.scopeTo(customTag(MANUAL_DEP), {
			manuallyPurged: true,
			epochs: dependency.getMeta?.()?.scopedCacheEpochs,
		});

		return records;
	});

	// `manuallyPurged` alone, no counters — the case that used to be let through on a
	// counter read AFTER the rows, which could not see a purge that landed before it.
	filter(`${MANUAL_BARE_READ}.items.read`, (records, _meta, context) => {
		context.scopedCache?.scopeTo(customTag(MANUAL_DEP), { manuallyPurged: true });
		return records;
	});

	// The promised reproduction: a MANUAL_DEP update purges the same custom slice, so
	// the manuallyPurged read is invalidated on a dependency write.
	filter(`${MANUAL_DEP}.items.update`, (payload, _meta, context) => {
		context.scopedCache?.purgeBy(customTag(MANUAL_DEP));
		return payload;
	});

	// The unreproducible tag names the read's OWN collection, whose computed
	// `space` slice is already on the response — so a write reaches this entry
	// through that tag and the finer one is harmless freight.
	filter(`${COVERED_READ}.items.read`, (records, _meta, context) => {
		context.scopedCache?.scopeTo(customTag(COVERED_READ));
		return records;
	});

	// The OTHER door into the same audit: `cache.scope` returns the tag list itself,
	// so a tag appended here never passes through the collector `scopeTo` fills. The
	// tag names CANCEL_DEP, a collection nothing on this response covers — on the
	// read's own collection its computed slice would already make it purgeable.
	filter('cache.scope', (tags, meta) => {
		return meta.collection === SCOPE_HOOK_READ
			? [...tags, customTag(CANCEL_DEP)]
			: tags;
	});
}
