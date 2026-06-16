import { appendFile } from "node:fs/promises";
import { getInfo } from "@changesets/get-github-info";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { findWorkspacePackagesNoCheck } from "@pnpm/workspace.find-packages";
import { createPkgGraph } from "@pnpm/workspace.pkgs-graph";
import semver from "semver";

//#region src/config.ts
const config = {
	repo: "directus/directus",
	mainPackage: "directus",
	typedTitles: {
		major: "⚠️ Potential Breaking Changes",
		minor: "✨ New Features & Improvements",
		patch: "🐛 Bug Fixes & Optimizations",
		none: "📎 Misc."
	},
	untypedPackageTitles: {
		docs: "📝 Documentation",
		"tests-blackbox": "🧪 Blackbox Tests"
	},
	versionTitle: "📦 Published Versions",
	noticeType: "major",
	packageOrder: ["@directus/app", "@directus/api"],
	linkedPackages: [["directus", "@directus/app"]]
};
var config_default = config;

//#endregion
//#region src/utils/generate-markdown.ts
function generateMarkdown(notices, types, untypedPackages, packageVersions) {
	let foundNoticeSection = false;
	const noticeTypeTitle = config_default.typedTitles[config_default.noticeType];
	let sections = types.map((type) => {
		if (type.title === noticeTypeTitle) {
			foundNoticeSection = true;
			return {
				title: type.title,
				packages: type.packages,
				notices
			};
		}
		return {
			title: type.title,
			packages: type.packages,
			notices: []
		};
	});
	if (notices.length > 0 && !foundNoticeSection) sections = [{
		title: noticeTypeTitle,
		packages: [],
		notices
	}, ...sections];
	const output = [];
	output.push(formatSections(sections));
	output.push(formatUntypedPackages(untypedPackages));
	output.push(formatPackageVersions(packageVersions));
	return output.filter((o) => o).join("\n\n");
}
function formatSections(sections) {
	const output = [];
	for (const { title, packages, notices } of sections) {
		if (packages.length === 0 && notices.length === 0) continue;
		let lines = `### ${title}`;
		if (notices.length > 0) {
			lines += "\n\n";
			lines += formatNotices(notices);
		}
		if (packages.length > 0) {
			lines += "\n\n";
			lines += formatPackages(packages);
		}
		output.push(lines);
	}
	return output.join("\n\n");
}
function formatNotices(notices) {
	return notices.map((notice) => {
		let lines = `**${formatChange(notice.change, true)}**\n`;
		return lines += `${notice.notice}`;
	}).join("\n\n");
}
function formatPackages(packages) {
	return packages.map(({ name, changes }) => {
		let lines = "";
		if (changes.length > 0) {
			lines += `- **${name}**\n`;
			lines += formatChanges(changes).map((change) => change.split("\n").map((line) => `  ${line}`).join("\n")).join("\n");
		}
		return lines;
	}).join("\n");
}
function formatUntypedPackages(untypedPackages) {
	const output = [];
	for (const { name, changes } of untypedPackages) {
		if (changes.length == 0) continue;
		let lines = `### ${name}\n\n`;
		lines += formatChanges(changes).join("\n");
		output.push(lines);
	}
	return output.join("\n\n");
}
function formatChanges(changes) {
	return changes.map((change) => {
		const lines = [];
		const [firstLine, ...remainingLines] = formatChange(change).split("\n");
		lines.push(`- ${firstLine}`);
		if (remainingLines.length > 0) lines.push(...remainingLines.map((line) => `  ${line}`));
		return lines.join("\n");
	});
}
function formatChange(change, short) {
	let refUser = "";
	const refUserContent = [];
	if (change.githubInfo?.links.pull) refUserContent.push(change.githubInfo.links.pull);
	else if (change.githubInfo?.links.commit) refUserContent.push(change.githubInfo.links.commit);
	else if (change.commit) refUserContent.push(`[${change.commit}](https://github.com/${config_default.repo}/commit/${change.commit})`);
	if (!short && change.githubInfo?.user) refUserContent.push(`by @${change.githubInfo.user}`);
	if (refUserContent.length > 0) {
		refUser = " (";
		refUser += refUserContent.join(" ");
		refUser += ")";
	}
	const [firstSummaryLine, ...remainingSummaryLines] = change.summary.split("\n");
	const title = short && remainingSummaryLines.length > 0 ? `${firstSummaryLine}...` : firstSummaryLine;
	const additionalLines = !short && remainingSummaryLines.length > 0 ? `\n${remainingSummaryLines.join("\n")}` : "";
	return `${title}${refUser}${additionalLines}`;
}
function formatPackageVersions(packageVersions) {
	let lines = "";
	if (packageVersions.length > 0) lines += `### ${config_default.versionTitle}\n`;
	for (const { name, version } of packageVersions) lines += `\n- \`${name}@${version}\``;
	return lines;
}

//#endregion
//#region src/utils/sort.ts
function sortByExternalOrder(order, key) {
	return (a, b) => {
		const indexOfA = order.indexOf(a[key]);
		const indexOfB = order.indexOf(b[key]);
		if (indexOfA >= 0 && indexOfB >= 0) return indexOfA - indexOfB;
		if (indexOfA >= 0) return -1;
		return 0;
	};
}
function sortByObjectValues(object, key) {
	const order = Object.values(object);
	return (a, b) => order.indexOf(a[key]) - order.indexOf(b[key]);
}

//#endregion
//#region src/utils/get-info.ts
async function getInfo$1(changesets$1) {
	const types = [];
	const untypedPackages = [];
	const notices = [];
	for (const { summary, notice, commit, releases } of changesets$1.values()) {
		let githubInfo;
		if (commit) githubInfo = await getInfo({
			repo: config_default.repo,
			commit
		});
		const change = {
			summary,
			commit,
			githubInfo
		};
		if (notice) notices.push({
			notice,
			change
		});
		for (const { type, name } of releases) {
			if (name === config_default.mainPackage || !summary) continue;
			const untypedTitle = config_default.untypedPackageTitles[name];
			if (untypedTitle) {
				const packageInUntypedPackages = untypedPackages.find((p) => p.name === untypedTitle);
				if (packageInUntypedPackages) packageInUntypedPackages.changes.push(change);
				else untypedPackages.push({
					name: untypedTitle,
					changes: [change]
				});
				continue;
			}
			const typeTitle = config_default.typedTitles[type];
			const typeInTypes = types.find((t) => t.title === typeTitle);
			if (typeInTypes) {
				const packageInPackages = typeInTypes.packages.find((p) => p.name === name);
				if (packageInPackages) packageInPackages.changes.push(change);
				else typeInTypes.packages.push({
					name,
					changes: [change]
				});
			} else types.push({
				title: typeTitle,
				packages: [{
					name,
					changes: [change]
				}]
			});
		}
	}
	types.sort(sortByObjectValues(config_default.typedTitles, "title"));
	for (const { packages } of types) packages.sort(sortByExternalOrder(config_default.packageOrder, "name"));
	untypedPackages.sort(sortByObjectValues(config_default.untypedPackageTitles, "name"));
	return {
		types,
		untypedPackages,
		notices
	};
}

//#endregion
//#region src/utils/process-packages.ts
async function processPackages() {
	const workspacePackages = await findWorkspacePackagesNoCheck(process.cwd());
	const packageVersions = /* @__PURE__ */ new Map();
	let dependentsMap;
	for (const localPackage of workspacePackages) {
		const { name, version } = localPackage.manifest;
		if (!name) continue;
		const changelogPath = join(localPackage.rootDir, "CHANGELOG.md");
		if (existsSync(changelogPath)) {
			if (version && !localPackage.manifest.private) packageVersions.set(name, version);
			unlinkSync(changelogPath);
		}
	}
	const { mainVersion, manualMainVersion, isPrerelease, prereleaseId } = getVersionInfo();
	if (manualMainVersion) await bumpPackage(config_default.mainPackage, mainVersion, true);
	for (const [trigger, target] of config_default.linkedPackages) if (packageVersions.has(trigger) && !packageVersions.has(target)) await bumpPackage(target, null, true);
	return {
		mainVersion,
		isPrerelease,
		prereleaseId,
		packageVersions: Array.from(packageVersions, ([name, version]) => ({
			name,
			version
		})).filter(({ name }) => ![config_default.mainPackage, ...Object.keys(config_default.untypedPackageTitles)].includes(name)).sort(sortByExternalOrder(config_default.packageOrder, "name"))
	};
	function getVersionInfo() {
		const manualMainVersion$1 = process.env["DIRECTUS_VERSION"];
		const mainVersion$1 = semver.parse(manualMainVersion$1 ?? packageVersions.get(config_default.mainPackage));
		if (!mainVersion$1) throw new Error(`Main version ('${config_default.mainPackage}' package) is missing or invalid`);
		const isPrerelease$1 = mainVersion$1.prerelease.length > 0;
		let prereleaseId$1;
		if (isPrerelease$1) {
			let tag;
			try {
				const changesetPreFile = join(process.cwd(), ".changeset", "pre.json");
				({tag} = JSON.parse(readFileSync(changesetPreFile, "utf8")));
			} catch {
				throw new Error(`Main version is a prerelease but changesets isn't in prerelease mode`);
			}
			prereleaseId$1 = mainVersion$1.prerelease[0];
			if (typeof prereleaseId$1 !== "string") throw new Error(`Expected a string for prerelease identifier`);
			if (prereleaseId$1 !== tag) throw new Error(`Prerelease identifier of main version doesn't match tag of changesets prerelease mode`);
		}
		return {
			mainVersion: mainVersion$1.version,
			manualMainVersion: manualMainVersion$1,
			isPrerelease: isPrerelease$1,
			prereleaseId: prereleaseId$1
		};
	}
	async function bumpPackage(packageName, version, bumpDependents) {
		const workspacePackage = workspacePackages.find((p) => p.manifest.name === packageName);
		if (!workspacePackage) return;
		if (workspacePackage.manifest.private) return;
		let newVersion = null;
		if (version) newVersion = version;
		else if (workspacePackage.manifest.version) newVersion = semver.inc(workspacePackage.manifest.version, isPrerelease ? "prerelease" : "patch", prereleaseId);
		if (!newVersion) return;
		workspacePackage.manifest.version = newVersion;
		await workspacePackage.writeProjectManifest(workspacePackage.manifest);
		packageVersions.set(packageName, newVersion);
		if (bumpDependents) {
			const dependents = findDependents(packageName);
			for (const dependent of dependents) if (!packageVersions.has(dependent)) await bumpPackage(dependent);
		}
	}
	function getDependentsMap() {
		if (!dependentsMap) {
			const { graph } = createPkgGraph(workspacePackages);
			dependentsMap = transformGraph(graph);
		}
		return dependentsMap;
	}
	function findDependents(packageName, dependentsMap$1 = getDependentsMap(), dependents = [], visited = /* @__PURE__ */ new Set()) {
		if (visited.has(packageName)) return dependents;
		visited.add(packageName);
		const packageDependents = dependentsMap$1[packageName];
		if (!packageDependents || packageDependents.length === 0) return dependents;
		for (const dependent of packageDependents) {
			if (visited.has(dependent)) continue;
			dependents.push(dependent);
			findDependents(dependent, dependentsMap$1, dependents, visited);
		}
		return dependents;
	}
	function transformGraph(graph) {
		const dependentsMap$1 = {};
		for (const dependentNodeId of Object.keys(graph)) {
			const dependentPackage = graph[dependentNodeId];
			const dependentPackageName = dependentPackage?.package.manifest.name;
			if (!dependentPackageName) continue;
			for (const dependencyNodeId of dependentPackage.dependencies) {
				const dependencyPackageName = workspacePackages.find((p) => p.rootDir === dependencyNodeId)?.manifest.name;
				if (!dependencyPackageName) continue;
				if (!dependentsMap$1[dependencyPackageName]) dependentsMap$1[dependencyPackageName] = [dependentPackageName];
				else dependentsMap$1[dependencyPackageName]?.push(dependentPackageName);
			}
		}
		return dependentsMap$1;
	}
}

//#endregion
//#region src/utils/process-release-lines.ts
function processReleaseLines() {
	const changesets$1 = /* @__PURE__ */ new Map();
	const getReleaseLine = async (changeset) => {
		const { id, summary,...rest } = changeset;
		if (changesets$1.has(id)) return "";
		const finalSummary = summary.replace(/^::: notice\n[\s\S]*^:::$/m, "").trim();
		const notice = summary.match(/::: notice\n+([\s\S]*)(?<!\n)\n+:::$/m)?.[1];
		changesets$1.set(id, {
			summary: finalSummary,
			notice,
			...rest
		});
		return "";
	};
	const getDependencyReleaseLine = async () => {
		return "";
	};
	return {
		defaultChangelogFunctions: {
			getReleaseLine,
			getDependencyReleaseLine
		},
		changesets: changesets$1
	};
}

//#endregion
//#region src/index.ts
const { defaultChangelogFunctions, changesets } = processReleaseLines();
process.on("beforeExit", async () => {
	await run();
	process.exit();
});
async function run() {
	const { mainVersion, isPrerelease, prereleaseId, packageVersions } = await processPackages();
	const { types, untypedPackages, notices } = await getInfo$1(changesets);
	if (types.length === 0 && untypedPackages.length === 0 && packageVersions.length === 0) console.warn("WARN: No processable changesets found");
	const markdown = generateMarkdown(notices, types, untypedPackages, packageVersions);
	const divider = "==============================================================";
	console.log(`${divider}\nDirectus v${mainVersion}\n${divider}\n${markdown}\n${divider}`);
	const githubOutput = process.env["GITHUB_OUTPUT"];
	if (githubOutput) await appendFile(githubOutput, `${[
		`DIRECTUS_VERSION=${mainVersion}`,
		`DIRECTUS_PRERELEASE=${isPrerelease}`,
		...prereleaseId ? [`DIRECTUS_PRERELEASE_ID=${prereleaseId}`] : [],
		`DIRECTUS_RELEASE_NOTES<<EOF_RELEASE_NOTES\n${markdown}\nEOF_RELEASE_NOTES`
	].join("\n")}\n`);
}
var src_default = defaultChangelogFunctions;

//#endregion
export { src_default as default };