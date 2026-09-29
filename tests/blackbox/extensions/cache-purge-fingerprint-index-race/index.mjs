// A slice purge reads its index sets in pages (SSCAN) and SREMs only the members it
// matched, so a read filing its own member into one of those sets while the pass is
// under way is either scanned and purged, or missed and left indexed — never left
// indexed by nothing. That is the invariant this rig pins: the sweep it replaced
// read its tag sets, deleted the entries they named, and only then deleted the sets,
// so a fill landing between those last two steps kept its entry and lost its index.
//
// The pass is as long as the set is wide, which is why the test inflates one first:
// ~120k members take long enough to aim a read into. This hook is the aiming — it
// holds a read between its query and the fill that files its fingerprint, so the
// fill can be placed inside a pass that has already started.
//
// It also exposes the collection-wide sweep, which finds its work by scanning for
// the collection's index sets rather than by naming one.

const COLLECTION = 'purge_fingerprint_index_race';

// Only the read asking for this slice is held; every other read of the collection,
// and every other collection, runs untouched.
const HELD_SLOT = 'window';

// A label a write can carry to ask for the collection-wide sweep, on top of the
// slice purge its own mutation raises.
const SWEEP_LABEL = 'sweep';

const holdMs = Number(process.env['CACHE_RACE_READ_HOLD_MS'] ?? 400);

export default function registerHooks({ filter }, { scopedCache }) {
	filter(`${COLLECTION}.items.read`, async (records, meta) => {
		if (meta?.query?.filter?.slot?._eq !== HELD_SLOT) {
			return records;
		}

		// Held AFTER the rows are fetched and BEFORE respond files this read's tags,
		// which is the pair of moments the window sits between.
		await new Promise((resolve) => setTimeout(resolve, holdMs));

		return records;
	});

	// Hung off a CREATE, not an update: a create's own purge names the bare tag, the
	// new row's own slice and its key — never the held slice — so the collection-wide
	// sweep this raises is the only thing that can reach the entries under test. An
	// update would have dropped them through its own slice purge and proved nothing.
	filter(`${COLLECTION}.items.create`, async (payload) => {
		if (payload?.label !== SWEEP_LABEL) {
			return payload;
		}

		// A row carrying no primary key is unresolvable, so the host degrades to the
		// collection-wide purge — the one that scans for the collection's index sets.
		await scopedCache?.purgeForMutatedRows(COLLECTION, [{}]);

		return payload;
	});
}
