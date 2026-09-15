import { useEnv } from '@directus/env';
import { getSharpCounters, getSharpInstance } from './get-sharp-instance.js';

import { beforeAll, expect, test, vi } from 'vitest';

vi.mock('@directus/env');

vi.mock('sharp', () => {
	const sharp = {
		// using object with default property to mock default import
		default: Object.assign(vi.fn(), {
			counters: vi.fn(() => ({ queue: 2, process: 1 })),
		}),
	};

	return sharp;
});

const ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION = 94906265;
const ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL = 'error';

beforeAll(() => {
	vi.mocked(useEnv).mockReturnValue({
		ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION,
		ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL,
	});
});

test('getSharpInstance should apply the correct options', async () => {
	const sharp = await import('sharp');

	await getSharpInstance();

	expect(sharp.default).toHaveBeenCalledWith({
		limitInputPixels: Math.pow(ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION, 2),
		sequentialRead: true,
		failOn: ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL,
	});
});

test('getSharpCounters should report the queue and process counts', async () => {
	const sharp = await import('sharp');

	await expect(getSharpCounters()).resolves.toEqual({ queue: 2, process: 1 });
	expect(sharp.default.counters).toHaveBeenCalled();
});
