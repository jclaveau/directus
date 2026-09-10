import { expect, test } from 'vitest';
import { declaredBy } from './supervisor.js';

test('a declaration is reported as the supervisor holds it', () => {
	expect(declaredBy({
		instances: 4,
		exec_mode: 'cluster_mode',
		max_memory_restart: 536_870_912,
		listen_timeout: 20_000,
		kill_timeout: 30_000,
		min_uptime: 5000,
		max_restarts: 10,
		restart_delay: 2000,
		autorestart: true,
		wait_ready: true,
	})).toEqual({
		instances: 4,
		execMode: 'cluster_mode',
		maxMemoryRestart: 536_870_912,
		listenTimeout: 20_000,
		killTimeout: 30_000,
		minUptime: 5000,
		maxRestarts: 10,
		restartDelay: 2000,
		autorestart: true,
		waitReady: true,
	});
});

// Reporting a missing value as missing would say the option does nothing,
// which is the opposite of what it does: pm2 gives a worker three seconds to
// come up whether or not anything asked it to.
test('an option nothing declared reports what the supervisor falls back to', () => {
	expect(declaredBy({})).toMatchObject({
		instances: 1,
		listenTimeout: 3000,
		killTimeout: 1600,
		minUptime: 1000,
		maxRestarts: 16,
		restartDelay: 0,
	});
});

// A memory ceiling is the one option whose absence means it is off, so it is
// the one reported as nothing rather than as a number.
test('no memory ceiling is reported as none rather than as zero', () => {
	expect(declaredBy({}).maxMemoryRestart).toBeNull();
});

test('autorestart is on unless the declaration turned it off', () => {
	expect(declaredBy({}).autorestart).toBe(true);
	expect(declaredBy({ autorestart: false }).autorestart).toBe(false);
});

// A pool whose workers are counted in before they serve is one judged on their
// startup, so the panel has to be able to say the supervisor is not waiting.
test('waiting for a worker to be ready is off unless it was asked for', () => {
	expect(declaredBy({}).waitReady).toBe(false);
});

// pm2 parses these itself when it validates the declaration, so a value still
// carrying its string is one that reached pm2_env another way. Reported as the
// number it means rather than dropped to a fallback nobody is using.
test('an option carrying a string is reported as the number it means', () => {
	expect(declaredBy({ kill_timeout: '30000' }).killTimeout).toBe(30_000);
});

test('an option carrying nonsense reports the fallback', () => {
	expect(declaredBy({ kill_timeout: 'soon' }).killTimeout).toBe(1600);
});
