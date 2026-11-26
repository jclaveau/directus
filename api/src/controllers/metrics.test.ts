import { oneLine } from '@directus/utils';
import { ForbiddenError } from '@directus/errors';
import { expect, test, vi } from 'vitest';

vi.mock('@directus/env', () => {
	return { useEnv: () => ({ METRICS_TOKENS: ['good-token'] }) };
});

vi.mock('../metrics/index.js', () => ({ useMetrics: () => undefined }));

import router from './metrics.js';

test('a request bearing a token METRICS_TOKENS lists gets through', async () => {
	const next = vi.fn();

	// as: express types no layer's route, the test calls its handler
	await (router.stack[0] as any).route.stack[0].handle(
		{ headers: { authorization: 'Metrics good-token' } },
		{},
		next,
	);

	expect(next).toHaveBeenCalledWith();
});

test(oneLine`
	a request bearing a token METRICS_TOKENS does not list is refused
`, async () => {
	const next = vi.fn();

	await (router.stack[0] as any).route.stack[0].handle(
		{ headers: { authorization: 'Metrics bad-token' } },
		{},
		next,
	);

	expect(next).toHaveBeenCalledWith(new ForbiddenError({
		reason: 'Invalid metrics authorization token',
	}));
});
