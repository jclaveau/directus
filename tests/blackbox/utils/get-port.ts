import getFreePort, { portNumbers } from 'get-port';

// get-port can only tell a port is free when it looks, and a spawned instance
// binds it about two seconds later. Two workers looking inside that window get
// the same port: the loser's instance dies on EADDRINUSE, its
// `awaitDirectusConnection` succeeds against the winner's, and its tests run
// against an env that is not theirs. So each worker draws from a slice of its
// own — VITEST_POOL_ID is unique among the workers running at once — below the
// OS ephemeral range (32768+), where no outbound socket can take one either.
const firstSlicePort = 21_000;
const slicePortCount = 1_000;

export async function getPort(): Promise<number> {
	const poolId = Number(process.env['VITEST_POOL_ID']);

	if (!Number.isInteger(poolId) || poolId < 1) {
		throw new Error(
			'getPort() needs the VITEST_POOL_ID of a vitest worker, got '
			+ `${process.env['VITEST_POOL_ID']}`,
		);
	}

	const sliceStart = firstSlicePort + (poolId - 1) * slicePortCount;
	const sliceEnd = sliceStart + slicePortCount - 1;

	const freePort = await getFreePort({
		port: portNumbers(sliceStart, sliceEnd),
	});

	// Past the slice get-port falls back to any free port: the shared draw this
	// module exists to avoid.
	if (freePort < sliceStart || freePort > sliceEnd) {
		throw new Error(
			`No free port left in ${sliceStart}-${sliceEnd} for vitest worker `
			+ `${poolId}`,
		);
	}

	return freePort;
}
