const e=(e,t)=>()=>({path:`/auth/password/request`,method:`POST`,body:JSON.stringify({email:e,...t?{reset_url:t}:{}})});export{e as passwordRequest};
//# sourceMappingURL=password-request.js.map