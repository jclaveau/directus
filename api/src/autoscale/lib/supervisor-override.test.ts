import { expect, test, vi } from 'vitest';
import {
	applySupervisorPatch,
	parseSupervisorPatch,
	readSupervisorOverride,
	reloadDeclaration,
	writeSupervisorOverride,
} from './supervisor-override.js';

vi.mock('@directus/env');
vi.mock('../../redis/index.js');

const get = vi.fn();
const set = vi.fn();
const del = vi.fn();

async function deploymentWith(
	stored: string | null,
	env: Record<string, unknown> = {},
) {
	const { useEnv } = await import('@directus/env');
	const { useRedis } = await import('../../redis/index.js');

	vi.mocked(useEnv).mockReturnValue({ CACHE_NAMESPACE: 'scalabus', ...env });
	get.mockResolvedValue(stored);
	vi.mocked(useRedis).mockReturnValue({ get, set, del } as never);
}

test('reads the override under a key of its own', async () => {
	await deploymentWith(JSON.stringify({ listenTimeout: 20_000 }));

	await expect(readSupervisorOverride())
		.resolves
		.toEqual({ listenTimeout: 20_000 });

	expect(get).toHaveBeenCalledWith('scalabus:config:pm2:supervisor');
});

// A restart makes no override of a key it cannot parse, and the page reading it
// has to be told the same thing rather than shown an error.
test('reads a key edited into nonsense as no override', async () => {
	await deploymentWith('{ not json');

	await expect(readSupervisorOverride()).resolves.toBeNull();
});

test('writes the override, and deletes the key for none', async () => {
	await deploymentWith(null);

	await writeSupervisorOverride({ killTimeout: 5000 });

	expect(set).toHaveBeenCalledWith(
		'scalabus:config:pm2:supervisor',
		'{"killTimeout":5000}',
	);

	await writeSupervisorOverride(null);
	expect(del).toHaveBeenCalledWith('scalabus:config:pm2:supervisor');
});

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

// An override holding nothing but its own stamp would show a supervisor as
// overridden when every value it runs on came from the environment.
test('an override released down to its stamp is removed', () => {
	const stamped = { listenTimeout: 20_000, setBy: 'jean' };

	expect(applySupervisorPatch(stamped, { listenTimeout: null })).toBeNull();

	expect(applySupervisorPatch(stamped, { killTimeout: 5000 }))
		.toEqual({ listenTimeout: 20_000, killTimeout: 5000, setBy: 'jean' });
});

// The full set every restart, because pm2 keeps what the last one pushed: a
// field released from the override goes back to the environment only if the
// restart says so.
test('the restart carries every option, not only the overridden ones', async () => {
	await deploymentWith(null, { PM2_KILL_TIMEOUT: 5000 });

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
	await deploymentWith(null);

	expect(reloadDeclaration({ maxMemoryRestartMegabytes: 512 }))
		.toMatchObject({ max_memory_restart: 536_870_912 });
});

// pm2 takes this one as a size, so an environment that asked for `512M` is
// asking for the same ceiling the panel calls 512 — read as a plain number it
// would be dropped instead, and a released ceiling would never revert.
test('a memory ceiling the environment sized is read as megabytes', async () => {
	await deploymentWith(null, { PM2_MAX_MEMORY_RESTART: '512M' });

	expect(reloadDeclaration(null)).toMatchObject({
		max_memory_restart: 536_870_912,
	});

	await deploymentWith(null, { PM2_MAX_MEMORY_RESTART: '1G' });

	expect(reloadDeclaration(null)).toMatchObject({
		max_memory_restart: 1_073_741_824,
	});

	// A bare number is the bytes pm2 means by one.
	await deploymentWith(null, { PM2_MAX_MEMORY_RESTART: 536_870_912 });

	expect(reloadDeclaration(null)).toMatchObject({
		max_memory_restart: 536_870_912,
	});
});

// An option the environment never set and pm2 has no number for is left out,
// so the supervisor keeps its own answer rather than being handed one.
test('an option nothing declares is not carried at all', async () => {
	await deploymentWith(null);

	expect(reloadDeclaration(null)).not.toHaveProperty('max_memory_restart');
});
