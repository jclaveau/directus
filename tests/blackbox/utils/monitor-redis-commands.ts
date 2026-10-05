import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * One command as MONITOR streams it. `source` is the address of the client that
 * sent it, or `lua` for a command a script ran.
 */
export type MonitoredCommand = {
	commandArgs: string[];
	source: string;
};

/**
 * Every command Redis ran while `commandsSent` ran, in the order it ran them,
 * the commands its scripts ran included.
 *
 * Two sentinel GETs sent on `redis` bracket the window: MONITOR streams commands
 * in the order Redis ran them, so what lands between the two ran meanwhile. What
 * `redis` itself sends is left out.
 */
export async function monitorRedisCommands(
	redis: Redis,
	commandsSent: () => Promise<unknown>,
): Promise<MonitoredCommand[]> {
	const monitor = redis.duplicate({ monitor: true, lazyConnect: false });

	await new Promise<void>((resolveMonitoring, rejectMonitoring) => {
		monitor.once('monitoring', resolveMonitoring);

		// ioredis flips to monitoring only after the OK resolves, so a
		// line landing in the same chunk finds an empty command queue.
		monitor.on('error', (monitorError: Error) => {
			if (!monitorError.message.startsWith('Command queue state error')) {
				rejectMonitoring(monitorError);
			}
		});
	});

	const startSentinel = `monitor-sentinel:${randomUUID()}`;
	const endSentinel = `monitor-sentinel:${randomUUID()}`;
	const monitoredCommands: MonitoredCommand[] = [];
	let sentinelSource = '';
	let windowOpen = false;

	let startSeen = () => {};

	let endSeen = () => {};

	// Without the `end` listeners a dropped monitor leaves the waits below to the
	// test timeout. Once a sentinel has landed, rejecting is a no-op.
	const windowOpened = new Promise<void>((resolveStart, rejectStart) => {
		startSeen = resolveStart;

		monitor.once('end', () => {
			rejectStart(new Error('MONITOR connection ended before its start sentinel'));
		});
	});

	const windowClosed = new Promise<void>((resolveEnd, rejectEnd) => {
		endSeen = resolveEnd;

		monitor.once('end', () => {
			rejectEnd(new Error('MONITOR connection ended before its end sentinel'));
		});
	});

	// The rejection is read by the `await` below, which `commandsSent` may still be
	// keeping from attaching when it fires.
	windowClosed.catch(() => {});

	// One listener, so the window opens on the very line of its sentinel: a line
	// parsed in the same chunk lands before any promise callback runs.
	monitor.on(
		'monitor',
		(_time: string, commandArgs: string[], source: string) => {
			if (commandArgs[1] === startSentinel) {
				sentinelSource = source;
				windowOpen = true;
				startSeen();
			}
			else if (commandArgs[1] === endSentinel) {
				windowOpen = false;
				endSeen();
			}
			else if (windowOpen && source !== sentinelSource) {
				monitoredCommands.push({ commandArgs, source });
			}
		},
	);

	try {
		await Promise.all([windowOpened, redis.get(startSentinel)]);
		await commandsSent();
		await Promise.all([windowClosed, redis.get(endSentinel)]);
	}
	finally {
		monitor.disconnect();
	}

	return monitoredCommands;
}

// The commands whose arguments past the first key are more keys, or members.
const MULTI_KEY_COMMANDS = ['del', 'exists', 'mget', 'touch', 'unlink'];
const MULTI_MEMBER_COMMANDS = ['sadd', 'smismember', 'srem'];

/**
 * The commands one Directus instance sent under `namespace`, counted per command
 * and key, sorted by both: a purge runs some of its reads side by side, so the
 * order they reach Redis in is not theirs to keep.
 *
 * A client sent them when it sent anything naming the namespace: this way its
 * MULTI, EXEC and EVALSHA are counted too. An argument names it at its start, or
 * as `<namespace>_<store>:`, the way a cache store prefixes the keys it writes. A
 * script's own commands are counted when they name it. `command` keeps the case
 * it was sent in, which tells the ones a script ran apart: scripts send theirs in
 * capitals. What reaches the log bus is left out: any log line lands there.
 *
 * `key` is the first argument naming the namespace, past it: the key a command
 * reads or writes, the pattern of a SCAN; a store's key keeps its `_<store>:`. A
 * uuid is spelled `<uuid>`, a cache entry's hash `<entry>`, its sidecar's suffix
 * kept. `items` sums the keys, or the members, a command
 * carries when it carries several, and is empty otherwise.
 */
export function countRedisCommands(
	monitoredCommands: MonitoredCommand[],
	namespace: string,
): Record<string, string>[] {
	const namespacePrefix = `${namespace}:`;
	const logBusKey = `${namespacePrefix}bus:logs`;
	const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	// A Keyv store prefixes its own namespace once more, past a `::`.
	const storeKeyPattern = new RegExp(
		`^${escapedNamespace}(_[a-z]+):(?::${escapedNamespace}\\1:)?`,
	);

	const pastNamespace = (commandArg: string) => {
		if (commandArg.startsWith(namespacePrefix)) {
			return commandArg.slice(namespacePrefix.length);
		}

		const storeKey = storeKeyPattern.exec(commandArg);

		return storeKey === null
			? null
			: `${storeKey[1]}:${commandArg.slice(storeKey[0].length)}`;
	};

	const namesNamespace = (commandArgs: string[]) => {
		return commandArgs.some((commandArg) => {
			return pastNamespace(commandArg) !== null;
		});
	};

	const instanceSources = new Set(
		monitoredCommands
			.filter(({ commandArgs, source }) => {
				return source !== 'lua' && namesNamespace(commandArgs);
			})
			.map(({ source }) => source),
	);

	const countedCommands = new Map<string, Record<string, string>>();

	for (const { commandArgs, source } of monitoredCommands) {
		if (source === 'lua' && !namesNamespace(commandArgs)) {
			continue;
		}

		if (source !== 'lua' && !instanceSources.has(source)) {
			continue;
		}

		if (commandArgs[1] === logBusKey) {
			continue;
		}

		const command = commandArgs[0]!;
		const lowerCommand = command.toLowerCase();

		const commandKey = (
			commandArgs.slice(1)
				.map(pastNamespace)
				.find((keyPastNamespace) => keyPastNamespace !== null) ?? ''
		)
			.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, '<uuid>')
			.replace(/[0-9a-f]{32,}(?=(?:__\w+)?$)/, '<entry>');

		// TEMP: find the job sending non-namespaced commands on the cache connection.
		if (commandKey === '') {
			// eslint-disable-next-line no-console
			console.log('EMPTY-KEY', source, JSON.stringify(commandArgs));
		}

		let carriedItems = 0;

		if (MULTI_KEY_COMMANDS.includes(lowerCommand)) {
			carriedItems = commandArgs.length - 1;
		}
		else if (MULTI_MEMBER_COMMANDS.includes(lowerCommand)) {
			carriedItems = commandArgs.length - 2;
		}

		const countKey = `${command} ${commandKey}`;

		const counted = countedCommands.get(countKey) ?? {
			command,
			key: commandKey,
			calls: '0',
			items: '',
		};

		counted['calls'] = String(Number(counted['calls']) + 1);

		if (carriedItems > 0) {
			counted['items'] = String(Number(counted['items']) + carriedItems);
		}

		countedCommands.set(countKey, counted);
	}

	return [...countedCommands.keys()].sort().map((countKey) => {
		return countedCommands.get(countKey)!;
	});
}

/**
 * A table of counted commands as a feature file writes it: a key too long for its
 * column is broken after a `:` over the lines of a multiline cell, which the cell
 * joins with newlines.
 */
export function joinBrokenKeys(
	table: Record<string, string>[],
): Record<string, string>[] {
	return table.map((row) => {
		return { ...row, key: row['key']!.replaceAll('\n', '') };
	});
}
