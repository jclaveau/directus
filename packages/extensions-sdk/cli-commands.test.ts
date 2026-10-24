import { execa } from 'execa';
import { expect, test } from 'vitest';

// run.ts imports each command module only when its subcommand runs, so a
// wrong specifier there surfaces on that one command and nowhere else.
// `build` and `validate` are spawned by directus-extension.test.ts already,
// and `add` is left out because it prompts, so it needs a TTY.

test('create refuses an unsupported extension type', async () => {
	await expect(
		execa('node', ['cli.js', 'create', 'nosuchtype', 'foo']),
	).rejects.toEqual(
		expect.objectContaining({
			exitCode: 1,
			stderr:
				'[Error] Extension type nosuchtype is not supported. '
				+ 'Available extension types: interface, display, layout, module, '
				+ 'panel, theme, hook, endpoint, operation, bundle.',
		}),
	);
});

test('unbundle refuses a bundle with no source map', async () => {
	await expect(
		execa('node', ['cli.js', 'unbundle', '/nope/bundle.js', 'out']),
	).rejects.toEqual(
		expect.objectContaining({
			exitCode: 1,
			stderr:
				'[Error] No source map at /nope/bundle.js.map.\n'
				+ '[Error] Build the extension with --sourcemap to get one.',
		}),
	);
});

// link returns instead of exiting on every failure path, so it reports the
// missing folder with the success code.
test('link reports a missing extensions folder', async () => {
	const { exitCode, stderr } = await execa('node', [
		'cli.js',
		'link',
		'/nope/extensions',
	]);

	expect(exitCode).toBe(0);

	expect(stderr).toBe(
		'[Error] Extensions folder does not exist at /nope/extensions',
	);
});
