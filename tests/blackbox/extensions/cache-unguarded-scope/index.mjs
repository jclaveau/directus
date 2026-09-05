// A read hook can scope a response TO any collection, and it runs long after the
// host captured the purge counters of the collections it could name itself. The tag
// it adds therefore names a collection no counter covers, and a purge of it landing
// mid-read passes the post-fill comparison unnoticed — the entry is stored already
// stale, under an index that purge has just swept.
//
//   - UNGUARDED_READ: scopes to a foreign collection with no counters handed over,
//     and writes to it from inside the read. The enrichment in the payload is the
//     pre-write value by construction, so caching it serves that value on.
//   - GUARDED_READ: the same dependency, declared with the counters its own
//     dependent read captured. The control: this one must still cache, and must
//     still be invalidated by an ordinary write to the dependency.

const UNGUARDED_READ = 'unguarded_read';
const UNGUARDED_DEP = 'unguarded_dep';
const GUARDED_READ = 'guarded_read';
const GUARDED_DEP = 'guarded_dep';

let alreadyFired = false;

function depService(services, context, collection) {
	return new services.ItemsService(collection, {
		schema: context.schema,
		knex: context.database,
	});
}

export default function registerHooks({ filter }, { services }) {
	filter(`${UNGUARDED_READ}.items.read`, async (records, _meta, context) => {
		const dep = await depService(services, context, UNGUARDED_DEP)
			.readByQuery({ fields: ['id', 'label'], limit: 1 }, { emitEvents: false });

		const label = dep[0]?.label ?? null;

		for (const record of records) {
			record.dep_label = label;
		}

		// No `epochs`: the collection this response now depends on has no captured
		// counter, so nothing can tell whether the write below beat the fill.
		context.scopedCache?.scopeTo({ collection: UNGUARDED_DEP });

		// The in-flight write, once. It commits after the enrichment above read the
		// old value and before respond stores it — the window, made deterministic.
		if (alreadyFired) {
			return records;
		}

		alreadyFired = true;

		const [depRow] = dep;

		if (depRow) {
			await depService(services, context, UNGUARDED_DEP)
				.updateOne(depRow.id, { label: 'v2' });
		}

		return records;
	});

	filter(`${GUARDED_READ}.items.read`, async (records, _meta, context) => {
		const dep = await depService(services, context, GUARDED_DEP)
			.readByQuery({ fields: ['id', 'label'], limit: 1 }, { emitEvents: false });

		for (const record of records) {
			record.dep_label = dep[0]?.label ?? null;
		}

		// The counters that read captured BEFORE its own query — the right value by
		// construction, and what keeps this response cacheable.
		context.scopedCache?.scopeTo(
			[{ collection: GUARDED_DEP }],
			{ epochs: dep.getMeta?.()?.scopedCacheEpochs },
		);

		return records;
	});
}
