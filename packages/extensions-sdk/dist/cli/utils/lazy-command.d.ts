type CommandAction<Args extends unknown[]> = (this: unknown, ...args: Args) => void | Promise<void>;
export default function lazyCommand<Args extends unknown[]>(loadCommand: () => Promise<{
    default: CommandAction<Args>;
}>): CommandAction<Args>;
export {};
