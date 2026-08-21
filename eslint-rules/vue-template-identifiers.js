// Names an SFC's `<template>` mentions. Both single-use rules leave those alone: a
// template expression cannot take a function body or a multi-line initializer, and
// what inline template code can reach is not what the script can — so "inline it at
// its one use" is not an instruction that can be carried out there.
//
// `ref="el"` and `<style> v-bind(x)` bind by string rather than by expression, so
// they are not identifiers here and stay invisible.
export function vueTemplateIdentifiers(sourceCode) {
  const names = new Set()
  const walked = new Set()

  const walk = (node) => {
    if (!node || typeof node !== `object` || walked.has(node)) {
      return
    }

    walked.add(node)

    if (node.type === `Identifier` && typeof node.name === `string`) {
      names.add(node.name)
    }

    for (const [key, value] of Object.entries(node)) {
      // The parent link would walk back out into the whole document.
      if (key === `parent`) {
        continue
      }

      if (Array.isArray(value)) {
        value.forEach(walk)
      } else if (value && typeof value.type === `string`) {
        walk(value)
      }
    }
  }

  walk(sourceCode.ast.templateBody)

  return names
}

// An export names a symbol for other files; it is not a use of it here. Both rules
// count uses, so the reference standing in an export list has to be left out —
// `export { x }` and `export default x` alike.
export function isExportReference(reference) {
  const parent = reference.identifier.parent

  return parent.type === `ExportSpecifier`
    || parent.type === `ExportDefaultDeclaration`
}
