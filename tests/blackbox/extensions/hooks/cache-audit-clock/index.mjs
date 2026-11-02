// A read whose body carries a clock: the cache audit's `time_varying` witness.
// Two uncached replays of it never agree, so the audit cannot call the entry
// stale — until CACHE_AUDIT_IGNORE_PATHS (or the request's `ignore`) names the
// stamped pointer, after which the entry reads `fresh`.

// One per file that reads it, so neither borrows the other's seed.
const CLOCKS = ['test_cache_audit_clock', 'test_cache_audit_cli_clock'];

export default function registerHooks({ filter }) {
	for (const clock of CLOCKS) {
		filter(`${clock}.items.read`, (records) => {
			// Monotonic and sub-millisecond, so two replays in one tick still differ.
			const servedAt = process.hrtime.bigint().toString();

			return records.map((record) => ({ ...record, served_at: servedAt }));
		});
	}
}
