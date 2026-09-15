// READ-side dependency through `context.scopedCache.dependOn`
// (cache-read-depend-on.test.ts). A read of `report` runs lookups over four
// collections it summarises, each handed to `dependOn` in one of the shapes a hook
// fans lookups out in: a pending promise, a `Promise.all` batch, and
// `Promise.allSettled` verdicts with a rejected sibling. Every fulfilled lookup's
// tags AND purge counters are folded into the report read, so a write in any of
// those slices invalidates the cached report, and the report stays cacheable at all
// (no counter → left uncached). What `dependOn` hands back is the resolved lookup,
// which the hook writes onto the response as proof of the passthrough.

const REPORT = 'test_items_depend_report';
const METRIC = 'test_items_depend_metric';
const AUDIT = 'test_items_depend_audit';
const LEDGER = 'test_items_depend_ledger';
const NOTE = 'test_items_depend_note';
const OWNER = 'acme';

export default function registerHooks({ filter }, { services }) {
	filter(`${REPORT}.items.read`, async (records, _meta, context) => {
		const lookup = (collection) => {
			const service = new services.ItemsService(collection, {
				schema: context.schema,
				accountability: context.accountability,
				knex: context.database,
			});

			return service.readByQuery(
				{ filter: { owner: { _eq: OWNER } }, fields: ['id'], limit: -1 },
				{ emitEvents: false },
			);
		};

		const { dependOn } = context.scopedCache;

		const metrics = await dependOn(lookup(METRIC));

		const [audits, ledgers] = await dependOn(
			Promise.all([lookup(AUDIT), lookup(LEDGER)]),
		);

		const verdicts = await dependOn(
			Promise.allSettled([
				lookup(NOTE),
				Promise.reject(new Error('sibling lookup failed')),
			]),
		);

		for (const record of records) {
			record.metric_count = metrics.length;
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
