const e=(e,t=!1)=>()=>({method:`POST`,path:`/schema/diff`,params:t?{force:t}:{},body:JSON.stringify(e)});export{e as schemaDiff};
//# sourceMappingURL=diff.js.map