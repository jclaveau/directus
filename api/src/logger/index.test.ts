import { pinoHttp } from 'pino-http';
import { expect, test, vi } from 'vitest';

vi.mock('@directus/env', () => {
	return {
		useEnv: () => {
			return { LOG_STYLE: 'raw', LOG_HTTP_IGNORE_PATHS: ['/server/ping'] };
		},
	};
});

vi.mock('pino-http', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('pino-http')>()),
		pinoHttp: vi.fn(),
	};
});

import { createExpressLogger } from './index.js';

test('leaves a path LOG_HTTP_IGNORE_PATHS names out of the http log', () => {
	createExpressLogger();

	const { autoLogging } = vi.mocked(pinoHttp).mock.calls[0]![0] as any;

	expect([
		autoLogging.ignore({ url: '/server/ping?x=1' }),
		autoLogging.ignore({ url: '/items/articles' }),
	]).toEqual([true, false]);
});
