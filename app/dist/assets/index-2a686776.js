import{g as j}from"./index.c1b672a5.entry.js";import{i as y,b as D,a as S,c as E,d as R}from"./index-ead2b777.js";function L(d,e){for(var n=0;n<e.length;n++){const r=e[n];if(typeof r!="string"&&!Array.isArray(r)){for(const t in r)if(t!=="default"&&!(t in d)){const i=Object.getOwnPropertyDescriptor(r,t);i&&Object.defineProperty(d,t,i.get?i:{enumerable:!0,get:()=>r[t]})}}}return Object.freeze(Object.defineProperty(d,Symbol.toStringTag,{value:"Module"}))}var P={exports:{}},w={exports:{}};(function(d,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var n={xseconds_other:"sekundė_sekundžių_sekundes",xminutes_one:"minutė_minutės_minutę",xminutes_other:"minutės_minučių_minutes",xhours_one:"valanda_valandos_valandą",xhours_other:"valandos_valandų_valandas",xdays_one:"diena_dienos_dieną",xdays_other:"dienos_dienų_dienas",xweeks_one:"savaitė_savaitės_savaitę",xweeks_other:"savaitės_savaičių_savaites",xmonths_one:"mėnuo_mėnesio_mėnesį",xmonths_other:"mėnesiai_mėnesių_mėnesius",xyears_one:"metai_metų_metus",xyears_other:"metai_metų_metus",about:"apie",over:"daugiau nei",almost:"beveik",lessthan:"mažiau nei"},r=function(o,l,a,u){return l?u?"kelių sekundžių":"kelias sekundes":"kelios sekundės"},t=function(o,l,a,u){return l?u?s(a)[1]:s(a)[2]:s(a)[0]},i=function(o,l,a,u){var f=o+" ";return o===1?f+t(o,l,a,u):l?u?f+s(a)[1]:f+(p(o)?s(a)[1]:s(a)[2]):f+(p(o)?s(a)[1]:s(a)[0])};function p(v){return v%10===0||v>10&&v<20}function s(v){return n[v].split("_")}var h={lessThanXSeconds:{one:r,other:i},xSeconds:{one:r,other:i},halfAMinute:"pusė minutės",lessThanXMinutes:{one:t,other:i},xMinutes:{one:t,other:i},aboutXHours:{one:t,other:i},xHours:{one:t,other:i},xDays:{one:t,other:i},aboutXWeeks:{one:t,other:i},xWeeks:{one:t,other:i},aboutXMonths:{one:t,other:i},xMonths:{one:t,other:i},aboutXYears:{one:t,other:i},xYears:{one:t,other:i},overXYears:{one:t,other:i},almostXYears:{one:t,other:i}},k=function(o,l,a){var u=o.match(/about|over|almost|lessthan/i),f=u?o.replace(u[0],""):o,g=(a==null?void 0:a.comparison)!==void 0&&a.comparison>0,m,c=h[o];if(typeof c=="string"?m=c:l===1?m=c.one(l,(a==null?void 0:a.addSuffix)===!0,f.toLowerCase()+"_one",g):m=c.other(l,(a==null?void 0:a.addSuffix)===!0,f.toLowerCase()+"_other",g),u){var b=u[0].toLowerCase();m=n[b]+" "+m}return a!=null&&a.addSuffix?a.comparison&&a.comparison>0?"po "+m:"prieš "+m:m},_=k;e.default=_,d.exports=e.default})(w,w.exports);var K=w.exports,x={exports:{}};(function(d,e){var n=y.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r=n(D),t={full:"y 'm'. MMMM d 'd'., EEEE",long:"y 'm'. MMMM d 'd'.",medium:"y-MM-dd",short:"y-MM-dd"},i={full:"HH:mm:ss zzzz",long:"HH:mm:ss z",medium:"HH:mm:ss",short:"HH:mm"},p={full:"{{date}} {{time}}",long:"{{date}} {{time}}",medium:"{{date}} {{time}}",short:"{{date}} {{time}}"},s={date:(0,r.default)({formats:t,defaultWidth:"full"}),time:(0,r.default)({formats:i,defaultWidth:"full"}),dateTime:(0,r.default)({formats:p,defaultWidth:"full"})},h=s;e.default=h,d.exports=e.default})(x,x.exports);var O=x.exports,I={exports:{}};(function(d,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var n={lastWeek:"'Praėjusį' eeee p",yesterday:"'Vakar' p",today:"'Šiandien' p",tomorrow:"'Rytoj' p",nextWeek:"eeee p",other:"P"},r=function(p,s,h,k){return n[p]},t=r;e.default=t,d.exports=e.default})(I,I.exports);var F=I.exports,M={exports:{}};(function(d,e){var n=y.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r=n(S),t={narrow:["pr. Kr.","po Kr."],abbreviated:["pr. Kr.","po Kr."],wide:["prieš Kristų","po Kristaus"]},i={narrow:["1","2","3","4"],abbreviated:["I ketv.","II ketv.","III ketv.","IV ketv."],wide:["I ketvirtis","II ketvirtis","III ketvirtis","IV ketvirtis"]},p={narrow:["1","2","3","4"],abbreviated:["I k.","II k.","III k.","IV k."],wide:["I ketvirtis","II ketvirtis","III ketvirtis","IV ketvirtis"]},s={narrow:["S","V","K","B","G","B","L","R","R","S","L","G"],abbreviated:["saus.","vas.","kov.","bal.","geg.","birž.","liep.","rugp.","rugs.","spal.","lapkr.","gruod."],wide:["sausis","vasaris","kovas","balandis","gegužė","birželis","liepa","rugpjūtis","rugsėjis","spalis","lapkritis","gruodis"]},h={narrow:["S","V","K","B","G","B","L","R","R","S","L","G"],abbreviated:["saus.","vas.","kov.","bal.","geg.","birž.","liep.","rugp.","rugs.","spal.","lapkr.","gruod."],wide:["sausio","vasario","kovo","balandžio","gegužės","birželio","liepos","rugpjūčio","rugsėjo","spalio","lapkričio","gruodžio"]},k={narrow:["S","P","A","T","K","P","Š"],short:["Sk","Pr","An","Tr","Kt","Pn","Št"],abbreviated:["sk","pr","an","tr","kt","pn","št"],wide:["sekmadienis","pirmadienis","antradienis","trečiadienis","ketvirtadienis","penktadienis","šeštadienis"]},_={narrow:["S","P","A","T","K","P","Š"],short:["Sk","Pr","An","Tr","Kt","Pn","Št"],abbreviated:["sk","pr","an","tr","kt","pn","št"],wide:["sekmadienį","pirmadienį","antradienį","trečiadienį","ketvirtadienį","penktadienį","šeštadienį"]},v={narrow:{am:"pr. p.",pm:"pop.",midnight:"vidurnaktis",noon:"vidurdienis",morning:"rytas",afternoon:"diena",evening:"vakaras",night:"naktis"},abbreviated:{am:"priešpiet",pm:"popiet",midnight:"vidurnaktis",noon:"vidurdienis",morning:"rytas",afternoon:"diena",evening:"vakaras",night:"naktis"},wide:{am:"priešpiet",pm:"popiet",midnight:"vidurnaktis",noon:"vidurdienis",morning:"rytas",afternoon:"diena",evening:"vakaras",night:"naktis"}},o={narrow:{am:"pr. p.",pm:"pop.",midnight:"vidurnaktis",noon:"perpiet",morning:"rytas",afternoon:"popietė",evening:"vakaras",night:"naktis"},abbreviated:{am:"priešpiet",pm:"popiet",midnight:"vidurnaktis",noon:"perpiet",morning:"rytas",afternoon:"popietė",evening:"vakaras",night:"naktis"},wide:{am:"priešpiet",pm:"popiet",midnight:"vidurnaktis",noon:"perpiet",morning:"rytas",afternoon:"popietė",evening:"vakaras",night:"naktis"}},l=function(g,m){var c=Number(g);return c+"-oji"},a={ordinalNumber:l,era:(0,r.default)({values:t,defaultWidth:"wide"}),quarter:(0,r.default)({values:i,defaultWidth:"wide",formattingValues:p,defaultFormattingWidth:"wide",argumentCallback:function(g){return g-1}}),month:(0,r.default)({values:s,defaultWidth:"wide",formattingValues:h,defaultFormattingWidth:"wide"}),day:(0,r.default)({values:k,defaultWidth:"wide",formattingValues:_,defaultFormattingWidth:"wide"}),dayPeriod:(0,r.default)({values:v,defaultWidth:"wide",formattingValues:o,defaultFormattingWidth:"wide"})},u=a;e.default=u,d.exports=e.default})(M,M.exports);var z=M.exports,W={exports:{}};(function(d,e){var n=y.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r=n(E),t=n(R),i=/^(\d+)(-oji)?/i,p=/\d+/i,s={narrow:/^p(r|o)\.?\s?(kr\.?|me)/i,abbreviated:/^(pr\.\s?(kr\.|m\.\s?e\.)|po\s?kr\.|mūsų eroje)/i,wide:/^(prieš Kristų|prieš mūsų erą|po Kristaus|mūsų eroje)/i},h={wide:[/prieš/i,/(po|mūsų)/i],any:[/^pr/i,/^(po|m)/i]},k={narrow:/^([1234])/i,abbreviated:/^(I|II|III|IV)\s?ketv?\.?/i,wide:/^(I|II|III|IV)\s?ketvirtis/i},_={narrow:[/1/i,/2/i,/3/i,/4/i],any:[/I$/i,/II$/i,/III/i,/IV/i]},v={narrow:/^[svkbglr]/i,abbreviated:/^(saus\.|vas\.|kov\.|bal\.|geg\.|birž\.|liep\.|rugp\.|rugs\.|spal\.|lapkr\.|gruod\.)/i,wide:/^(sausi(s|o)|vasari(s|o)|kov(a|o)s|balandž?i(s|o)|gegužės?|birželi(s|o)|liep(a|os)|rugpjū(t|č)i(s|o)|rugsėj(is|o)|spali(s|o)|lapkri(t|č)i(s|o)|gruodž?i(s|o))/i},o={narrow:[/^s/i,/^v/i,/^k/i,/^b/i,/^g/i,/^b/i,/^l/i,/^r/i,/^r/i,/^s/i,/^l/i,/^g/i],any:[/^saus/i,/^vas/i,/^kov/i,/^bal/i,/^geg/i,/^birž/i,/^liep/i,/^rugp/i,/^rugs/i,/^spal/i,/^lapkr/i,/^gruod/i]},l={narrow:/^[spatkš]/i,short:/^(sk|pr|an|tr|kt|pn|št)/i,abbreviated:/^(sk|pr|an|tr|kt|pn|št)/i,wide:/^(sekmadien(is|į)|pirmadien(is|į)|antradien(is|į)|trečiadien(is|į)|ketvirtadien(is|į)|penktadien(is|į)|šeštadien(is|į))/i},a={narrow:[/^s/i,/^p/i,/^a/i,/^t/i,/^k/i,/^p/i,/^š/i],wide:[/^se/i,/^pi/i,/^an/i,/^tr/i,/^ke/i,/^pe/i,/^še/i],any:[/^sk/i,/^pr/i,/^an/i,/^tr/i,/^kt/i,/^pn/i,/^št/i]},u={narrow:/^(pr.\s?p.|pop.|vidurnaktis|(vidurdienis|perpiet)|rytas|(diena|popietė)|vakaras|naktis)/i,any:/^(priešpiet|popiet$|vidurnaktis|(vidurdienis|perpiet)|rytas|(diena|popietė)|vakaras|naktis)/i},f={narrow:{am:/^pr/i,pm:/^pop./i,midnight:/^vidurnaktis/i,noon:/^(vidurdienis|perp)/i,morning:/rytas/i,afternoon:/(die|popietė)/i,evening:/vakaras/i,night:/naktis/i},any:{am:/^pr/i,pm:/^popiet$/i,midnight:/^vidurnaktis/i,noon:/^(vidurdienis|perp)/i,morning:/rytas/i,afternoon:/(die|popietė)/i,evening:/vakaras/i,night:/naktis/i}},g={ordinalNumber:(0,t.default)({matchPattern:i,parsePattern:p,valueCallback:function(b){return parseInt(b,10)}}),era:(0,r.default)({matchPatterns:s,defaultMatchWidth:"wide",parsePatterns:h,defaultParseWidth:"any"}),quarter:(0,r.default)({matchPatterns:k,defaultMatchWidth:"wide",parsePatterns:_,defaultParseWidth:"any",valueCallback:function(b){return b+1}}),month:(0,r.default)({matchPatterns:v,defaultMatchWidth:"wide",parsePatterns:o,defaultParseWidth:"any"}),day:(0,r.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:a,defaultParseWidth:"any"}),dayPeriod:(0,r.default)({matchPatterns:u,defaultMatchWidth:"any",parsePatterns:f,defaultParseWidth:"any"})},m=g;e.default=m,d.exports=e.default})(W,W.exports);var C=W.exports;(function(d,e){var n=y.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r=n(K),t=n(O),i=n(F),p=n(z),s=n(C),h={code:"lt",formatDistance:r.default,formatLong:t.default,formatRelative:i.default,localize:p.default,match:s.default,options:{weekStartsOn:1,firstWeekContainsDate:4}},k=h;e.default=k,d.exports=e.default})(P,P.exports);var V=P.exports;const H=j(V),N=L({__proto__:null,default:H},[V]);export{N as i};
