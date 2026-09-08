import { useEnv } from '@directus/env';
import type { FailOnOptions, Sharp } from 'sharp';

// Loaded on demand: libvips and its statically linked codecs cost ~20 MiB of RSS
// per process, which an instance that never transforms an image shouldn't pay.
// The module cache makes every call after the first one free.
const loadSharp = async () => (await import('sharp')).default;

export async function getSharpInstance(): Promise<Sharp> {
	const env = useEnv();
	const sharp = await loadSharp();

	return sharp({
		limitInputPixels: Math.trunc(Math.pow(env['ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION'] as number, 2)),
		sequentialRead: true,
		failOn: env['ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL'] as FailOnOptions,
	});
}

type SharpCounters = { queue: number; process: number };

export async function getSharpCounters(): Promise<SharpCounters> {
	const sharp = await loadSharp();

	return sharp.counters();
}
