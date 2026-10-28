//#region src/cli/commands/edge/railway.ts
/**
* The most clauses one rule's condition may hold:
* https://docs.railway.com/networking/edge-rules
*/
const RAILWAY_CLAUSES_PER_RULE = 32;
/**
* A Railway edge ruleset letting these root paths through and blocking every
* other, as `Import` in the service's Edge Rules editor or the
* `updateServiceEdgeRules` mutation takes it.
*
* Each root becomes two clauses, `eq /root` and `matches /root/*`, since `*`
* alone matches `/root` but also `/rootkit`: `/admin*` would let `/administrator`
* through, which is the kind of path the block is for. The clauses are dealt
* into as many allow rules as the per-rule cap needs, in priority order, and the
* block rule comes last; the first rule a request matches decides it.
*
* Railway compares paths case-sensitively where Express does not: `/Items`
* reaches the API bare but stops at the edge. The count of rules a service may
* hold is a plan limit the docs leave unnamed; `validateServiceEdgeRules`
* reports it before an apply.
*/
function railwayAllowListRuleset(rootPaths, blockStatus) {
	const clauses = rootPaths.flatMap(clausesOf);
	const groups = [];
	for (let i = 0; i < clauses.length; i += RAILWAY_CLAUSES_PER_RULE) groups.push(clauses.slice(i, i + RAILWAY_CLAUSES_PER_RULE));
	const rules = groups.map((group, index) => {
		return {
			description: `Allow the API's routes (${index + 1}/${groups.length})`,
			priority: index + 1,
			enabled: true,
			if: group.length === 1 ? group[0] : { or: group },
			then: { action: "allow" }
		};
	});
	rules.push({
		description: "Block every other path",
		priority: groups.length + 1,
		enabled: true,
		if: {
			attr: "http.path",
			op: "matches",
			value: "*"
		},
		then: {
			action: "block",
			params: { status: blockStatus }
		}
	});
	return {
		version: 1,
		rules
	};
}
function clausesOf(rootPath) {
	const exact = {
		attr: "http.path",
		op: "eq",
		value: rootPath
	};
	if (rootPath === "/") return [exact];
	return [exact, {
		attr: "http.path",
		op: "matches",
		value: `${rootPath}/*`
	}];
}

//#endregion
export { RAILWAY_CLAUSES_PER_RULE, railwayAllowListRuleset };