import type {
	AutoscaleDecision,
	AutoscaleNodeState,
} from '@directus/types';

/**
 * What the loop last decided, for the process report to answer with.
 *
 * The autoscaler resolves its configuration in its own process, beside the
 * pool rather than inside it, so no worker holding an HTTP request can be
 * asked what the pool is being scaled on. It answers the same processes query
 * every node answers instead, and this is what it answers with.
 */
let state: AutoscaleNodeState | null = null;

/**
 * The last decision that asked for a different size, kept across ticks.
 *
 * A pool holding steady decides "within the band" every second, which says
 * nothing about why it is the size it is. The move that made it that size does.
 */
let lastScale: AutoscaleDecision | null = null;

export function recordAutoscaleTick(
	tick: Omit<AutoscaleNodeState, 'lastScale'>,
): void {
	if (tick.lastDecision?.workers != null) {
		lastScale = tick.lastDecision;
	}

	state = { ...tick, lastScale };
}

/** What this process is scaling on, or `null` where it scales nothing. */
export function autoscaleState(): AutoscaleNodeState | null {
	return state;
}
