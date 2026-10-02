function e(e,t){return()=>{let n=e();return typeof t==`function`?n.onRequest=t:n.onRequest=e=>({...e,...t}),n}}exports.withOptions=e;
//# sourceMappingURL=with-options.cjs.map