"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const generate_markdown_js_1 = require("./utils/generate-markdown.js");
const get_info_js_1 = require("./utils/get-info.js");
const process_packages_js_1 = require("./utils/process-packages.js");
const process_release_lines_js_1 = require("./utils/process-release-lines.js");
const { defaultChangelogFunctions, changesets } = (0, process_release_lines_js_1.processReleaseLines)();
// Take over control after `changesets` has finished
process.on('beforeExit', async () => {
    await run();
    process.exit();
});
async function run() {
    const { mainVersion, isPrerelease, prereleaseId, packageVersions } = await (0, process_packages_js_1.processPackages)();
    // Run after `processPackages` to allow package clean-up
    if (changesets.size === 0) {
        earlyExit();
    }
    const { types, untypedPackages, notices } = await (0, get_info_js_1.getInfo)(changesets);
    if (types.length === 0 && untypedPackages.length === 0 && packageVersions.length === 0) {
        earlyExit();
    }
    const markdown = (0, generate_markdown_js_1.generateMarkdown)(notices, types, untypedPackages, packageVersions);
    const divider = '==============================================================';
    process.stdout.write(`${divider}\nDirectus v${mainVersion}\n${divider}\n${markdown}\n${divider}\n`);
    const githubOutput = process.env['GITHUB_OUTPUT'];
    // Set output if running inside a GitHub workflow
    if (githubOutput) {
        const outputs = [
            `DIRECTUS_VERSION=${mainVersion}`,
            `DIRECTUS_PRERELEASE=${isPrerelease}`,
            ...(prereleaseId ? [`DIRECTUS_PRERELEASE_ID=${prereleaseId}`] : []),
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
