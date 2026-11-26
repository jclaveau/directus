import { ForbiddenError } from '@directus/errors';
import { expect, test, vi } from 'vitest';

vi.mock('@directus/env', () => {
	return { useEnv: () => ({ METRICS_TOKENS: ['good-token'] }) };
});

vi.mock('../metrics/index.js', () => ({ useMetrics: () => undefined }));

import router from './metrics.js';

test.each([
	{ authorization: 'Metrics good-token', error: undefined },
	{
		authorization: 'Metrics bad-token',
		error: new ForbiddenError({
			reason: 'Invalid metrics authorization token',
		}),
	},
])('a request bearing $authorization gets past the guard: $error', async ({
	authorization,
	error,
}) => {
	const next = vi.fn();

	await (router.stack[0] as any).route.stack[0].handle(
		{ headers: { authorization } },
		{},
		next,
	);

	expect(next).toHaveBeenCalledWith(error);
});
