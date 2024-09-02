"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMarkdown = void 0;
const constants_1 = require("../constants");
function generateMarkdown(notices, types, untypedPackages, packageVersions) {
    // Generate sections out of types and include notices
    let foundNoticeSection = false;
    let sections = types.map((type) => {
        if (type.title === constants_1.NOTICE_TYPE) {
            foundNoticeSection = true;
            return { title: type.title, packages: type.packages, notices };
        }
        return { title: type.title, packages: type.packages, notices: [] };
    });
    if (notices.length > 0 && !foundNoticeSection) {
        sections = [{ title: constants_1.NOTICE_TYPE, packages: [], notices }, ...sections];
    }
    const output = [];
    output.push(formatSections(sections));
    output.push(formatUntypedPackages(untypedPackages));
    output.push(formatPackageVersions(packageVersions));
    return output.filter((o) => o).join('\n\n');
}
exports.generateMarkdown = generateMarkdown;
function formatSections(sections) {
    const output = [];
    for (const { title, packages, notices } of sections) {
        if (packages.length === 0 && notices.length === 0) {
            continue;
        }
        let lines = `### ${title}`;
        if (notices.length > 0) {
            lines += '\n\n';
            lines += formatNotices(notices);
        }
        if (packages.length > 0) {
            lines += '\n\n';
            lines += formatPackages(packages);
        }
        output.push(lines);
    }
    return output.join('\n\n');
}
function formatNotices(notices) {
    const output = notices.map((notice) => {
        let lines = `**${formatChange(notice.change, true)}**\n`;
        return (lines += `${notice.notice}`);
    });
    return output.join('\n\n');
}
function formatPackages(packages) {
    const output = packages.map(({ name, changes }) => {
        let lines = '';
        if (changes.length > 0) {
            lines += `- **${name}**\n`;
            lines += formatChanges(changes)
                .map((change) => change
                .split('\n')
                .map((line) => `  ${line}`)
                .join('\n'))
                .join('\n');
        }
        return lines;
    });
    return output.join('\n');
}
function formatUntypedPackages(untypedPackages) {
    const output = [];
    for (const { name, changes } of untypedPackages) {
        if (changes.length == 0) {
            continue;
        }
        let lines = `### ${name}\n\n`;
        lines += formatChanges(changes).join('\n');
        output.push(lines);
    }
    return output.join('\n\n');
}
function formatChanges(changes) {
    return changes.map((change) => {
        const lines = [];
        const [firstLine, ...remainingLines] = formatChange(change).split('\n');
        lines.push(`- ${firstLine}`);
        if (remainingLines.length > 0) {
            lines.push(...remainingLines.map((line) => `  ${line}`));
        }
        return lines.join('\n');
    });
}
function formatChange(change, short) {
    let refUser = '';
    const refUserContent = [];
    if (change.githubInfo?.links.pull) {
        refUserContent.push(change.githubInfo.links.pull);
    }
    else if (change.githubInfo?.links.commit) {
        refUserContent.push(change.githubInfo.links.commit);
    }
    else if (change.commit) {
        refUserContent.push(`[${change.commit}](https://github.com/${constants_1.REPO}/commit/${change.commit})`);
    }
    if (!short && change.githubInfo?.user) {
        refUserContent.push(`by @${change.githubInfo.user}`);
    }
    if (refUserContent.length > 0) {
        refUser = ' (';
        refUser += refUserContent.join(' ');
        refUser += ')';
    }
    const [firstSummaryLine, ...remainingSummaryLines] = change.summary.split('\n');
    const title = short && remainingSummaryLines.length > 0 ? `${firstSummaryLine}...` : firstSummaryLine;
    const additionalLines = !short && remainingSummaryLines.length > 0 ? `\n${remainingSummaryLines.join('\n')}` : '';
    return `${title}${refUser}${additionalLines}`;
}
function formatPackageVersions(packageVersions) {
    let lines = '';
    if (packageVersions.length > 0) {
        lines += `### ${constants_1.VERSIONS_TITLE}\n`;
    }
    for (const { name, version } of packageVersions) {
        lines += `\n- \`${name}@${version}\``;
    }
    return lines;
}
