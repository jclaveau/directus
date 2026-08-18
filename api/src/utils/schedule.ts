import { CronExpressionParser } from 'cron-parser';
import schedule from 'node-schedule';
import { useLogger } from '../logger/index.js';
import { SynchronizedClock } from '../synchronization.js';

export interface ScheduledJob {
	stop(): Promise<void>;
}

export function validateCron(rule: string): boolean {
	try {
		CronExpressionParser.parse(rule);
	} catch {
		return false;
	}

	return true;
}

export function scheduleSynchronizedJob(
	id: string,
	rule: string,
	cb: (fireDate: Date) => void | Promise<void>,
): ScheduledJob {
	const clock = new SynchronizedClock(`${id}:${rule}`);

	const job = schedule.scheduleJob(rule, async (fireDate) => {
		const nextInvocation = job.nextInvocation();
		if (!nextInvocation) return;

		const nextTimestamp = nextInvocation.getTime();

		// node-schedule invokes this and drops the promise on the floor, so anything
		// that rejects here is an unhandled rejection — which Node turns into a dead
		// process. The claim below is a Redis write, so a tick landing during a Redis
		// blip took the whole API down; a job's own failure would too. Neither is
		// worth more than a missed tick, and the next one re-claims.
		try {
			const wasSet = await clock.set(nextTimestamp);

			if (wasSet) {
				await cb(fireDate);
			}
		}
		catch (error: any) {
			useLogger().warn(error, `[schedule] job "${id}" failed: ${error}`);
		}
	});

	const stop = async () => {
		job.cancel();

		await clock.reset();
	};

	return { stop };
}
