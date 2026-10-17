import getPort, { portNumbers } from 'get-port';

// Above the shared servers (201xx, 202xx) and below the Linux ephemeral range
// (32768-60999), where an outbound socket could take the port first (#309).
const WORKER_PORTS_BASE = 21000;
const PORTS_PER_WORKER = 200;

/**
 * Picks a free port for an instance a suite spawns, inside a range only this
 * vitest worker draws from. get-port releases the port it probed before the
 * instance listens, and its lock lives in one process, so two workers drawing
 * from the same range could both be handed the port.
 */
export async function freePortOfWorker() {
	const poolId = process.env['VITEST_POOL_ID'];

	if (poolId === undefined || !/^[1-9]\d*$/.test(poolId)) {
		throw new Error(
			`VITEST_POOL_ID must be a positive integer, got ${String(poolId)}`,
		);
	}

	const firstPort = WORKER_PORTS_BASE + (Number(poolId) - 1) * PORTS_PER_WORKER;
	const lastPort = firstPort + PORTS_PER_WORKER - 1;
	const freePort = await getPort({ port: portNumbers(firstPort, lastPort) });

	// get-port falls back to any free port once the whole range is taken.
	if (freePort < firstPort || freePort > lastPort) {
		throw new Error(
			`No free port left in ${firstPort}-${lastPort} for worker ${poolId}`,
		);
	}

	return freePort;
}
