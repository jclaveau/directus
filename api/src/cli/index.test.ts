import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../server.js';
import { createCli } from './index.js';

vi.mock('directus/version', () => ({ version: '0.0.0' }));
vi.mock('./load-extensions.js', () => ({ loadExtensions: vi.fn() }));
vi.mock('../emitter.js', () => ({ default: { emitInit: vi.fn() } }));
vi.mock('../server.js', () => ({ startServer: vi.fn() }));

describe('createCli', () => {
	// pm2 cluster mode appends the ecosystem path and a duplicated `start` to the
	// worker argv; the start command must swallow those excess positionals instead of
	// letting commander 14 reject them and crash the boot.
	it('start tolerates the excess argv pm2 cluster injects', async () => {
		const program = await createCli();
		program.exitOverride();

		await program.parseAsync(['start', '/x/ecosystem.config.cjs', 'start'], {
			from: 'user',
		});

		expect(vi.mocked(startServer)).toHaveBeenCalledOnce();
	});
});
