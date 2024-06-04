import{g as D}from"./index.c1b672a5.entry.js";function C(S,L){for(var d=0;d<L.length;d++){const w=L[d];if(typeof w!="string"&&!Array.isArray(w)){for(const y in w)if(y!=="default"&&!(y in S)){const O=Object.getOwnPropertyDescriptor(w,y);O&&Object.defineProperty(S,y,O.get?O:{enumerable:!0,get:()=>w[y]})}}}return Object.freeze(Object.defineProperty(S,Symbol.toStringTag,{value:"Module"}))}var U={exports:{}};(function(S){var L=function(){var d=!0,w=!1,y={},O=function(){var m,t,f={'"':'"',"\\":"\\","/":"/",b:"\b",f:"\f",n:`
`,r:"\r",t:"	"},r,n=function(a){throw{name:"SyntaxError",message:a,at:m,text:r}},e=function(a){return a&&a!==t&&n("Expected '"+a+"' instead of '"+t+"'"),t=r.charAt(m),m+=1,t},o=function(){var a,h="";for(t==="-"&&(h="-",e("-"));t>="0"&&t<="9";)h+=t,e();if(t===".")for(h+=".";e()&&t>="0"&&t<="9";)h+=t;if(t==="e"||t==="E")for(h+=t,e(),(t==="-"||t==="+")&&(h+=t,e());t>="0"&&t<="9";)h+=t,e();if(a=+h,!isFinite(a))n("Bad number");else return a},s=function(){var a,h,g="",_;if(t==='"')for(;e();){if(t==='"')return e(),g;if(t==="\\")if(e(),t==="u"){for(_=0,h=0;h<4&&(a=parseInt(e(),16),!!isFinite(a));h+=1)_=_*16+a;g+=String.fromCharCode(_)}else if(typeof f[t]=="string")g+=f[t];else break;else g+=t}n("Bad string")},i=function(){for(;t&&t<=" ";)e()},x=function(){switch(t){case"t":return e("t"),e("r"),e("u"),e("e"),!0;case"f":return e("f"),e("a"),e("l"),e("s"),e("e"),!1;case"n":return e("n"),e("u"),e("l"),e("l"),null}n("Unexpected '"+t+"'")},l,j=function(){var a=[];if(t==="["){if(e("["),i(),t==="]")return e("]"),a;for(;t;){if(a.push(l()),i(),t==="]")return e("]"),a;e(","),i()}}n("Bad array")},E=function(){var a,h={};if(t==="{"){if(e("{"),i(),t==="}")return e("}"),h;for(;t;){if(a=s(),i(),e(":"),Object.hasOwnProperty.call(h,a)&&n("Duplicate key '"+a+"'"),h[a]=l(),i(),t==="}")return e("}"),h;e(","),i()}}n("Bad object")};return l=function(){switch(i(),t){case"{":return E();case"[":return j();case'"':return s();case"-":return o();default:return t>="0"&&t<="9"?o():x()}},function(a,h){var g;return r=a,m=0,t=" ",g=l(),i(),t&&n("Syntax error"),typeof h=="function"?function _(A,u){var v,p,c=A[u];if(c&&typeof c=="object")for(v in c)Object.prototype.hasOwnProperty.call(c,v)&&(p=_(c,v),p!==void 0?c[v]=p:delete c[v]);return h.call(A,u,c)}({"":g},""):g}}(),N=function(){var m={trace:function(){},yy:{},symbols_:{error:2,JSONString:3,STRING:4,JSONNumber:5,NUMBER:6,JSONNullLiteral:7,NULL:8,JSONBooleanLiteral:9,TRUE:10,FALSE:11,JSONText:12,JSONValue:13,EOF:14,JSONObject:15,JSONArray:16,"{":17,"}":18,JSONMemberList:19,JSONMember:20,":":21,",":22,"[":23,"]":24,JSONElementList:25,$accept:0,$end:1},terminals_:{2:"error",4:"STRING",6:"NUMBER",8:"NULL",10:"TRUE",11:"FALSE",14:"EOF",17:"{",18:"}",21:":",22:",",23:"[",24:"]"},productions_:[0,[3,1],[5,1],[7,1],[9,1],[9,1],[12,2],[13,1],[13,1],[13,1],[13,1],[13,1],[13,1],[15,2],[15,3],[20,3],[19,1],[19,3],[16,2],[16,3],[25,1],[25,3]],performAction:function(r,n,e,o,s,i,x){var l=i.length-1;switch(s){case 1:this.$=r.replace(/\\(\\|")/g,"$1").replace(/\\n/g,`
`).replace(/\\r/g,"\r").replace(/\\t/g,"	").replace(/\\v/g,"\v").replace(/\\f/g,"\f").replace(/\\b/g,"\b");break;case 2:this.$=Number(r);break;case 3:this.$=null;break;case 4:this.$=!0;break;case 5:this.$=!1;break;case 6:return this.$=i[l-1];case 13:this.$={};break;case 14:this.$=i[l-1];break;case 15:this.$=[i[l-2],i[l]];break;case 16:this.$={},this.$[i[l][0]]=i[l][1];break;case 17:this.$=i[l-2],i[l-2][i[l][0]]=i[l][1];break;case 18:this.$=[];break;case 19:this.$=i[l-1];break;case 20:this.$=[i[l]];break;case 21:this.$=i[l-2],i[l-2].push(i[l]);break}},table:[{3:5,4:[1,12],5:6,6:[1,13],7:3,8:[1,9],9:4,10:[1,10],11:[1,11],12:1,13:2,15:7,16:8,17:[1,14],23:[1,15]},{1:[3]},{14:[1,16]},{14:[2,7],18:[2,7],22:[2,7],24:[2,7]},{14:[2,8],18:[2,8],22:[2,8],24:[2,8]},{14:[2,9],18:[2,9],22:[2,9],24:[2,9]},{14:[2,10],18:[2,10],22:[2,10],24:[2,10]},{14:[2,11],18:[2,11],22:[2,11],24:[2,11]},{14:[2,12],18:[2,12],22:[2,12],24:[2,12]},{14:[2,3],18:[2,3],22:[2,3],24:[2,3]},{14:[2,4],18:[2,4],22:[2,4],24:[2,4]},{14:[2,5],18:[2,5],22:[2,5],24:[2,5]},{14:[2,1],18:[2,1],21:[2,1],22:[2,1],24:[2,1]},{14:[2,2],18:[2,2],22:[2,2],24:[2,2]},{3:20,4:[1,12],18:[1,17],19:18,20:19},{3:5,4:[1,12],5:6,6:[1,13],7:3,8:[1,9],9:4,10:[1,10],11:[1,11],13:23,15:7,16:8,17:[1,14],23:[1,15],24:[1,21],25:22},{1:[2,6]},{14:[2,13],18:[2,13],22:[2,13],24:[2,13]},{18:[1,24],22:[1,25]},{18:[2,16],22:[2,16]},{21:[1,26]},{14:[2,18],18:[2,18],22:[2,18],24:[2,18]},{22:[1,28],24:[1,27]},{22:[2,20],24:[2,20]},{14:[2,14],18:[2,14],22:[2,14],24:[2,14]},{3:20,4:[1,12],20:29},{3:5,4:[1,12],5:6,6:[1,13],7:3,8:[1,9],9:4,10:[1,10],11:[1,11],13:30,15:7,16:8,17:[1,14],23:[1,15]},{14:[2,19],18:[2,19],22:[2,19],24:[2,19]},{3:5,4:[1,12],5:6,6:[1,13],7:3,8:[1,9],9:4,10:[1,10],11:[1,11],13:31,15:7,16:8,17:[1,14],23:[1,15]},{18:[2,17],22:[2,17]},{18:[2,15],22:[2,15]},{22:[2,21],24:[2,21]}],defaultActions:{16:[2,6]},parseError:function(r,n){throw new Error(r)},parse:function(r){var n=this,e=[0],o=[null],s=[],i=this.table,x="",l=0,j=0,E=0,a=2,h=1;this.lexer.setInput(r),this.lexer.yy=this.yy,this.yy.lexer=this.lexer,typeof this.lexer.yylloc>"u"&&(this.lexer.yylloc={});var g=this.lexer.yylloc;s.push(g),typeof this.yy.parseError=="function"&&(this.parseError=this.yy.parseError);function _(b){e.length=e.length-2*b,o.length=o.length-b,s.length=s.length-b}function A(){var b;return b=n.lexer.lex()||1,typeof b!="number"&&(b=n.symbols_[b]||b),b}for(var u,v,p,c,R,I={},F,k,T,J;;){if(p=e[e.length-1],this.defaultActions[p]?c=this.defaultActions[p]:(u==null&&(u=A()),c=i[p]&&i[p][u]),typeof c>"u"||!c.length||!c[0]){if(!E){J=[];for(F in i[p])this.terminals_[F]&&F>2&&J.push("'"+this.terminals_[F]+"'");var P="";this.lexer.showPosition?P="Parse error on line "+(l+1)+`:
`+this.lexer.showPosition()+`
Expecting `+J.join(", ")+", got '"+this.terminals_[u]+"'":P="Parse error on line "+(l+1)+": Unexpected "+(u==1?"end of input":"'"+(this.terminals_[u]||u)+"'"),this.parseError(P,{text:this.lexer.match,token:this.terminals_[u]||u,line:this.lexer.yylineno,loc:g,expected:J})}if(E==3){if(u==h)throw new Error(P||"Parsing halted.");j=this.lexer.yyleng,x=this.lexer.yytext,l=this.lexer.yylineno,g=this.lexer.yylloc,u=A()}for(;!(a.toString()in i[p]);){if(p==0)throw new Error(P||"Parsing halted.");_(1),p=e[e.length-1]}v=u,u=a,p=e[e.length-1],c=i[p]&&i[p][a],E=3}if(c[0]instanceof Array&&c.length>1)throw new Error("Parse Error: multiple actions possible at state: "+p+", token: "+u);switch(c[0]){case 1:e.push(u),o.push(this.lexer.yytext),s.push(this.lexer.yylloc),e.push(c[1]),u=null,v?(u=v,v=null):(j=this.lexer.yyleng,x=this.lexer.yytext,l=this.lexer.yylineno,g=this.lexer.yylloc,E>0&&E--);break;case 2:if(k=this.productions_[c[1]][1],I.$=o[o.length-k],I._$={first_line:s[s.length-(k||1)].first_line,last_line:s[s.length-1].last_line,first_column:s[s.length-(k||1)].first_column,last_column:s[s.length-1].last_column},R=this.performAction.call(I,x,j,l,this.yy,c[1],o,s),typeof R<"u")return R;k&&(e=e.slice(0,-1*k*2),o=o.slice(0,-1*k),s=s.slice(0,-1*k)),e.push(this.productions_[c[1]][0]),o.push(I.$),s.push(I._$),T=i[e[e.length-2]][e[e.length-1]],e.push(T);break;case 3:return!0}}return!0}},t=function(){var f={EOF:1,parseError:function(n,e){if(this.yy.parseError)this.yy.parseError(n,e);else throw new Error(n)},setInput:function(r){return this._input=r,this._more=this._less=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this},input:function(){var r=this._input[0];this.yytext+=r,this.yyleng++,this.match+=r,this.matched+=r;var n=r.match(/\n/);return n&&this.yylineno++,this._input=this._input.slice(1),r},unput:function(r){return this._input=r+this._input,this},more:function(){return this._more=!0,this},less:function(r){this._input=this.match.slice(r)+this._input},pastInput:function(){var r=this.matched.substr(0,this.matched.length-this.match.length);return(r.length>20?"...":"")+r.substr(-20).replace(/\n/g,"")},upcomingInput:function(){var r=this.match;return r.length<20&&(r+=this._input.substr(0,20-r.length)),(r.substr(0,20)+(r.length>20?"...":"")).replace(/\n/g,"")},showPosition:function(){var r=this.pastInput(),n=new Array(r.length+1).join("-");return r+this.upcomingInput()+`
`+n+"^"},next:function(){if(this.done)return this.EOF;this._input||(this.done=!0);var r,n,e,o,s;this._more||(this.yytext="",this.match="");for(var i=this._currentRules(),x=0;x<i.length&&(e=this._input.match(this.rules[i[x]]),!(e&&(!n||e[0].length>n[0].length)&&(n=e,o=x,!this.options.flex)));x++);if(n)return s=n[0].match(/\n.*/g),s&&(this.yylineno+=s.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:s?s[s.length-1].length-1:this.yylloc.last_column+n[0].length},this.yytext+=n[0],this.match+=n[0],this.yyleng=this.yytext.length,this._more=!1,this._input=this._input.slice(n[0].length),this.matched+=n[0],r=this.performAction.call(this,this.yy,this,i[o],this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),r||void 0;if(this._input==="")return this.EOF;this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},lex:function(){var n=this.next();return typeof n<"u"?n:this.lex()},begin:function(n){this.conditionStack.push(n)},popState:function(){return this.conditionStack.pop()},_currentRules:function(){return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules},topState:function(){return this.conditionStack[this.conditionStack.length-2]},pushState:function(n){this.begin(n)}};return f.options={},f.performAction=function(n,e,o,s){switch(o){case 0:break;case 1:return 6;case 2:return e.yytext=e.yytext.substr(1,e.yyleng-2),4;case 3:return 17;case 4:return 18;case 5:return 23;case 6:return 24;case 7:return 22;case 8:return 21;case 9:return 10;case 10:return 11;case 11:return 8;case 12:return 14;case 13:return"INVALID"}},f.rules=[/^(?:\s+)/,/^(?:(-?([0-9]|[1-9][0-9]+))(\.[0-9]+)?([eE][-+]?[0-9]+)?\b)/,/^(?:"(?:\\[\\"bfnrt/]|\\u[a-fA-F0-9]{4}|[^\\\0-\x09\x0a-\x1f"])*")/,/^(?:\{)/,/^(?:\})/,/^(?:\[)/,/^(?:\])/,/^(?:,)/,/^(?::)/,/^(?:true\b)/,/^(?:false\b)/,/^(?:null\b)/,/^(?:$)/,/^(?:.)/],f.conditions={INITIAL:{rules:[0,1,2,3,4,5,6,7,8,9,10,11,12,13],inclusive:!0}},f}();return m.lexer=t,m}(),M=N.parse;return N.parse=function(m){var t=M.call(N,m),f=typeof O>"u"?d("./doug-json-parse"):O;try{f(m)}catch(o){if(/Duplicate key|Bad string|Unexpected/.test(o.message)){var r=m.substring(0,o.at).split(`
`),n=r.length,e=r[n-1].length-1;throw this.parseError(o.message,{line:n,col:e,message:o.message.replace(/./,function(s){return s.toLowerCase()})}),SyntaxError(o.message+" on line "+n)}}return t},typeof y<"u"&&(y.parser=N,y.parse=function(){return N.parse.apply(N,arguments)},y.main=function(t){if(!t[1])throw new Error("Usage: "+t[0]+" FILE");if(typeof process<"u")var f=d("fs").readFileSync(d("path").join(process.cwd(),t[1]),"utf8");else var r=d("file").path(d("file").cwd()),f=r.join(t[1]).read({charset:"utf-8"});return y.parser.parse(f)},d.main===w&&y.main(typeof process<"u"?process.argv.slice(1):d("system").args)),y}();S.exports&&(S.exports=L)})(U);var B=U.exports;const z=D(B),V=C({__proto__:null,default:z},[B]);export{V as j};
