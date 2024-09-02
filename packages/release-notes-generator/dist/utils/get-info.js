"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInfo = void 0;
const get_github_info_1 = require("@changesets/get-github-info");
const constants_1 = require("../constants");
const sort_1 = require("./sort");
async function getInfo(changesets) {
    const types = [];
    const untypedPackages = [];
    const notices = [];
    for (const { summary, notice, commit, releases } of changesets.values()) {
        let githubInfo;
        if (commit) {
            githubInfo = await (0, get_github_info_1.getInfo)({
                repo: constants_1.REPO,
                commit: commit,
            });
        }
        const change = { summary, commit, githubInfo };
        if (notice) {
            notices.push({ notice, change });
        }
        for (const { type, name } of releases) {
            if (name === constants_1.MAIN_PACKAGE || !summary) {
                continue;
            }
            if (isUntypedPackage(name)) {
                const untypedPackageName = constants_1.UNTYPED_PACKAGES[name];
                const packageInUntypedPackages = untypedPackages.find((p) => p.name === untypedPackageName);
                if (packageInUntypedPackages) {
                    packageInUntypedPackages.changes.push(change);
                }
                else {
                    untypedPackages.push({
                        name: untypedPackageName,
                        changes: [change],
                    });
                }
                continue;
            }
            const typeTitle = constants_1.TYPE_MAP[type];
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
    types.sort((0, sort_1.sortByObjectValues)(constants_1.TYPE_MAP, 'title'));
    for (const { packages } of types) {
        packages.sort((0, sort_1.sortByExternalOrder)(constants_1.PACKAGE_ORDER, 'name'));
    }
    untypedPackages.sort((0, sort_1.sortByObjectValues)(constants_1.UNTYPED_PACKAGES, 'name'));
    return { types, untypedPackages, notices };
}
exports.getInfo = getInfo;
function isUntypedPackage(name) {
    return Object.prototype.hasOwnProperty.call(constants_1.UNTYPED_PACKAGES, name);
}
