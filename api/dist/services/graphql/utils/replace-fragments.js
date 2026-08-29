import { flatten } from "lodash-es";

//#region src/services/graphql/utils/replace-fragments.ts
/**
* Replace all fragments in a selectionset for the actual selection set as defined in the fragment
* Effectively merges the selections with the fragments used in those selections
*/
function replaceFragmentsInSelections(selections, fragments) {
	if (!selections) return null;
	return flatten(selections.map((selection) => {
		if (selection.kind === "FragmentSpread") return replaceFragmentsInSelections(fragments[selection.name.value].selectionSet.selections, fragments);
		if ((selection.kind === "Field" || selection.kind === "InlineFragment") && selection.selectionSet) selection.selectionSet.selections = replaceFragmentsInSelections(selection.selectionSet.selections, fragments);
		return selection;
	})).filter((s) => s);
}

//#endregion
export { replaceFragmentsInSelections };