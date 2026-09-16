import '../entry-guard.js';
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

// The audit boots the app to replay through its hooks. Booted from a shell
// whose build identity differs from the running service's, that boot would
// flush the very cache it is about to inspect — and store its own identity, so
// the service flushes again on its next start. And the event loop it replays
// through is the one that just booted: the pressure limiter samples it near
// saturation and answers the first replays 503, though nobody else is served.
if (command === 'cache' && subcommand === 'audit') {
	useEnv()['CACHE_AUTO_FLUSH_ON_DEPLOY'] = false;
	useEnv()['PRESSURE_LIMITER_ENABLED'] = false;
}

createCli()
	.then((program) => program.parseAsync(process.argv))
	.catch((err) => {
		// eslint-disable-next-line no-console
		console.error(err);
		process.exit(1);
	});
