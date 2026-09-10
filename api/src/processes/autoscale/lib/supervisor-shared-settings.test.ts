import { expect, test, vi } from 'vitest';
import {
	applySupervisorPatch,
	parseSupervisorPatch,
	reloadDeclaration,
} from './supervisor-shared-settings.js';

vi.mock('@directus/env');

async function deploymentWith(env: Record<string, unknown> = {}) {
	const { useEnv } = await import('@directus/env');

	vi.mocked(useEnv).mockReturnValue({ CACHE_NAMESPACE: 'scalabus', ...env });
}

test('refuses an option a restart cannot carry', () => {
	expect(() => parseSupervisorPatch({ instances: 4 }))
		.toThrowError("'instances' is not an option a restart can carry");
});

// Nothing downstream corrects these: the value typed here is the one the
// supervisor is handed, so a kill timeout of zero would drop every request a
// released worker was serving.
test('refuses a value outside what the option may hold', () => {
	expect(() => parseSupervisorPatch({ killTimeout: 0 }))
		.toThrowError("'killTimeout' has to be a whole number between 100 and 600000");

	expect(() => parseSupervisorPatch({ listenTimeout: 20_000.5 }))
		.toThrowError(
			"'listenTimeout' has to be a whole number between 1000 and 600000",
		);
});

// `constructor` is answered by every object, so a lookup that is not by own
// property finds a function where the bounds should be and judges the value
// against it.
test('refuses a prototype key as an option no restart carries', () => {
	expect(() => parseSupervisorPatch({ constructor: 4 }))
		.toThrowError("'constructor' is not an option a restart can carry");
});

test('takes a value inside the range, and null to release it', () => {
	expect(parseSupervisorPatch({ listenTimeout: 20_000, killTimeout: null }))
		.toEqual({ listenTimeout: 20_000, killTimeout: null });
});

test('refuses a stamp field that is not text', () => {
	expect(() => parseSupervisorPatch({ setFrom: 7 }))
		.toThrowError(`'setFrom' has to be a string`);
});

// Shared settings holding nothing but their own stamp would show a supervisor as
// carrying one when every value it runs on came from the environment.
test('shared settings released down to their stamp are removed', () => {
	const stamped = { listenTimeout: 20_000, setBy: 'jean' };

	expect(applySupervisorPatch(stamped, { listenTimeout: null })).toBeNull();

	expect(applySupervisorPatch(stamped, { killTimeout: 5000 }))
		.toEqual({ listenTimeout: 20_000, killTimeout: 5000, setBy: 'jean' });
});

// The full set every restart, because pm2 keeps what the last one pushed: a
// field released from the shared settings goes back to the environment only if the
// restart says so.
test('the restart carries every option, not only the shared ones', async () => {
	await deploymentWith({ PM2_KILL_TIMEOUT: 5000 });

	expect(reloadDeclaration({ listenTimeout: 20_000 })).toEqual({
		listen_timeout: 20_000,
		kill_timeout: 5000,
		min_uptime: 1000,
		restart_delay: 0,
		max_restarts: 16,
	});
});

// Nobody sets a memory ceiling in bytes, and pm2 counts it in them.
test('a memory ceiling is asked for in megabytes and pushed in bytes', async () => {
	await deploymentWith();

	expect(reloadDeclaration({ maxMemoryRestartMegabytes: 512 }))
		.toMatchObject({ max_memory_restart: 536_870_912 });
});

// pm2 takes this one as a size, so an environment that asked for `512M` is
// asking for the same ceiling the panel calls 512 — read as a plain number it
// would be dropped instead, and a released ceiling would never revert.
test('a memory ceiling the environment sized is read as megabytes', async () => {
	await deploymentWith({ PM2_MAX_MEMORY_RESTART: '512M' });

	expect(reloadDeclaration(null)).toMatchObject({
		max_memory_restart: 536_870_912,
	});

	await deploymentWith({ PM2_MAX_MEMORY_RESTART: '1G' });

	expect(reloadDeclaration(null)).toMatchObject({
		max_memory_restart: 1_073_741_824,
	});

	// A bare number is the bytes pm2 means by one.
	await deploymentWith({ PM2_MAX_MEMORY_RESTART: 536_870_912 });

	expect(reloadDeclaration(null)).toMatchObject({
		max_memory_restart: 536_870_912,
	});
});

// An option the environment never set and pm2 has no number for is left out,
// so the supervisor keeps its own answer rather than being handed one.
test('an option nothing declares is not carried at all', async () => {
	await deploymentWith();

	expect(reloadDeclaration(null)).not.toHaveProperty('max_memory_restart');
});

// pm2 reads a bare number as bytes, so `400` asks for 400 bytes rather than the
// 400 megabytes whoever wrote it meant. Rounded to a ceiling of zero it would be
// pushed with the next roll and restart every worker as fast as it can boot.
test('a memory ceiling under a megabyte is carried by no restart', async () => {
	await deploymentWith({ PM2_MAX_MEMORY_RESTART: 400 });

	expect(reloadDeclaration(null)).not.toHaveProperty('max_memory_restart');
});
