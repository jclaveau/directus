import{g as x,c as y}from"./index.64088c7b.entry.js";function v(c,s){for(var o=0;o<s.length;o++){const a=s[o];if(typeof a!="string"&&!Array.isArray(a)){for(const i in a)if(i!=="default"&&!(i in c)){const l=Object.getOwnPropertyDescriptor(a,i);l&&Object.defineProperty(c,i,l.get?l:{enumerable:!0,get:()=>a[i]})}}}return Object.freeze(Object.defineProperty(c,Symbol.toStringTag,{value:"Module"}))}var _={exports:{}};(function(c,s){(function(o){o(y)})(function(o){o.defineMode("tcl",function(){function a(r){for(var t={},n=r.split(" "),e=0;e<n.length;++e)t[n[e]]=!0;return t}var i=a("Tcl safe after append array auto_execok auto_import auto_load auto_mkindex auto_mkindex_old auto_qualify auto_reset bgerror binary break catch cd close concat continue dde eof encoding error eval exec exit expr fblocked fconfigure fcopy file fileevent filename filename flush for foreach format gets glob global history http if incr info interp join lappend lindex linsert list llength load lrange lreplace lsearch lset lsort memory msgcat namespace open package parray pid pkg::create pkg_mkIndex proc puts pwd re_syntax read regex regexp registry regsub rename resource return scan seek set socket source split string subst switch tcl_endOfWord tcl_findLibrary tcl_startOfNextWord tcl_wordBreakAfter tcl_startOfPreviousWord tcl_wordBreakBefore tcltest tclvars tell time trace unknown unset update uplevel upvar variable vwait"),l=a("if elseif else and not or eq ne in ni for foreach while switch"),d=/[+\-*&%=<>!?^\/\|]/;function p(r,t,n){return t.tokenize=n,n(r,t)}function u(r,t){var n=t.beforeParams;t.beforeParams=!1;var e=r.next();if((e=='"'||e=="'")&&t.inParams)return p(r,t,b(e));if(/[\[\]{}\(\),;\.]/.test(e))return e=="("&&n?t.inParams=!0:e==")"&&(t.inParams=!1),null;if(/\d/.test(e))return r.eatWhile(/[\w\.]/),"number";if(e=="#")return r.eat("*")?p(r,t,g):e=="#"&&r.match(/ *\[ *\[/)?p(r,t,h):(r.skipToEnd(),"comment");if(e=='"')return r.skipTo(/"/),"comment";if(e=="$")return r.eatWhile(/[$_a-z0-9A-Z\.{:]/),r.eatWhile(/}/),t.beforeParams=!0,"builtin";if(d.test(e))return r.eatWhile(d),"comment";r.eatWhile(/[\w\$_{}\xa1-\uffff]/);var f=r.current().toLowerCase();return i&&i.propertyIsEnumerable(f)?"keyword":l&&l.propertyIsEnumerable(f)?(t.beforeParams=!0,"keyword"):null}function b(r){return function(t,n){for(var e=!1,f,m=!1;(f=t.next())!=null;){if(f==r&&!e){m=!0;break}e=!e&&f=="\\"}return m&&(n.tokenize=u),"string"}}function g(r,t){for(var n=!1,e;e=r.next();){if(e=="#"&&n){t.tokenize=u;break}n=e=="*"}return"comment"}function h(r,t){for(var n=0,e;e=r.next();){if(e=="#"&&n==2){t.tokenize=u;break}e=="]"?n++:e!=" "&&(n=0)}return"meta"}return{startState:function(){return{tokenize:u,beforeParams:!1,inParams:!1}},token:function(r,t){return r.eatSpace()?null:t.tokenize(r,t)},lineComment:"#"}}),o.defineMIME("text/x-tcl","tcl")})})();var k=_.exports;const w=x(k),E=v({__proto__:null,default:w},[k]);export{E as t};
