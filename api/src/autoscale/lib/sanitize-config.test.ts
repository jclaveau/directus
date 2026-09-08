import { describe, expect, test } from 'vitest';
import type { AutoscaleConfig } from '../types.js';
import {
	AUTOSCALE_DEFAULTS,
	MAX_SUPPORTED_WORKERS,
	sanitizeConfig,
} from './sanitize-config.js';

const base: AutoscaleConfig = {
	enabled: true,
	strategy: 'scalabus',
	appName: 'api',
	signal: 'average',
	scaleCpuThreshold: 60,
	releaseCpuThreshold: 40,
	minWorkers: 1,
	maxWorkers: 4,
	prewarmWorkers: 0,
	minSecondsToScaleUp: 10,
	minSecondsToScaleDown: 300,
	warmupSeconds: 30,
};

test('leaves a sane configuration alone and reports nothing', () => {
	const { config, corrections } = sanitizeConfig(base);

	expect(config).toEqual(base);
	expect(corrections).toEqual([]);
});

describe('worker bounds', () => {
	// The floor and the ceiling are each corrected without a cooldown, so a
	// floor above the ceiling makes the pool grow and shrink on alternate
	// ticks for as long as both stand.
	test('a floor above the ceiling is pulled down to it', () => {
		const { config, corrections } = sanitizeConfig({
			...base,
			minWorkers: 5,
			maxWorkers: 3,
		});

		expect(config.minWorkers).toBe(3);
		expect(config.maxWorkers).toBe(3);
		expect(corrections).toEqual(['minWorkers 5 -> 3']);
	});

	test('a ceiling past what is supported is capped', () => {
		const { config } = sanitizeConfig({ ...base, maxWorkers: 10_000 });

		expect(config.maxWorkers).toBe(MAX_SUPPORTED_WORKERS);
	});

	test('a floor past what is supported lands on the ceiling', () => {
		const { config } = sanitizeConfig({ ...base, minWorkers: 10_000 });

		expect(config.minWorkers).toBe(base.maxWorkers);
	});

	test('a negative ceiling becomes one worker, not none', () => {
		const { config } = sanitizeConfig({
			...base,
			minWorkers: -5,
			maxWorkers: -5,
		});

		expect(config.maxWorkers).toBe(1);
		expect(config.minWorkers).toBe(1);
	});

	test('prewarm cannot exceed the ceiling', () => {
		const { config } = sanitizeConfig({ ...base, prewarmWorkers: 99 });

		expect(config.prewarmWorkers).toBe(base.maxWorkers);
	});
});

describe('thresholds', () => {
	// At the ceiling the add branch is skipped for want of room and the
	// release branch fires on the same reading, so the pool drops a worker and
	// takes it straight back.
	test('a release threshold at the scale threshold is pushed below it', () => {
		const { config, corrections } = sanitizeConfig({
			...base,
			scaleCpuThreshold: 60,
			releaseCpuThreshold: 60,
		});

		expect(config.releaseCpuThreshold).toBe(59);
		expect(corrections).toEqual(['releaseCpuThreshold 60 -> 59']);
	});

	test('a release threshold above the scale threshold is pushed below it', () => {
		const { config } = sanitizeConfig({
			...base,
			scaleCpuThreshold: 60,
			releaseCpuThreshold: 80,
		});

		expect(config.releaseCpuThreshold).toBe(59);
	});

	test('a threshold past a percentage is clamped to one', () => {
		const { config } = sanitizeConfig({
			...base,
			scaleCpuThreshold: 400,
			releaseCpuThreshold: -20,
		});

		expect(config.scaleCpuThreshold).toBe(100);
		expect(config.releaseCpuThreshold).toBe(0);
	});
});

describe('values that are not numbers at all', () => {
	// An env var the type map cannot cast arrives as NaN, and NaN satisfies
	// neither comparison: the pool would stop scaling in either direction and
	// log nothing about why.
	test('a NaN threshold is replaced rather than frozen', () => {
		const { config, corrections } = sanitizeConfig({
			...base,
			scaleCpuThreshold: Number.NaN,
		});

		expect(Number.isNaN(config.scaleCpuThreshold)).toBe(false);
		expect(corrections.length).toBeGreaterThan(0);
	});

	// Its default, not zero: zero is a cooldown that never holds anything
	// back, which is a worse answer than the one nobody chose.
	test('a NaN cooldown falls back to its default', () => {
		const { config } = sanitizeConfig({
			...base,
			minSecondsToScaleDown: Number.NaN,
		});

		expect(config.minSecondsToScaleDown).toBe(
			AUTOSCALE_DEFAULTS.minSecondsToScaleDown,
		);
	});

	test('an unknown signal falls back to the one that converges', () => {
		const { config, corrections } = sanitizeConfig({
			...base,
			signal: 'nonsense' as never,
		});

		expect(config.signal).toBe('average');
		expect(corrections).toEqual(['signal nonsense -> average']);
	});

	// An operator reaching for the module's rule is reverting an incident, so
	// a typo has to say so rather than leave them on the rule they believe
	// they have just left.
	test('an unknown strategy falls back to this autoscaler own rule', () => {
		const { config, corrections } = sanitizeConfig({
			...base,
			strategy: 'lgeacy' as never,
		});

		expect(config.strategy).toBe('scalabus');
		expect(corrections).toEqual(['strategy lgeacy -> scalabus']);
	});

	test('the module rule is selectable by name', () => {
		const { config, corrections } = sanitizeConfig({
			...base,
			strategy: 'legacy',
		});

		expect(config.strategy).toBe('legacy');
		expect(corrections).toEqual([]);
	});
});
