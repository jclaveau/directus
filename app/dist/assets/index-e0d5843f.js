import{g as F}from"./index.85962662.entry.js";import{i as f,b as E,a as K,c as O,d as z}from"./index-ead2b777.js";function R(n,e){for(var t=0;t<e.length;t++){const a=e[t];if(typeof a!="string"&&!Array.isArray(a)){for(const r in a)if(r!=="default"&&!(r in n)){const u=Object.getOwnPropertyDescriptor(a,r);u&&Object.defineProperty(n,r,u.get?u:{enumerable:!0,get:()=>a[r]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var b={exports:{}},k={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lessThanXSeconds:{one:"minna en 1 sekúnda",other:"minna en {{count}} sekúndur"},xSeconds:{one:"1 sekúnda",other:"{{count}} sekúndur"},halfAMinute:"hálf mínúta",lessThanXMinutes:{one:"minna en 1 mínúta",other:"minna en {{count}} mínútur"},xMinutes:{one:"1 mínúta",other:"{{count}} mínútur"},aboutXHours:{one:"u.þ.b. 1 klukkustund",other:"u.þ.b. {{count}} klukkustundir"},xHours:{one:"1 klukkustund",other:"{{count}} klukkustundir"},xDays:{one:"1 dagur",other:"{{count}} dagar"},aboutXWeeks:{one:"um viku",other:"um {{count}} vikur"},xWeeks:{one:"1 viku",other:"{{count}} vikur"},aboutXMonths:{one:"u.þ.b. 1 mánuður",other:"u.þ.b. {{count}} mánuðir"},xMonths:{one:"1 mánuður",other:"{{count}} mánuðir"},aboutXYears:{one:"u.þ.b. 1 ár",other:"u.þ.b. {{count}} ár"},xYears:{one:"1 ár",other:"{{count}} ár"},overXYears:{one:"meira en 1 ár",other:"meira en {{count}} ár"},almostXYears:{one:"næstum 1 ár",other:"næstum {{count}} ár"}},a=function(d,l,i){var o,s=t[d];return typeof s=="string"?o=s:l===1?o=s.one:o=s.other.replace("{{count}}",l.toString()),i!=null&&i.addSuffix?i.comparison&&i.comparison>0?"í "+o:o+" síðan":o},r=a;e.default=r,n.exports=e.default})(k,k.exports);var H=k.exports,y={exports:{}};(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(E),r={full:"EEEE, do MMMM y",long:"do MMMM y",medium:"do MMM y",short:"d.MM.y"},u={full:"'kl'. HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},d={full:"{{date}} 'kl.' {{time}}",long:"{{date}} 'kl.' {{time}}",medium:"{{date}} {{time}}",short:"{{date}} {{time}}"},l={date:(0,a.default)({formats:r,defaultWidth:"full"}),time:(0,a.default)({formats:u,defaultWidth:"full"}),dateTime:(0,a.default)({formats:d,defaultWidth:"full"})},i=l;e.default=i,n.exports=e.default})(y,y.exports);var L=y.exports,P={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lastWeek:"'síðasta' dddd 'kl.' p",yesterday:"'í gær kl.' p",today:"'í dag kl.' p",tomorrow:"'á morgun kl.' p",nextWeek:"dddd 'kl.' p",other:"P"},a=function(d,l,i,o){return t[d]},r=a;e.default=r,n.exports=e.default})(P,P.exports);var S=P.exports,M={exports:{}};(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(K),r={narrow:["f.Kr.","e.Kr."],abbreviated:["f.Kr.","e.Kr."],wide:["fyrir Krist","eftir Krist"]},u={narrow:["1","2","3","4"],abbreviated:["1F","2F","3F","4F"],wide:["1. fjórðungur","2. fjórðungur","3. fjórðungur","4. fjórðungur"]},d={narrow:["J","F","M","A","M","J","J","Á","S","Ó","N","D"],abbreviated:["jan.","feb.","mars","apríl","maí","júní","júlí","ágúst","sept.","okt.","nóv.","des."],wide:["janúar","febrúar","mars","apríl","maí","júní","júlí","ágúst","september","október","nóvember","desember"]},l={narrow:["S","M","Þ","M","F","F","L"],short:["Su","Má","Þr","Mi","Fi","Fö","La"],abbreviated:["sun.","mán.","þri.","mið.","fim.","fös.","lau."],wide:["sunnudagur","mánudagur","þriðjudagur","miðvikudagur","fimmtudagur","föstudagur","laugardagur"]},i={narrow:{am:"f",pm:"e",midnight:"miðnætti",noon:"hádegi",morning:"morgunn",afternoon:"síðdegi",evening:"kvöld",night:"nótt"},abbreviated:{am:"f.h.",pm:"e.h.",midnight:"miðnætti",noon:"hádegi",morning:"morgunn",afternoon:"síðdegi",evening:"kvöld",night:"nótt"},wide:{am:"fyrir hádegi",pm:"eftir hádegi",midnight:"miðnætti",noon:"hádegi",morning:"morgunn",afternoon:"síðdegi",evening:"kvöld",night:"nótt"}},o={narrow:{am:"f",pm:"e",midnight:"á miðnætti",noon:"á hádegi",morning:"að morgni",afternoon:"síðdegis",evening:"um kvöld",night:"um nótt"},abbreviated:{am:"f.h.",pm:"e.h.",midnight:"á miðnætti",noon:"á hádegi",morning:"að morgni",afternoon:"síðdegis",evening:"um kvöld",night:"um nótt"},wide:{am:"fyrir hádegi",pm:"eftir hádegi",midnight:"á miðnætti",noon:"á hádegi",morning:"að morgni",afternoon:"síðdegis",evening:"um kvöld",night:"um nótt"}},s=function(m,x){var c=Number(m);return c+"."},v={ordinalNumber:s,era:(0,a.default)({values:r,defaultWidth:"wide"}),quarter:(0,a.default)({values:u,defaultWidth:"wide",argumentCallback:function(m){return m-1}}),month:(0,a.default)({values:d,defaultWidth:"wide"}),day:(0,a.default)({values:l,defaultWidth:"wide"}),dayPeriod:(0,a.default)({values:i,defaultWidth:"wide",formattingValues:o,defaultFormattingWidth:"wide"})},g=v;e.default=g,n.exports=e.default})(M,M.exports);var q=M.exports,_={exports:{}};(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(O),r=t(z),u=/^(\d+)(\.)?/i,d=/\d+(\.)?/i,l={narrow:/^(f\.Kr\.|e\.Kr\.)/i,abbreviated:/^(f\.Kr\.|e\.Kr\.)/i,wide:/^(fyrir Krist|eftir Krist)/i},i={any:[/^(f\.Kr\.)/i,/^(e\.Kr\.)/i]},o={narrow:/^[1234]\.?/i,abbreviated:/^q[1234]\.?/i,wide:/^[1234]\.? fjórðungur/i},s={any:[/1\.?/i,/2\.?/i,/3\.?/i,/4\.?/i]},v={narrow:/^[jfmásónd]/i,abbreviated:/^(jan\.|feb\.|mars\.|apríl\.|maí|júní|júlí|águst|sep\.|oct\.|nov\.|dec\.)/i,wide:/^(januar|febrúar|mars|apríl|maí|júní|júlí|águst|september|október|nóvember|desember)/i},g={narrow:[/^j/i,/^f/i,/^m/i,/^a/i,/^m/i,/^j/i,/^j/i,/^á/i,/^s/i,/^ó/i,/^n/i,/^d/i],any:[/^ja/i,/^f/i,/^mar/i,/^ap/i,/^maí/i,/^jún/i,/^júl/i,/^áu/i,/^s/i,/^ó/i,/^n/i,/^d/i]},h={narrow:/^[smtwf]/i,short:/^(su|má|þr|mi|fi|fö|la)/i,abbreviated:/^(sun|mán|þri|mið|fim|fös|lau)\.?/i,wide:/^(sunnudagur|mánudagur|þriðjudagur|miðvikudagur|fimmtudagur|föstudagur|laugardagur)/i},m={narrow:[/^s/i,/^m/i,/^þ/i,/^m/i,/^f/i,/^f/i,/^l/i],any:[/^su/i,/^má/i,/^þr/i,/^mi/i,/^fi/i,/^fö/i,/^la/i]},x={narrow:/^(f|e|síðdegis|(á|að|um) (morgni|kvöld|nótt|miðnætti))/i,any:/^(fyrir hádegi|eftir hádegi|[ef]\.?h\.?|síðdegis|morgunn|(á|að|um) (morgni|kvöld|nótt|miðnætti))/i},c={any:{am:/^f/i,pm:/^e/i,midnight:/^mi/i,noon:/^há/i,morning:/morgunn/i,afternoon:/síðdegi/i,evening:/kvöld/i,night:/nótt/i}},w={ordinalNumber:(0,r.default)({matchPattern:u,parsePattern:d,valueCallback:function(p){return parseInt(p,10)}}),era:(0,a.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:i,defaultParseWidth:"any"}),quarter:(0,a.default)({matchPatterns:o,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(p){return p+1}}),month:(0,a.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:g,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:m,defaultParseWidth:"any"}),dayPeriod:(0,a.default)({matchPatterns:x,defaultMatchWidth:"any",parsePatterns:c,defaultParseWidth:"any"})},W=w;e.default=W,n.exports=e.default})(_,_.exports);var N=_.exports;(function(n,e){var t=f.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(H),r=t(L),u=t(S),d=t(q),l=t(N),i={code:"is",formatDistance:a.default,formatLong:r.default,formatRelative:u.default,localize:d.default,match:l.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},o=i;e.default=o,n.exports=e.default})(b,b.exports);var j=b.exports;const C=F(j),T=R({__proto__:null,default:C},[j]);export{T as i};
