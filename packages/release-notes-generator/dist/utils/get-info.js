"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInfo = void 0;
const get_github_info_1 = require("@changesets/get-github-info");
const config_js_1 = __importDefault(require("../config.js"));
const sort_js_1 = require("./sort.js");
async function getInfo(changesets) {
    const types = [];
    const untypedPackages = [];
    const notices = [];
    for (const { summary, notice, commit, releases } of changesets.values()) {
        let githubInfo;
        if (commit) {
            githubInfo = await (0, get_github_info_1.getInfo)({
                repo: config_js_1.default.repo,
                commit: commit,
            });
        }
        const change = { summary, commit, githubInfo };
        if (notice) {
            notices.push({ notice, change });
        }
        for (const { type, name } of releases) {
            if (name === config_js_1.default.mainPackage || !summary) {
                continue;
            }
            const untypedTitle = config_js_1.default.untypedPackageTitles[name];
            if (untypedTitle) {
                const packageInUntypedPackages = untypedPackages.find((p) => p.name === untypedTitle);
                if (packageInUntypedPackages) {
                    packageInUntypedPackages.changes.push(change);
                }
                else {
                    untypedPackages.push({
                        name: untypedTitle,
                        changes: [change],
                    });
                }
                continue;
            }
            const typeTitle = config_js_1.default.typedTitles[type];
            const typeInTypes = types.find((t) => t.title === typeTitle);
            if (typeInTypes) {
                const packageInPackages = typeInTypes.packages.find((p) => p.name === name);
                if (packageInPackages) {
                    packageInPackages.changes.push(change);
                }
                else {
                    typeInTypes.packages.push({
                        name,
                        changes: [change],
                    });
                }
            }
            else {
                types.push({ title: typeTitle, packages: [{ name, changes: [change] }] });
            }
        }
    }
    types.sort((0, sort_js_1.sortByObjectValues)(config_js_1.default.typedTitles, 'title'));
    for (const { packages } of types) {
        packages.sort((0, sort_js_1.sortByExternalOrder)(config_js_1.default.packageOrder, 'name'));
    }
    untypedPackages.sort((0, sort_js_1.sortByObjectValues)(config_js_1.default.untypedPackageTitles, 'name'));
    return { types, untypedPackages, notices };
}
exports.getInfo = getInfo;
