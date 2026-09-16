import config, { getUrl } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
	type Rig,
	countWorkersAsync,
	databaseEnv,
	restartsOf,
	startAutoscaler,
	startPool,
	stopRig,
} from './autoscale/rig';

const auth = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * Six Directus workers, one booting after the other, is more boot than the
 * fifteen seconds a waited supervisor call is bounded at: the shape that
 * failed the deployment of https://github.com/jclaveau/directus/issues/490, at
 * a size a runner holds beside the other suites.
 */
const PREWARM = 6;

/** What lets the arm watch the pool go back down inside its own run. */
const RELEASE_COOLDOWN_SECONDS = 5;

/**
 * No decision until the youngest worker is this old. The traffic stops as the
 * last worker is listed, while it boots; the sample window a release reads is
 * five ticks deep, so a decision two seconds later would still be averaging
 * the traffic's CPU and release toward a size above the floor. Eight seconds
 * puts the whole window past the traffic: the pool the release rule reads is
 * the idle one the curve describes.
 */
const WARMUP_SECONDS = 8;

/**
 * Read by the workers and the autoscaler alike, the way one deployment's
 * environment is.
 */
const SCALING = {
	REDIS_HOST: 'localhost',
	REDIS_PORT: '6108',
	PM2_AUTOSCALE_PREWARM: String(PREWARM),
	PM2_AUTOSCALE_MIN_WORKERS: '1',
	PM2_AUTOSCALE_MAX_WORKERS: String(PREWARM),
	PM2_AUTOSCALE_WARMUP_SECONDS: String(WARMUP_SECONDS),
	PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: '40',
	PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: String(RELEASE_COOLDOWN_SECONDS),
};

/**
 * The sizes the pool holds, in order. pm2 boots the workers a scale adds one
 * after another, so the fill is a staircase of ones; an idle pool is released
 * half the way to its floor a cooldown, the half rounded up, so six comes down
 * as three, two, one.
 */
const EXPECTED_CURVE = [1, 2, 3, 4, 5, 6, 3, 2, 1];

/**
 * How long a size has to be read for to count as held, not passed through:
 * two readings, at the pace the watch reads.
 */
const HELD_MS = 1_000;

interface Deployment {
	rig: Rig;
	url: string;
	port: number;
	watch: Watch;
}

/** The pool's size, `at` milliseconds into the watch. */
interface Reading {
	at: number;
	size: number;
}

/** A size the pool held, from its first reading to the next size's first. */
interface Plateau {
	size: number;
	from: number;
	to: number;
}

/** The pool's size, read for as long as the watch runs. */
interface Watch {
	readings: Reading[];
	/** The pool's size once it is `size`, or whatever it is at the deadline. */
	until: (size: number, timeoutMs: number) => Promise<number>;
	stop: () => void;
}

/** How much traffic went through, and every answer that was not a 200. */
interface Traffic {
	requests: number;
	failures: string[];
	/** Ends the traffic, once the requests in flight have been answered. */
	stop: () => Promise<void>;
}

/**
 * Requests kept flowing at the pool while an arm watches it, the way a
 * platform's traffic does not wait for a deployment to be whole.
 *
 * A route that costs nothing and one that reads the database, so what is
 * asserted is that a worker the pool gained mid-fill serves, not only that
 * the port answers.
 */
function drive(url: string, concurrency: number): Traffic {
	let running = true;

	const traffic: Traffic = {
		requests: 0,
		failures: [],
		stop: async () => {
			running = false;
			await Promise.all(loops);
		},
	};

	const loops = Array.from({ length: concurrency }, async (_, index) => {
		for (let turn = index; running; turn++) {
			const path = turn % 2 === 0
				? '/server/ping'
				: '/users/me';

			try {
				const response = await request(url)
					.get(path)
					.set('Authorization', auth);

				traffic.requests += 1;

				if (response.status !== 200) {
					traffic.failures.push(`${path} ${response.status}`);
				}
			}
			catch (error) {
				traffic.requests += 1;
				traffic.failures.push(`${path} ${String(error)}`);
			}
		}
	});

	return traffic;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Reads the pool off the daemon a quarter second after each reading came
 * back — a listing takes about half a second, so a reading every three
 * quarters or so — and keeps the whole walk, not only where it ended: a
 * worker lost on the way, two added at once or a release skipping a step all
 * show in the readings and nowhere else. Read without holding the event loop:
 * the traffic the arm drives runs in this process too, and a listing that
 * blocked it would be the arm throttling its own load.
 */
async function watchPool(rig: Rig): Promise<Watch> {
	const started = Date.now();
	const readings: Reading[] = [];
	let running = true;

	const read = async () => {
		const size = await countWorkersAsync(rig);
		readings.push({ at: Date.now() - started, size });
	};

	await read();

	void (async () => {
		while (running) {
			await sleep(250);

			if (running) {
				await read();
			}
		}
	})();

	return {
		readings,
		until: async (size, timeoutMs) => {
			const deadline = Date.now() + timeoutMs;

			while (readings.at(-1)!.size !== size && Date.now() < deadline) {
				await sleep(250);
			}

			return readings.at(-1)!.size;
		},
		stop: () => {
			running = false;
		},
	};
}

/**
 * The sizes held for `heldMs` or longer, in order. A size held for less is
 * the pool on its way between two: a release lets its victims go at once, and
 * the count passes through the sizes between as each one leaves. The size the
 * readings begin at is held whatever its span: it is the pool the deployment
 * restarted into, there since before the first reading.
 */
function plateausOf(readings: Reading[], heldMs: number): Plateau[] {
	const runs: Plateau[] = [];

	for (const reading of readings) {
		const run = runs.at(-1);

		if (run?.size === reading.size) {
			run.to = reading.at;
		}
		else {
			if (run) {
				run.to = reading.at;
			}

			runs.push({ size: reading.size, from: reading.at, to: reading.at });
		}
	}

	return runs
		.filter((run, index) => index === 0 || run.to - run.from >= heldMs)
		.reduce<Plateau[]>((plateaus, run) => {
			const previous = plateaus.at(-1);

			if (previous?.size === run.size) {
				previous.to = run.to;
			}
			else {
				plateaus.push(run);
			}

			return plateaus;
		}, []);
}

/**
 * The API as the pool's own workers, the way a deployment runs it: pm2 in
 * cluster mode, `wait_ready`, the planner's `kill_timeout`, and the
 * autoscaler reading the same environment beside it.
 */
async function deploy(vendor: Vendor): Promise<Deployment> {
	const env = cloneDeep(config.envs)[vendor]!;
	const port = await getPort();

	env['PORT'] = String(port);
	env['CACHE_NAMESPACE'] = `blackbox-prewarm-load-${vendor}`;
	env['LOG_LEVEL'] = 'error';

	const rig = startPool({
		appName: `prewarm-load-${vendor}`,
		instances: 1,
		directusEnv: { ...env, ...SCALING },
	});

	return {
		rig,
		url: getUrl(vendor, { [vendor]: env } as never),
		port,
		watch: await watchPool(rig),
	};
}

// The pool a deployment restarts into is one worker, and the platform's
// traffic reaches it as soon as that worker listens. Prewarm is the walk from
// there to the size the deployment asked for, taken while that traffic is
// served — and once there, a pool nothing is asking of is released like any
// other: prewarm is a size to reach, not a floor to hold.
describe('A prewarm is reached under traffic and released after it', () => {
	const deployed: Deployment[] = [];

	afterEach(() => {
		for (const deployment of deployed.splice(0)) {
			deployment.watch.stop();
			stopRig(deployment.rig);
		}
	});

	it.each(vendors)('%s fills while serving, then lets go', async (vendor) => {
		const deployment = await deploy(vendor);
		deployed.push(deployment);
		await awaitDirectusConnection(deployment.port);

		const traffic = drive(deployment.url, 4);

		startAutoscaler(deployment.rig, { ...databaseEnv(vendor), ...SCALING });

		expect(await deployment.watch.until(PREWARM, 180_000)).toBe(PREWARM);

		await traffic.stop();

		expect(traffic.failures).toEqual([]);
		expect(traffic.requests).toBeGreaterThan(20);

		// One scale for the whole pool, asked once: a second one sent while the
		// first was still adding would have grown the pool past the target.
		expect(deployment.rig.logs.join('').match(/prewarming .+ workers/g)).toEqual([
			`prewarming ${deployment.rig.appName} from 1 to ${PREWARM} workers`,
		]);

		// Nothing asks of the pool any more, so the release rule takes it back
		// down: the first decision the loop is allowed after the prewarm.
		expect(await deployment.watch.until(1, 90_000)).toBe(1);

		// Read at the floor for long enough to count as held there.
		await sleep(2 * HELD_MS);
		deployment.watch.stop();

		const curve = plateausOf(deployment.watch.readings, HELD_MS);

		const steps = curve
			.map((plateau) => `${plateau.size}@${plateau.from / 1000}s`)
			.join(' ');

		// eslint-disable-next-line no-console
		console.info(`[prewarm-load] ${deployment.rig.appName} pool curve: ${steps}`);

		expect(curve.map((plateau) => plateau.size)).toEqual(EXPECTED_CURVE);

		// A worker that crashed and came back inside a second reads as a size
		// the pool never left; the daemon's restart count is where it shows.
		expect(restartsOf(deployment.rig)).toBe(0);

		// One release a cooldown. Read from the daemon, a step begins once its
		// victims are gone, so two steps are a cooldown apart give or take how
		// long each release took to let its workers go.
		const released = curve.slice(EXPECTED_CURVE.indexOf(PREWARM) + 1);

		for (const [index, step] of released.slice(1).entries()) {
			expect(step.from - released[index]!.from).toBeGreaterThanOrEqual(
				RELEASE_COOLDOWN_SECONDS * 1000 - HELD_MS,
			);
		}
	}, 360_000);
});
