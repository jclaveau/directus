import { useEnv } from '@directus/env';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { createCli } from './index.js';
import { armDeadline } from './utils/arm-deadline.js';

// Options first, so a global one ahead of the subcommand cannot hide the command
// it precedes — commander takes the program's own options there.
const [command, subcommand] = process.argv
	.slice(2)
	.filter((argument) => argument.startsWith('-') === false);

if (command === 'cache' && subcommand === 'flush') {
	armDeadline(
		getMilliseconds(useEnv()['CACHE_FLUSH_TIMEOUT']),
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
