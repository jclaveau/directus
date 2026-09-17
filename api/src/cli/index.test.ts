import { describe, expect, it, vi } from 'vitest';
import { runAutoscaler } from '../processes/autoscale/index.js';
import { startServer } from '../server.js';
import bootstrap from './commands/bootstrap/index.js';
import cacheAudit from './commands/cache/audit.js';
import cacheFlush from './commands/cache/flush.js';
import count from './commands/count/index.js';
import dbInstall from './commands/database/install.js';
import dbMigrate from './commands/database/migrate.js';
import init from './commands/init/index.js';
import rolesCreate from './commands/roles/create.js';
import { apply } from './commands/schema/apply.js';
import { snapshot } from './commands/schema/snapshot.js';
import keyGenerate from './commands/security/key.js';
import secretGenerate from './commands/security/secret.js';
import usersCreate from './commands/users/create.js';
import usersPasswd from './commands/users/passwd.js';
import { BUILT_IN_COMMANDS, createCli } from './index.js';
import { loadExtensions } from './load-extensions.js';

const { emitInit } = vi.hoisted(() => ({ emitInit: vi.fn() }));

vi.mock('directus/version', () => ({ version: '0.0.0' }));
vi.mock('./load-extensions.js', () => ({ loadExtensions: vi.fn() }));
vi.mock('../emitter.js', () => ({ useEmitter: () => ({ emitInit }) }));
vi.mock('../server.js', () => ({ startServer: vi.fn() }));
vi.mock('../processes/autoscale/index.js', () => ({ runAutoscaler: vi.fn() }));
vi.mock('./commands/bootstrap/index.js', () => ({ default: vi.fn() }));
vi.mock('./commands/cache/audit.js', () => ({ default: vi.fn() }));
vi.mock('./commands/cache/flush.js', () => ({ default: vi.fn() }));
vi.mock('./commands/count/index.js', () => ({ default: vi.fn() }));
vi.mock('./commands/database/install.js', () => ({ default: vi.fn() }));
vi.mock('./commands/database/migrate.js', () => ({ default: vi.fn() }));
vi.mock('./commands/init/index.js', () => ({ default: vi.fn() }));
vi.mock('./commands/roles/create.js', () => ({ default: vi.fn() }));
vi.mock('./commands/schema/apply.js', () => ({ apply: vi.fn() }));
vi.mock('./commands/schema/snapshot.js', () => ({ snapshot: vi.fn() }));
vi.mock('./commands/security/key.js', () => ({ default: vi.fn() }));
vi.mock('./commands/security/secret.js', () => ({ default: vi.fn() }));
vi.mock('./commands/users/create.js', () => ({ default: vi.fn() }));
vi.mock('./commands/users/passwd.js', () => ({ default: vi.fn() }));

describe('createCli', () => {
	// pm2 cluster mode appends the ecosystem path and a duplicated `start` to the
	// worker argv; the start command must swallow those excess positionals instead of
	// letting commander 14 reject them and crash the boot.
	it('start tolerates the excess argv pm2 cluster injects', async () => {
		const program = await createCli(['start']);
		program.exitOverride();

		await program.parseAsync(['start', '/x/ecosystem.config.cjs', 'start'], {
			from: 'user',
		});

		expect(vi.mocked(startServer)).toHaveBeenCalledOnce();
	});

	// Every command's module is reached from its own action, so the wiring is the
	// whole of what this file is: an argv that lands on the wrong import, or on no
	// import at all, is a command that no longer exists. The command files passing
	// their own tests says nothing about it.
	it.each([
		[['init'], init, []],
		[['autoscale'], runAutoscaler, []],
		[['security', 'key:generate'], keyGenerate, []],
		[['security', 'secret:generate'], secretGenerate, []],
		[['database', 'install'], dbInstall, []],
		[['database', 'migrate:latest'], dbMigrate, ['latest']],
		[['database', 'migrate:up'], dbMigrate, ['up']],
		[['database', 'migrate:down'], dbMigrate, ['down']],
		[['cache', 'flush'], cacheFlush, []],
		[['cache', 'audit'], cacheAudit, [{}]],
		[
			[
				'cache',
				'audit',
				'--json',
				'--purge',
				'--strict',
				'--limit',
				'50',
				'--user',
				'u1',
				'--collection',
				'articles',
			],
			cacheAudit,
			[{
				json: true,
				purge: true,
				strict: true,
				limit: '50',
				user: 'u1',
				collection: 'articles',
			}],
		],
		[['count', 'articles'], count, ['articles']],
		[
			['users', 'create', '--email', 'a@b.c', '--password', 'pw', '--role', 'r'],
			usersCreate,
			[{ email: 'a@b.c', password: 'pw', role: 'r' }],
		],
		[
			['users', 'passwd', '--email', 'a@b.c', '--password', 'pw'],
			usersPasswd,
			[{ email: 'a@b.c', password: 'pw' }],
		],
		[
			['roles', 'create', '--role', 'r', '--admin', '--app'],
			rolesCreate,
			[{ role: 'r', admin: true, app: true }],
		],
		[
			['bootstrap', '--skipAdminInit'],
			bootstrap,
			[{ skipAdminInit: true }],
		],
		[
			['schema', 'snapshot', 'snap.yaml'],
			snapshot,
			['snap.yaml', { yes: false, format: 'yaml' }],
		],
		[
			['schema', 'apply', '--yes', 'snap.yaml'],
			apply,
			['snap.yaml', { yes: true, dryRun: false }],
		],
	])('runs %j against its own module', async (argv, command, args) => {
		vi.mocked(command).mockClear();

		const program = await createCli(argv as string[]);
		program.exitOverride();

		await program.parseAsync(argv as string[], { from: 'user' });

		expect(vi.mocked(command)).toHaveBeenCalledExactlyOnceWith(...args as never[]);
	});

	// The gate the autoscaler is for: a loop reading the supervisor once a second
	// would otherwise carry every api-side extension the deployment ships, loaded
	// behind a database round trip it has no other reason to make.
	it.each([
		['autoscale'],
		['start'],
		['database', 'migrate:latest'],
		['schema', 'apply', 'snapshot.yaml'],
		['count', 'articles'],
	])('leaves the extensions alone for %s', async (...argv) => {
		vi.mocked(loadExtensions).mockClear();

		await createCli(argv);

		expect(vi.mocked(loadExtensions)).not.toHaveBeenCalled();
	});

	// An argument naming nothing this file declares is the one shape that can only
	// have come from an extension's `cli.before` hook, and the listing has to carry
	// whatever those registered whether or not one was asked for.
	it.each([
		[[]],
		[['--help']],
		[['-v']],
		[['whatever-an-extension-registered']],
		[['--verbose', 'whatever-an-extension-registered']],
	])('loads the extensions for %j', async (argv) => {
		vi.mocked(loadExtensions).mockClear();

		await createCli(argv);

		expect(vi.mocked(loadExtensions)).toHaveBeenCalledOnce();
	});

	// A flag in front of the command must not be read as the command — every
	// process would load the extensions again, which is the cost being gated.
	it('reads the command past the flags in front of it', async () => {
		vi.mocked(loadExtensions).mockClear();

		await createCli(['--some-option', 'autoscale']);

		expect(vi.mocked(loadExtensions)).not.toHaveBeenCalled();
	});

	// The gate reads this set because it runs before the program exists, so the
	// set is maintained by hand: a command declared here but missing from it loads
	// the extensions for nothing, and a name in it that no command declares turns
	// the gate against the extension that registers that command.
	it('gates exactly the commands the program declares', async () => {
		const program = await createCli(['autoscale']);

		expect(new Set(program.commands.map((command) => command.name())))
			.toEqual(BUILT_IN_COMMANDS);
	});

	// The hooks are what an extension registers on, so they are emitted around the
	// program only when one could have: the emitter's own module carries the
	// database's graph, and a process loading no extension has nothing to hear it.
	it('emits the cli hooks around the extensions it loads', async () => {
		emitInit.mockClear();

		const program = await createCli([]);

		expect(emitInit.mock.calls).toEqual([
			['cli.before', { program }],
			['cli.after', { program }],
		]);
	});

	it('emits no cli hook when it loads no extension', async () => {
		emitInit.mockClear();

		await createCli(['autoscale']);

		expect(emitInit).not.toHaveBeenCalled();
	});
});
