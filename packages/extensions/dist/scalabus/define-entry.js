//#region src/scalabus/define-entry.ts
const BUNDLE_ENTRIES_FORMAT = "scalabus/1";
const MIGRATION_PHASES = ["before-schema", "after-schema"];
const MIGRATION_NAME_PATTERN = /^\d{8}[A-Z]-[a-z0-9]+(?:-[a-z0-9]+)*$/;
function defineHook(name, config) {
	return {
		type: "hook",
		name,
		config
	};
}
function defineEndpoint(name, config) {
	return {
		type: "endpoint",
		name,
		config
	};
}
function defineOperationApi(name, config) {
	return {
		type: "operation",
		name,
		config
	};
}
function defineMigration(name, config) {
	if (!MIGRATION_NAME_PATTERN.test(name)) throw new Error(`Migration entry ${JSON.stringify(name)} must be named "<date><letter>-<slug>", like "20260212A-add-orders"`);
	const phase = config.phase ?? "before-schema";
	if (!MIGRATION_PHASES.includes(phase)) throw new Error(`Migration entry ${JSON.stringify(name)} declares an unknown phase ${JSON.stringify(phase)}; expected "before-schema" or "after-schema"`);
	return {
		type: "migration",
		name,
		config: {
			...config,
			phase
		}
	};
}
function defineInterface(name, config) {
	return {
		type: "interface",
		name,
		config
	};
}
function defineDisplay(name, config) {
	return {
		type: "display",
		name,
		config
	};
}
function defineLayout(name, config) {
	return {
		type: "layout",
		name,
		config
	};
}
function defineModule(name, config) {
	return {
		type: "module",
		name,
		config
	};
}
function definePanel(name, config) {
	return {
		type: "panel",
		name,
		config
	};
}
function defineTheme(name, config) {
	return {
		type: "theme",
		name,
		config
	};
}
function defineOperationApp(name, config) {
	return {
		type: "operation",
		name,
		config
	};
}
function refuseRepeatedNames(entries) {
	const seenNames = /* @__PURE__ */ new Set();
	for (const { name } of entries) {
		if (seenNames.has(name)) throw new Error(`Bundle entries repeat the name ${JSON.stringify(name)}`);
		seenNames.add(name);
	}
}
function defineBundleApi(entries) {
	refuseRepeatedNames(entries);
	return {
		format: BUNDLE_ENTRIES_FORMAT,
		entries
	};
}
function defineBundleApp(entries) {
	refuseRepeatedNames(entries);
	return {
		format: BUNDLE_ENTRIES_FORMAT,
		entries
	};
}

//#endregion
export { BUNDLE_ENTRIES_FORMAT, MIGRATION_PHASES, defineBundleApi, defineBundleApp, defineDisplay, defineEndpoint, defineHook, defineInterface, defineLayout, defineMigration, defineModule, defineOperationApi, defineOperationApp, definePanel, defineTheme };