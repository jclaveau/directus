import{g as b,b as k}from"./index.85962662.entry.js";function d(f,u){for(var r=0;r<u.length;r++){const i=u[r];if(typeof i!="string"&&!Array.isArray(i)){for(const t in i)if(t!=="default"&&!(t in f)){const c=Object.getOwnPropertyDescriptor(i,t);c&&Object.defineProperty(f,t,c.get?c:{enumerable:!0,get:()=>i[t]})}}}return Object.freeze(Object.defineProperty(f,Symbol.toStringTag,{value:"Module"}))}var g={exports:{}};(function(f,u){(function(r){r(k())})(function(r){r.defineMode("ebnf",function(i){var t={slash:0,parenthesis:1},c={comment:0,_string:1,characterClass:2},l=null;return i.bracesMode&&(l=r.getMode(i,i.bracesMode)),{startState:function(){return{stringType:null,commentType:null,braced:0,lhs:!0,localState:null,stack:[],inDefinition:!1}},token:function(e,n){if(e){switch(n.stack.length===0&&(e.peek()=='"'||e.peek()=="'"?(n.stringType=e.peek(),e.next(),n.stack.unshift(c._string)):e.match("/*")?(n.stack.unshift(c.comment),n.commentType=t.slash):e.match("(*")&&(n.stack.unshift(c.comment),n.commentType=t.parenthesis)),n.stack[0]){case c._string:for(;n.stack[0]===c._string&&!e.eol();)e.peek()===n.stringType?(e.next(),n.stack.shift()):e.peek()==="\\"?(e.next(),e.next()):e.match(/^.[^\\\"\']*/);return n.lhs?"property string":"string";case c.comment:for(;n.stack[0]===c.comment&&!e.eol();)n.commentType===t.slash&&e.match("*/")||n.commentType===t.parenthesis&&e.match("*)")?(n.stack.shift(),n.commentType=null):e.match(/^.[^\*]*/);return"comment";case c.characterClass:for(;n.stack[0]===c.characterClass&&!e.eol();)e.match(/^[^\]\\]+/)||e.match(".")||n.stack.shift();return"operator"}var h=e.peek();if(l!==null&&(n.braced||h==="{")){n.localState===null&&(n.localState=r.startState(l));var a=l.token(e,n.localState),p=e.current();if(!a)for(var o=0;o<p.length;o++)p[o]==="{"?(n.braced===0&&(a="matchingbracket"),n.braced++):p[o]==="}"&&(n.braced--,n.braced===0&&(a="matchingbracket"));return a}switch(h){case"[":return e.next(),n.stack.unshift(c.characterClass),"bracket";case":":case"|":case";":return e.next(),"operator";case"%":if(e.match("%%"))return"header";if(e.match(/[%][A-Za-z]+/))return"keyword";if(e.match(/[%][}]/))return"matchingbracket";break;case"/":if(e.match(/[\/][A-Za-z]+/))return"keyword";case"\\":if(e.match(/[\][a-z]+/))return"string-2";case".":if(e.match("."))return"atom";case"*":case"-":case"+":case"^":if(e.match(h))return"atom";case"$":if(e.match("$$"))return"builtin";if(e.match(/[$][0-9]+/))return"variable-3";case"<":if(e.match(/<<[a-zA-Z_]+>>/))return"builtin"}return e.match("//")?(e.skipToEnd(),"comment"):e.match("return")?"operator":e.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)?e.match(/(?=[\(.])/)?"variable":e.match(/(?=[\s\n]*[:=])/)?"def":"variable-2":["[","]","(",")"].indexOf(e.peek())!=-1?(e.next(),"bracket"):(e.eatSpace()||e.next(),null)}}}}),r.defineMIME("text/x-ebnf","ebnf")})})();var s=g.exports;const y=b(s),x=d({__proto__:null,default:y},[s]);export{x as e};
