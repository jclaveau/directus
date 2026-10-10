import type { EXTENSION_LANGUAGES } from '@directus/extensions';
import type { InputOptions, OutputOptions, Plugin } from 'rolldown';
export type Language = (typeof EXTENSION_LANGUAGES)[number];
export type LanguageShort = 'js' | 'ts';
export type Config = {
    /**
     * Dependencies the api entrypoint resolves at runtime instead of bundling. A
     * string matches an import specifier exactly, so reach a package's subpaths
     * with a regular expression. The app entrypoint ignores these: a browser
     * resolves nothing but the shared deps the host guarantees.
     */
    external?: (string | RegExp)[];
    plugins?: Plugin[];
    watch?: {
        clearScreen?: boolean;
    };
};
export type RolldownConfig = {
    inputOptions: InputOptions;
    outputOptions: OutputOptions;
};
export type Format = 'esm' | 'cjs';
export type Report = {
    level: 'info' | 'warn' | 'error';
    message: string;
};
