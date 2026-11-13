import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	Reporter,
	ReportedHookContext,
	TestModule,
} from 'vitest/node';
import { timingsDir } from '../utils/record-timing';
import { flatAfterList, sequentialTestsList } from './sequential-tests';
import { fileWeight } from './shard-files';

interface HookTiming {
	name: ReportedHookContext['name'];
	scope: string;
	startMs: number;
	endMs?: number;
}

interface ModuleTiming {
	file: string;
	project: string;
	queuedMs?: number;
	startMs?: number;
	endMs?: number;
	hooks: HookTiming[];
}

/**
 * Writes `timings/modules.json` at the end of a run: when each file was queued,
 * started and ended relative to the run's start, its own diagnostics, every
 * hook and every test. Alongside `gate.jsonl` (time spent behind the sequential
 * barrier) and `boots.jsonl` (time each spawned instance took to answer), it is
 * what CI uploads per shard and `setup/timings-summary.mjs` reads back.
 *
 * Hook and module times are taken in the main process when vitest reports them,
 * so they carry its reporting delay — tens of milliseconds, against hooks that
 * spawn servers and wait out windows for seconds.
 */
export default class TimingsReporter implements Reporter {
	private runStartedAt = Date.now();
	private readonly moduleTimings = new Map<string, ModuleTiming>();

	onTestRunStart() {
		this.runStartedAt = Date.now();
	}

	onTestModuleQueued(testModule: TestModule) {
		this.timingOf(testModule).queuedMs = this.elapsedMs();
	}

	onTestModuleStart(testModule: TestModule) {
		this.timingOf(testModule).startMs = this.elapsedMs();
	}

	onTestModuleEnd(testModule: TestModule) {
		this.timingOf(testModule).endMs = this.elapsedMs();
	}

	onHookStart(hook: ReportedHookContext) {
		const testModule = hook.entity.type === 'module'
			? hook.entity
			: hook.entity.module;

		this.timingOf(testModule).hooks.push({
			name: hook.name,
			scope: hookScope(hook),
			startMs: this.elapsedMs(),
		});
	}

	onHookEnd(hook: ReportedHookContext) {
		const testModule = hook.entity.type === 'module'
			? hook.entity
			: hook.entity.module;

		const scope = hookScope(hook);

		const openHook = this.timingOf(testModule).hooks.findLast((entry) => {
			return entry.name === hook.name
				&& entry.scope === scope
				&& entry.endMs === undefined;
		});

		if (openHook) {
			openHook.endMs = this.elapsedMs();
		}
	}

	onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
		const modules = testModules.map((testModule) => {
			const timing = this.timingOf(testModule);
			const diagnostic = testModule.diagnostic();

			const tests = [...testModule.children.allTests()].map((testCase) => {
				const testDiagnostic = testCase.diagnostic();

				return {
					name: testCase.fullName,
					state: testCase.result().state,
					startMs: testDiagnostic
						? testDiagnostic.startTime - this.runStartedAt
						: undefined,
					durationMs: testDiagnostic?.duration,
				};
			});

			return {
				...timing,
				phase: phaseOf(timing.file, timing.project),
				// What the shard packer assumed the file costs, next to what it did.
				weight: fileWeight(testModule.moduleId),
				state: testModule.state(),
				diagnostic: {
					environmentSetupMs: diagnostic.environmentSetupDuration,
					prepareMs: diagnostic.prepareDuration,
					collectMs: diagnostic.collectDuration,
					setupMs: diagnostic.setupDuration,
					durationMs: diagnostic.duration,
				},
				tests,
			};
		});

		mkdirSync(timingsDir, { recursive: true });

		writeFileSync(
			join(timingsDir, 'modules.json'),
			JSON.stringify({
				runStartedAt: this.runStartedAt,
				shardIndex: process.env['SHARD_INDEX'],
				shardCount: process.env['SHARD_COUNT'],
				vendor: process.env['TEST_DB'],
				modules,
			}, null, '\t'),
		);
	}

	private elapsedMs(): number {
		return Date.now() - this.runStartedAt;
	}

	private timingOf(testModule: TestModule): ModuleTiming {
		let timing = this.moduleTimings.get(testModule.moduleId);

		if (!timing) {
			timing = {
				file: testModule.moduleId.split('blackbox')[1] ?? testModule.moduleId,
				project: testModule.project.name,
				hooks: [],
			};

			this.moduleTimings.set(testModule.moduleId, timing);
		}

		return timing;
	}
}

function hookScope(hook: ReportedHookContext): string {
	if (hook.entity.type === 'module') {
		return 'module';
	}

	return hook.entity.fullName;
}

function phaseOf(file: string, project: string): string {
	if (project !== 'db' && project !== 'common') {
		return 'middle';
	}

	if (sequentialTestsList[project].before.includes(file)) {
		return 'before';
	}

	if (flatAfterList(project).includes(file)) {
		return 'after';
	}

	return 'middle';
}
