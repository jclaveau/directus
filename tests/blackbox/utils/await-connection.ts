import { Knex } from 'knex';
import axios from 'axios';
import { expect } from 'vitest';
import { recordTiming } from './record-timing';
import { sleep } from './sleep';

export async function awaitDatabaseConnection(database: Knex, checkSQL: string): Promise<void | null> {
	for (let attempt = 0; attempt <= 30; attempt++) {
		try {
			await database.raw(checkSQL);
			return null; // success
		} catch {
			await sleep(5000);
			continue;
		}
	}

	throw new Error(`Couldn't connect to DB`);
}

// An instance answers its ping about two seconds after its spawn, and every
// suite that spawns one waits on this, so the poll is short and the deadline is
// what bounds a boot that never comes.
const DIRECTUS_POLL_MS = 200;
const DIRECTUS_DEADLINE_MS = 500_000;

export async function awaitDirectusConnection(port: number): Promise<void | null> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < DIRECTUS_DEADLINE_MS) {
		try {
			await axios.get(`http://127.0.0.1:${port}/server/ping`);

			recordTiming('boots', {
				port,
				waitedMs: Date.now() - startedAt,
				file: currentTestFile(),
			});

			return null; // success
		}
		catch {
			await sleep(DIRECTUS_POLL_MS);
		}
	}

	throw new Error(`Couldn't connect to Directus`);
}

// The suite waiting, when a test file is: the global setup has none.
function currentTestFile(): string | undefined {
	try {
		return expect.getState().testPath?.split('blackbox')[1];
	}
	catch {
		return undefined;
	}
}
