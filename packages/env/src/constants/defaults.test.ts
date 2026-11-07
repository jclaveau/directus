import { expect, test } from 'vitest';
import { DEFAULTS } from './defaults.js';

// Upstream ships this on; a merge that restores it has to fail here.
test('telemetry is off by default', () => {
	expect(DEFAULTS.TELEMETRY).toBe(false);
});

// Raw SQL runs statements in order, so the default does too.
test('a batched write preserves the mutation order by default', () => {
	expect(DEFAULTS.DEFAULT_MUTATION_BATCHING).toBe('preserveMutationOrder');
});
