const e=(e,t=!1)=>()=>({method:`POST`,path:`/schema/diff`,params:t?{force:t}:{},body:JSON.stringify(e)});exports.schemaDiff=e;
//# sourceMappingURL=diff.cjs.map