// The sweep is not atomic: it reads its tag sets (SUNION), deletes the entries they
// name one by one, and only then deletes the sets. A read that files its own key
// into one of those sets in between has that set deleted underneath it — its entry
// stays in Redis, correct, and indexed by nothing, so no later purge can reach it.
//
// The window is two adjacent Redis commands wide, which is why the test inflates a
// tag set first: the per-member delete phase between them then takes long enough to
// aim at. This hook is the aiming — it holds a read between its query and the fill
// that files its tags, so the fill can be placed inside a window that has already
// opened.
//
// It also exposes the collection-wide sweep, which reaches its work through the
// slice index rather than a named tag: a slice the sweep's SREM dropped while a fill
// was re-adding it is invisible to that path even when its tag set survived.

const COLLECTION = 'purge_tag_index_race';

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
		// collection-wide purge — the one that finds its work through the slice index.
		await scopedCache?.purgeForMutatedRows(COLLECTION, [{}]);

		return payload;
	});
}
