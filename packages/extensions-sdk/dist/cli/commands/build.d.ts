/**
 * Packages that only mean something in a browser. An api entrypoint reaching one
 * drags the whole front-end into a bundle every worker parses at boot — one
 * extension in the wild grew a 13.6 MB api entry out of two such imports, and
 * nothing said so at build time.
 */
export declare const APP_ONLY_PACKAGES: string[];
type BuildOptions = {
    type?: string;
    input?: string;
    output?: string;
    external?: string;
    preserveModules?: boolean;
    watch?: boolean;
    minify?: boolean;
    sourcemap?: boolean;
};
export default function build(options: BuildOptions): Promise<void>;
export {};
