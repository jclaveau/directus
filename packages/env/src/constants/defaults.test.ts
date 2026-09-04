import { expect, test } from 'vitest';
import { DEFAULTS } from './defaults.js';

// Upstream ships this on; a merge that restores it has to fail here.
test('telemetry is off by default', () => {
	expect(DEFAULTS.TELEMETRY).toBe(false);
});
