import { useEnv } from '@directus/env';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { createCli } from './index.js';
import { armDeadline } from './utils/arm-deadline.js';

const [command, subcommand] = process.argv.slice(2);

if (command === 'cache' && subcommand === 'flush') {
	armDeadline(
		getMilliseconds(useEnv()['CACHE_FLUSH_TIMEOUT'], 30_000),
		'the cache flush',
	);
}

createCli()
	.then((program) => program.parseAsync(process.argv))
	.catch((err) => {
		// eslint-disable-next-line no-console
		console.error(err);
		process.exit(1);
	});
