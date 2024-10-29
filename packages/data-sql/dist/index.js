// src/converter/convert-primitive.ts
var convertPrimitive = (abstractPrimitive, collection) => {
  const statement = {
    type: "primitive",
    table: collection,
    column: abstractPrimitive.field
  };
  if (abstractPrimitive.alias) {
    statement.as = abstractPrimitive.alias;
  }
  return statement;
};

// src/utils/param-index-generator.ts
function* parameterIndexGenerator() {
  let index = 0;
  while (true) {
    yield index++;
  }
}

// src/converter/convert-sort.ts
var convertSort = (abstractSorts) => {
  return abstractSorts.map((abstractSort) => {
    return {
      orderBy: abstractSort.target,
      direction: abstractSort.direction === "descending" ? "DESC" : "ASC"
    };
  });
};

// src/converter/convert-filter.ts
var convertFilter = (filter, collection, generator) => {
  return convertFilterWithNegate(filter, collection, generator, false);
};
var convertFilterWithNegate = (filter, collection, generator, negate) => {
  if (filter.type === "condition") {
    if (filter.target.type !== "primitive") {
      throw new Error("Only primitives are currently supported.");
    }
    if (filter.operation === "intersects" || filter.operation === "intersects_bounding_box") {
      throw new Error("The intersects operators are not yet supported.");
    }
    return {
      where: {
        type: "condition",
        negate,
        operation: filter.operation,
        target: {
          column: filter.target.field,
          table: collection,
          type: "primitive"
        },
        compareTo: {
          type: "value",
          parameterIndexes: [generator.next().value]
        }
      },
      parameters: [filter.compareTo.value]
    };
  } else if (filter.type === "negate") {
    return convertFilterWithNegate(filter.childNode, collection, generator, !negate);
  } else {
    const children = filter.childNodes.map(
      (childNode) => convertFilterWithNegate(childNode, collection, generator, false)
    );
    return {
      where: {
        type: "logical",
        negate,
        operator: filter.operator,
        childNodes: children.map((child) => child.where)
      },
      parameters: children.flatMap((child) => child.parameters)
    };
  }
};

// src/converter/index.ts
var convertAbstractQueryToAbstractSqlQuery = (abstractQuery) => {
  const statement = {
    select: abstractQuery.nodes.map((abstractNode) => {
      switch (abstractNode.type) {
        case "primitive":
          return convertPrimitive(abstractNode, abstractQuery.collection);
        case "fn":
        case "m2o":
        case "o2m":
        case "a2o":
        case "o2a":
        default:
          throw new Error(`Type ${abstractNode.type} hasn't been implemented yet`);
      }
    }),
    from: abstractQuery.collection,
    parameters: []
  };
  const idGen = parameterIndexGenerator();
  if (abstractQuery.modifiers?.filter) {
    const convertedFilter = convertFilter(abstractQuery.modifiers.filter, abstractQuery.collection, idGen);
    statement.where = convertedFilter.where;
    statement.parameters.push(...convertedFilter.parameters);
  }
  if (abstractQuery.modifiers?.limit) {
    statement.limit = { parameterIndex: idGen.next().value };
    statement.parameters.push(abstractQuery.modifiers.limit.value);
  }
  if (abstractQuery.modifiers?.offset) {
    statement.offset = { parameterIndex: idGen.next().value };
    statement.parameters.push(abstractQuery.modifiers.offset.value);
  }
  if (abstractQuery.modifiers?.sort) {
    statement.order = convertSort(abstractQuery.modifiers.sort);
  }
  return statement;
};
export {
  convertAbstractQueryToAbstractSqlQuery
};
