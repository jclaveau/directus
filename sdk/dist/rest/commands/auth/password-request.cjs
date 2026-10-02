const e=(e,t)=>()=>({path:`/auth/password/request`,method:`POST`,body:JSON.stringify({email:e,...t?{reset_url:t}:{}})});exports.passwordRequest=e;
//# sourceMappingURL=password-request.cjs.map