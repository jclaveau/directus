import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { importCodeBundles, listMigrationEntries } from './import-code-bundles.js';

let extensionsDir = '';

beforeEach(async () => {
	extensionsDir = await mkdtemp(join(tmpdir(), 'code-bundles-'));
});

afterEach(async () => {
	await rm(extensionsDir, { recursive: true, force: true });
});

describe('importCodeBundles', () => {
	test('imports the api of the code bundles, collecting a failing one', async () => {
		await mkdir(join(extensionsDir, 'orders'));
		await mkdir(join(extensionsDir, 'broken'));

		await writeFile(
			join(extensionsDir, 'orders', 'api.mjs'),
			'export default { format: "scalabus/1", entries: ['
				+ '{ type: "hook", name: "audit", config: "hook-config" }] };',
		);

		await writeFile(
			join(extensionsDir, 'broken', 'api.mjs'),
			'throw new Error("broken bundle");',
		);

		const importResult = await importCodeBundles(
			{
				module: new Map([
					[
						'orders',
						{
							type: 'bundle',
							name: 'orders-bundle',
							path: join(extensionsDir, 'orders'),
							entrypoint: { app: 'app.mjs', api: 'api.mjs' },
							entriesFrom: 'code',
						},
					],
					[
						'app-only',
						{
							type: 'bundle',
							name: 'app-only-bundle',
							path: join(extensionsDir, 'app-only'),
							entrypoint: { app: 'app.mjs', api: 'api.mjs' },
							entriesFrom: 'code',
						},
					],
					[
						'legacy',
						{
							type: 'bundle',
							name: 'legacy-bundle',
							path: join(extensionsDir, 'legacy'),
							entrypoint: { app: 'app.mjs', api: 'api.mjs' },
						},
					],
				]) as never,
				registry: new Map([
					[
						'broken',
						{
							type: 'bundle',
							name: 'broken-bundle',
							path: join(extensionsDir, 'broken'),
							entrypoint: { app: 'app.mjs', api: 'api.mjs' },
							entriesFrom: 'code',
						},
					],
				]) as never,
			},
			{ fresh: false },
		);

		expect(importResult).toEqual({
			codeBundles: [
				{
					source: 'module',
					folder: 'orders',
					name: 'orders-bundle',
					apiPath: join(extensionsDir, 'orders', 'api.mjs'),
					entries: [{ type: 'hook', name: 'audit', config: 'hook-config' }],
				},
			],
			failures: [{ name: 'broken-bundle', error: new Error('broken bundle') }],
		});
	});

	test('imports a code bundle on a fresh load too', async () => {
		await mkdir(join(extensionsDir, 'orders'));

		await writeFile(
			join(extensionsDir, 'orders', 'api.mjs'),
			'export default { format: "scalabus/1", entries: ['
				+ '{ type: "endpoint", name: "orders", config: "endpoint-config" }] };',
		);

		const importResult = await importCodeBundles(
			{
				module: new Map([
					[
						'orders',
						{
							type: 'bundle',
							name: 'orders-bundle',
							path: join(extensionsDir, 'orders'),
							entrypoint: { app: 'app.mjs', api: 'api.mjs' },
							entriesFrom: 'code',
						},
					],
				]) as never,
				registry: new Map(),
			},
			{ fresh: true },
		);

		expect(importResult).toEqual({
			codeBundles: [
				{
					source: 'module',
					folder: 'orders',
					name: 'orders-bundle',
					apiPath: join(extensionsDir, 'orders', 'api.mjs'),
					entries: [
						{ type: 'endpoint', name: 'orders', config: 'endpoint-config' },
					],
				},
			],
			failures: [],
		});
	});
});

describe('listMigrationEntries', () => {
	test('lists the migration entries with their bundle name', () => {
		expect(
			listMigrationEntries([
				{
					source: 'module',
					folder: 'orders',
					name: 'orders-bundle',
					apiPath: '/extensions/orders/api.mjs',
					entries: [
						{ type: 'hook', name: 'audit', config: 'hook-config' },
						{
							type: 'migration',
							name: '20260212A-add-orders',
							config: 'migration-config',
						},
					] as never,
				},
			]),
		).toEqual([
			{
				bundle: 'orders-bundle',
				name: '20260212A-add-orders',
				config: 'migration-config',
			},
		]);
	});
});
