type CommandAction<Args extends unknown[]> = (
	this: unknown,
	...args: Args
) => void | Promise<void>;

// Loading every command at startup costs ~1.2s: build alone drags rolldown,
// terser and the manifest schema, for a run that may only need `link`.
export default function lazyCommand<Args extends unknown[]>(
	loadCommand: () => Promise<{ default: CommandAction<Args> }>,
): CommandAction<Args> {
	return async function (this: unknown, ...args: Args) {
		const { default: runCommand } = await loadCommand();

		return runCommand.apply(this, args);
	};
}
