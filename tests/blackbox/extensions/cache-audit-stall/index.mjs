// A read hook that blocks: the cache audit's pressure witness. While the flag
// row is armed, every read of STALL — each of the audit's replays — holds the
// event loop past the limiter's delay ceiling, the way a run's own bookkeeping
// did on dev (jclaveau/directus#508). The block is synchronous on purpose: an
// awaited pause frees the loop, and the limiter samples nothing.

const STALL = 'test_cache_audit_stall';
const STALL_FLAG = 'test_cache_audit_stall_flag';
const STALL_MS = 300;
const IDLE_GAP_MS = 60;

// Armed `together`, the primed reads wait for each other and stall at once.
const PRIMED_READS = 8;
// Longer than the limiter's 1000ms sampling interval: its tick runs as soon
// as this stall ends, so the primed stalls start at a known point of its
// window.
const TICK_PIN_STALL_MS = 1100;
const TICK_PIN_IDLE_MS = 600;

let waitingReads = [];

export default function registerHooks({ filter }) {
	filter(`${STALL}.items.read`, async (records, _meta, context) => {
		const flag = await context.database(STALL_FLAG).first('armed');

		if (flag?.armed === 'together') {
			await new Promise((resolve) => {
				waitingReads.push(resolve);

				if (waitingReads.length < PRIMED_READS) {
					return;
				}

				const releasedReads = waitingReads;
				waitingReads = [];

				blockLoop(TICK_PIN_STALL_MS);

				setTimeout(() => {
					for (const release of releasedReads) {
						release();
					}
				}, TICK_PIN_IDLE_MS);
			});

			blockLoop(STALL_MS);

			return records;
		}

		if (flag?.armed !== 'yes') {
			return records;
		}

		// A loaded runner's round trip between two reads: idle ticks the
		// limiter's mean counts between one stall and the next.
		await new Promise((resolve) => setTimeout(resolve, IDLE_GAP_MS));

		blockLoop(STALL_MS);

		return records;
	});
}

function blockLoop(durationMs) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}
