import type { ChildProcess } from 'child_process';
import { once } from 'events';

/**
 * Kills an instance a suite spawned and waits for it to exit, so what runs
 * after it meets neither its connections nor its port. An instance that never
 * started, or already exited, has nothing to wait for.
 */
export async function stopSpawnedInstance(instance: ChildProcess | undefined) {
	if (
		instance === undefined
		|| instance.exitCode !== null
		|| instance.signalCode !== null
	) {
		return;
	}

	// The exit event fires on a later tick, after this listener is in place.
	instance.kill();
	await once(instance, 'exit');
}
