// Loading every command at startup costs ~1.2s: build alone drags rolldown,
// terser and the manifest schema, for a run that may only need `link`.
export default function lazyCommand(loadCommand) {
    return async function (...args) {
        const { default: runCommand } = await loadCommand();
        return runCommand.apply(this, args);
    };
}
