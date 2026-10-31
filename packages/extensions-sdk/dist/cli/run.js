import { Command } from 'commander';
import getSdkVersion from './utils/get-sdk-version.js';
import lazyCommand from './utils/lazy-command.js';
const program = new Command();
program.name('directus-extension').usage('[command] [options]');
program.version(getSdkVersion(), '-v, --version');
program
    .command('create')
    .arguments('<type> <name>')
    .description('Scaffold a new Directus extension')
    .option('--no-install', 'skip dependency installation after creating extension')
    .option('-l, --language <language>', 'specify the language to use')
    .action(lazyCommand(() => import('./commands/create.js')));
program
    .command('add')
    .description('Add entries to an existing Directus extension')
    .option('--no-install', 'skip dependency (re)installation after adding extension')
    .action(lazyCommand(() => import('./commands/add.js')));
program
    .command('build')
    .description('Bundle a Directus extension to a single entrypoint')
    .option('-t, --type <type>', 'specify the extension type instead of reading from package manifest')
    .option('-i, --input <file>', 'specify the entrypoint instead of reading from package manifest')
    .option('-o, --output <file>', 'specify the output file instead of reading from package manifest')
    .option('-l, --language <language>', '[DEPRECATED]')
    .option('-f, --force', '[DEPRECATED]')
    .option('-e, --external <deps>', 'comma-separated dependencies the api entry resolves at runtime, not bundled')
    .option('--preserve-modules', 'emit the api entrypoint as one file per module, to read rather than to run')
    .option('-w, --watch', 'watch and rebuild on changes')
    .option('--no-minify', 'disable minification')
    .option('--sourcemap', 'include source maps in output')
    .action(lazyCommand(() => import('./commands/build.js')));
program
    .command('unbundle')
    .description("Write a built extension's original sources out of its source map")
    .argument('<bundle>', 'path to the built file, or to its .map')
    .argument('<directory>', 'directory to write the sources into')
    .action(lazyCommand(() => import('./commands/unbundle.js')));
program
    .command('link')
    .description('Creates a symlink to the extension in the Directus extensions folder')
    .argument('<path>', 'path to the extension folder of directus')
    .action(lazyCommand(() => import('./commands/link.js')));
program
    .command('validate')
    .description('Validate the extension against the Directus extensions requirements')
    .option('-c, --check <check>', 'check a specific extension requirement')
    .option('-v --verbose', 'print the full validation report')
    .action(lazyCommand(() => import('./commands/validate.js')));
program.parse(process.argv);
