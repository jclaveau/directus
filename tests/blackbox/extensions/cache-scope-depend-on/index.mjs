// READ-side dependency through `context.scopedCache.dependOn`
// (cache-read-depend-on.test.ts). A read of `report` runs lookups over five
// collections it summarises, each handed to `dependOn` in one of the shapes a hook
// has a lookup in: a pending promise, an already-awaited result, a `Promise.all`
// batch, and `Promise.allSettled` verdicts with a rejected sibling. Every fulfilled
// lookup's tags AND purge counters are folded into the report read, so a write in
// any of those slices invalidates the cached report, and the report stays cacheable
// at all (no counter → left uncached). What `dependOn` hands back is the resolved
// lookup, which the hook writes onto the response as proof of the passthrough.
//
// The read that asks to be raced (slot=race) also looks metric up twice around a
// write of its own, and folds the two in reverse order: the counters `dependOn`
// carries are the ones each lookup took BEFORE its query, judged on the earlier of
// the two, so the fill sees the write and refuses — the payload holds the pre-write
// count by construction. Folding the later lookup's counter instead would cache it.

const REPORT = 'test_items_depend_report';
const METRIC = 'test_items_depend_metric';
const AUDIT = 'test_items_depend_audit';
const LEDGER = 'test_items_depend_ledger';
const NOTE = 'test_items_depend_note';
const TALLY = 'test_items_depend_tally';
const OWNER = 'acme';
const RACED_SLOT = 'race';

let alreadyFired = false;

export default function registerHooks({ filter }, { services }) {
	filter(`${REPORT}.items.read`, async (records, meta, context) => {
		const serviceOf = (collection) => {
			return new services.ItemsService(collection, {
				schema: context.schema,
				accountability: context.accountability,
				knex: context.database,
			});
		};

		const lookup = (collection) => {
			return serviceOf(collection).readByQuery(
				{ filter: { owner: { _eq: OWNER } }, fields: ['id'], limit: -1 },
				{ emitEvents: false },
			);
		};

		const { dependOn } = context.scopedCache;

		const metrics = await dependOn(lookup(METRIC));
		const tallies = await dependOn(await lookup(TALLY));

		const [audits, ledgers] = await dependOn(
			Promise.all([lookup(AUDIT), lookup(LEDGER)]),
		);

		const verdicts = await dependOn(
			Promise.allSettled([
				lookup(NOTE),
				Promise.reject(new Error('sibling lookup failed')),
			]),
		);

		// Once, and only for the read that asks to be raced, so it cannot depend on
		// which test runs first nor on how often the read path emits this filter.
		if (!alreadyFired && meta?.query?.filter?.slot?._eq === RACED_SLOT) {
			alreadyFired = true;

			const before = await lookup(METRIC);

			await serviceOf(METRIC).createOne({ owner: OWNER, amount: 'raced' });

			const after = await lookup(METRIC);

			await dependOn([after, before]);
		}

		for (const record of records) {
			record.metric_count = metrics.length;
			record.tally_count = tallies.length;
			record.audit_count = audits.length;
			record.ledger_count = ledgers.length;

			record.note_count = verdicts[0].status === 'fulfilled'
				? verdicts[0].value.length
				: null;

			record.sibling_verdict = verdicts[1].status;
		}

		return records;
	});
}
