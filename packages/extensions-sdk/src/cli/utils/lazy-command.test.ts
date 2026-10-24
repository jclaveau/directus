import { expect, test, vi } from 'vitest';
import lazyCommand from './lazy-command.js';

test('the wrapped action runs on the receiver commander applied', async () => {
	const command = { name: 'build' };
	const runCommand = vi.fn();

	await lazyCommand(() => Promise.resolve({ default: runCommand }))
		.apply(command, [{ watch: true }]);

	expect(runCommand.mock.contexts).toEqual([command]);
	expect(runCommand).toHaveBeenCalledWith({ watch: true });
});
