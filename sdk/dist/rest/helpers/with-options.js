function e(e,t){return()=>{let n=e();return typeof t==`function`?n.onRequest=t:n.onRequest=e=>({...e,...t}),n}}export{e as withOptions};
//# sourceMappingURL=with-options.js.map