import{g as y,b as w,a as S}from"./index.c1b672a5.entry.js";import{a as E}from"./javascript-87810ec2.js";function O(l,v){for(var i=0;i<v.length;i++){const s=v[i];if(typeof s!="string"&&!Array.isArray(s)){for(const u in s)if(u!=="default"&&!(u in l)){const r=Object.getOwnPropertyDescriptor(s,u);r&&Object.defineProperty(l,u,r.get?r:{enumerable:!0,get:()=>s[u]})}}}return Object.freeze(Object.defineProperty(l,Symbol.toStringTag,{value:"Module"}))}var T={exports:{}};(function(l,v){(function(i){i(w(),S(),E)})(function(i){function s(r,c,o,a){this.state=r,this.mode=c,this.depth=o,this.prev=a}function u(r){return new s(i.copyState(r.mode,r.state),r.mode,r.depth,r.prev&&u(r.prev))}i.defineMode("jsx",function(r,c){var o=i.getMode(r,{name:"xml",allowMissing:!0,multilineTagIndentPastTag:!1,allowMissingTagName:!0}),a=i.getMode(r,c&&c.base||"javascript");function j(e){var n=e.tagName;e.tagName=null;var t=o.indent(e,"","");return e.tagName=n,t}function g(e,n){return n.context.mode==o?b(e,n,n.context):x(e,n,n.context)}function b(e,n,t){if(t.depth==2)return e.match(/^.*?\*\//)?t.depth=1:e.skipToEnd(),"comment";if(e.peek()=="{"){o.skipAttribute(t.state);var f=j(t.state),p=t.state.context;if(p&&e.match(/^[^>]*>\s*$/,!1)){for(;p.prev&&!p.startOfLine;)p=p.prev;p.startOfLine?f-=r.indentUnit:t.prev.state.lexical&&(f=t.prev.state.lexical.indented)}else t.depth==1&&(f+=r.indentUnit);return n.context=new s(i.startState(a,f),a,0,n.context),null}if(t.depth==1){if(e.peek()=="<")return o.skipAttribute(t.state),n.context=new s(i.startState(o,j(t.state)),o,0,n.context),null;if(e.match("//"))return e.skipToEnd(),"comment";if(e.match("/*"))return t.depth=2,g(e,n)}var h=o.token(e,t.state),d=e.current(),k;return/\btag\b/.test(h)?/>$/.test(d)?t.state.context?t.depth=0:n.context=n.context.prev:/^</.test(d)&&(t.depth=1):!h&&(k=d.indexOf("{"))>-1&&e.backUp(d.length-k),h}function x(e,n,t){if(e.peek()=="<"&&a.expressionAllowed(e,t.state))return n.context=new s(i.startState(o,a.indent(t.state,"","")),o,0,n.context),a.skipExpression(t.state),null;var f=a.token(e,t.state);if(!f&&t.depth!=null){var p=e.current();p=="{"?t.depth++:p=="}"&&--t.depth==0&&(n.context=n.context.prev)}return f}return{startState:function(){return{context:new s(i.startState(a),a)}},copyState:function(e){return{context:u(e.context)}},token:g,indent:function(e,n,t){return e.context.mode.indent(e.context.state,n,t)},innerMode:function(e){return e.context}}},"xml","javascript"),i.defineMIME("text/jsx","jsx"),i.defineMIME("text/typescript-jsx",{name:"jsx",base:{name:"javascript",typescript:!0}})})})();var m=T.exports;const N=y(m),_=O({__proto__:null,default:N},[m]);export{_ as j};
