"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const constants_1 = require("./constants");
const generate_markdown_1 = require("./utils/generate-markdown");
const get_info_1 = require("./utils/get-info");
const process_packages_1 = require("./utils/process-packages");
const process_release_lines_1 = require("./utils/process-release-lines");
const { defaultChangelogFunctions, changesets } = (0, process_release_lines_1.processReleaseLines)();
process.on('beforeExit', async () => {
    await run();
    process.exit();
});
async function run() {
    const { mainVersion, packageVersions } = await (0, process_packages_1.processPackages)();
    if (changesets.size === 0) {
        earlyExit();
    }
    if (!mainVersion) {
        throw new Error(`Couldn't get main version ('${constants_1.MAIN_PACKAGE}' package)`);
    }
    const { types, untypedPackages, notices } = await (0, get_info_1.getInfo)(changesets);
    if (types.length === 0 && untypedPackages.length === 0 && packageVersions.length === 0) {
        earlyExit();
    }
    const markdown = (0, generate_markdown_1.generateMarkdown)(notices, types, untypedPackages, packageVersions);
    const divider = '==============================================================';
    process.stdout.write(`${divider}\n${markdown}\n${divider}\n`);
    const githubOutput = process.env['GITHUB_OUTPUT'];
    // Set output if running inside a GitHub workflow
    if (githubOutput) {
        const outputs = [
            `DIRECTUS_MAIN_VERSION=${mainVersion}`,
            `DIRECTUS_RELEASE_NOTES<<EOF_RELEASE_NOTES\n${markdown}\nEOF_RELEASE_NOTES`,
        ];
        (0, node_fs_1.appendFileSync)(githubOutput, `${outputs.join('\n')}\n`);
    }
}
function earlyExit() {
    process.stdout.write('No (processable) changesets found: Skipping generation of release notes\n');
    process.exit();
}
exports.default = defaultChangelogFunctions;
