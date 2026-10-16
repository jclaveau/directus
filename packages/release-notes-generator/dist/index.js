"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
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
    const { types, untypedPackages, notices } = await (0, get_info_js_1.getInfo)(changesets);
    if (types.length === 0 && untypedPackages.length === 0 && packageVersions.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('WARN: No processable changesets found');
    }
    const markdown = (0, generate_markdown_js_1.generateMarkdown)(notices, types, untypedPackages, packageVersions);
    const divider = '==============================================================';
    // eslint-disable-next-line no-console
    console.log(`${divider}\nDirectus v${mainVersion}\n${divider}\n${markdown}\n${divider}`);
    const githubOutput = process.env['GITHUB_OUTPUT'];
    // Set outputs if running inside a GitHub workflow
    if (githubOutput) {
        const outputs = [
            `DIRECTUS_VERSION=${mainVersion}`,
            `DIRECTUS_PRERELEASE=${isPrerelease}`,
            ...(prereleaseId ? [`DIRECTUS_PRERELEASE_ID=${prereleaseId}`] : []),
            `DIRECTUS_RELEASE_NOTES<<EOF_RELEASE_NOTES\n${markdown}\nEOF_RELEASE_NOTES`,
        ];
        await (0, promises_1.appendFile)(githubOutput, `${outputs.join('\n')}\n`);
    }
}
exports.default = defaultChangelogFunctions;
