import{g as D}from"./index.64088c7b.entry.js";import{i as c,b as E,a as $,c as X,d as O}from"./index-ead2b777.js";function j(n,e){for(var r=0;r<e.length;r++){const a=e[r];if(typeof a!="string"&&!Array.isArray(a)){for(const i in a)if(i!=="default"&&!(i in n)){const d=Object.getOwnPropertyDescriptor(a,i);d&&Object.defineProperty(n,i,d.get?d:{enumerable:!0,get:()=>a[i]})}}}return Object.freeze(Object.defineProperty(n,Symbol.toStringTag,{value:"Module"}))}var I={exports:{}},x={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r={lessThanXSeconds:{one:"секунд хүрэхгүй",other:"{{count}} секунд хүрэхгүй"},xSeconds:{one:"1 секунд",other:"{{count}} секунд"},halfAMinute:"хагас минут",lessThanXMinutes:{one:"минут хүрэхгүй",other:"{{count}} минут хүрэхгүй"},xMinutes:{one:"1 минут",other:"{{count}} минут"},aboutXHours:{one:"ойролцоогоор 1 цаг",other:"ойролцоогоор {{count}} цаг"},xHours:{one:"1 цаг",other:"{{count}} цаг"},xDays:{one:"1 өдөр",other:"{{count}} өдөр"},aboutXWeeks:{one:"ойролцоогоор 1 долоо хоног",other:"ойролцоогоор {{count}} долоо хоног"},xWeeks:{one:"1 долоо хоног",other:"{{count}} долоо хоног"},aboutXMonths:{one:"ойролцоогоор 1 сар",other:"ойролцоогоор {{count}} сар"},xMonths:{one:"1 сар",other:"{{count}} сар"},aboutXYears:{one:"ойролцоогоор 1 жил",other:"ойролцоогоор {{count}} жил"},xYears:{one:"1 жил",other:"{{count}} жил"},overXYears:{one:"1 жил гаран",other:"{{count}} жил гаран"},almostXYears:{one:"бараг 1 жил",other:"бараг {{count}} жил"}},a=function(u,l,o){var t,s=r[u];if(typeof s=="string"?t=s:l===1?t=s.one:t=s.other.replace("{{count}}",String(l)),o!=null&&o.addSuffix){var f=t.split(" "),v=f.pop();switch(t=f.join(" "),v){case"секунд":t+=" секундийн";break;case"минут":t+=" минутын";break;case"цаг":t+=" цагийн";break;case"өдөр":t+=" өдрийн";break;case"сар":t+=" сарын";break;case"жил":t+=" жилийн";break;case"хоног":t+=" хоногийн";break;case"гаран":t+=" гараны";break;case"хүрэхгүй":t+=" хүрэхгүй хугацааны";break;default:t+=v+"-н"}return o.comparison&&o.comparison>0?t+" дараа":t+" өмнө"}return t},i=a;e.default=i,n.exports=e.default})(x,x.exports);var z=x.exports,g={exports:{}};(function(n,e){var r=c.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=r(E),i={full:"y 'оны' MMMM'ын' d, EEEE 'гараг'",long:"y 'оны' MMMM'ын' d",medium:"y 'оны' MMM'ын' d",short:"y.MM.dd"},d={full:"H:mm:ss zzzz",long:"H:mm:ss z",medium:"H:mm:ss",short:"H:mm"},u={full:"{{date}} {{time}}",long:"{{date}} {{time}}",medium:"{{date}} {{time}}",short:"{{date}} {{time}}"},l={date:(0,a.default)({formats:i,defaultWidth:"full"}),time:(0,a.default)({formats:d,defaultWidth:"full"}),dateTime:(0,a.default)({formats:u,defaultWidth:"full"})},o=l;e.default=o,n.exports=e.default})(g,g.exports);var F=g.exports,y={exports:{}};(function(n,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var r={lastWeek:"'өнгөрсөн' eeee 'гарагийн' p 'цагт'",yesterday:"'өчигдөр' p 'цагт'",today:"'өнөөдөр' p 'цагт'",tomorrow:"'маргааш' p 'цагт'",nextWeek:"'ирэх' eeee 'гарагийн' p 'цагт'",other:"P"},a=function(u,l,o,t){return r[u]},i=a;e.default=i,n.exports=e.default})(y,y.exports);var R=y.exports,P={exports:{}};(function(n,e){var r=c.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=r($),i={narrow:["НТӨ","НТ"],abbreviated:["НТӨ","НТ"],wide:["нийтийн тооллын өмнөх","нийтийн тооллын"]},d={narrow:["I","II","III","IV"],abbreviated:["I улирал","II улирал","III улирал","IV улирал"],wide:["1-р улирал","2-р улирал","3-р улирал","4-р улирал"]},u={narrow:["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"],abbreviated:["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"],wide:["Нэгдүгээр сар","Хоёрдугаар сар","Гуравдугаар сар","Дөрөвдүгээр сар","Тавдугаар сар","Зургаадугаар сар","Долоодугаар сар","Наймдугаар сар","Есдүгээр сар","Аравдугаар сар","Арваннэгдүгээр сар","Арван хоёрдугаар сар"]},l={narrow:["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"],abbreviated:["1-р сар","2-р сар","3-р сар","4-р сар","5-р сар","6-р сар","7-р сар","8-р сар","9-р сар","10-р сар","11-р сар","12-р сар"],wide:["нэгдүгээр сар","хоёрдугаар сар","гуравдугаар сар","дөрөвдүгээр сар","тавдугаар сар","зургаадугаар сар","долоодугаар сар","наймдугаар сар","есдүгээр сар","аравдугаар сар","арваннэгдүгээр сар","арван хоёрдугаар сар"]},o={narrow:["Н","Д","М","Л","П","Б","Б"],short:["Ня","Да","Мя","Лх","Пү","Ба","Бя"],abbreviated:["Ням","Дав","Мяг","Лха","Пүр","Баа","Бям"],wide:["Ням","Даваа","Мягмар","Лхагва","Пүрэв","Баасан","Бямба"]},t={narrow:["Н","Д","М","Л","П","Б","Б"],short:["Ня","Да","Мя","Лх","Пү","Ба","Бя"],abbreviated:["Ням","Дав","Мяг","Лха","Пүр","Баа","Бям"],wide:["ням","даваа","мягмар","лхагва","пүрэв","баасан","бямба"]},s={narrow:{am:"ү.ө.",pm:"ү.х.",midnight:"шөнө дунд",noon:"үд дунд",morning:"өглөө",afternoon:"өдөр",evening:"орой",night:"шөнө"},abbreviated:{am:"ү.ө.",pm:"ү.х.",midnight:"шөнө дунд",noon:"үд дунд",morning:"өглөө",afternoon:"өдөр",evening:"орой",night:"шөнө"},wide:{am:"ү.ө.",pm:"ү.х.",midnight:"шөнө дунд",noon:"үд дунд",morning:"өглөө",afternoon:"өдөр",evening:"орой",night:"шөнө"}},f=function(m,w){return String(m)},v={ordinalNumber:f,era:(0,a.default)({values:i,defaultWidth:"wide"}),quarter:(0,a.default)({values:d,defaultWidth:"wide",argumentCallback:function(m){return m-1}}),month:(0,a.default)({values:u,defaultWidth:"wide",formattingValues:l,defaultFormattingWidth:"wide"}),day:(0,a.default)({values:o,defaultWidth:"wide",formattingValues:t,defaultFormattingWidth:"wide"}),dayPeriod:(0,a.default)({values:s,defaultWidth:"wide"})},h=v;e.default=h,n.exports=e.default})(P,P.exports);var q=P.exports,_={exports:{}};(function(n,e){var r=c.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=r(X),i=r(O),d=/\d+/i,u=/\d+/i,l={narrow:/^(нтө|нт)/i,abbreviated:/^(нтө|нт)/i,wide:/^(нийтийн тооллын өмнө|нийтийн тооллын)/i},o={any:[/^(нтө|нийтийн тооллын өмнө)/i,/^(нт|нийтийн тооллын)/i]},t={narrow:/^(iv|iii|ii|i)/i,abbreviated:/^(iv|iii|ii|i) улирал/i,wide:/^[1-4]-р улирал/i},s={any:[/^(i(\s|$)|1)/i,/^(ii(\s|$)|2)/i,/^(iii(\s|$)|3)/i,/^(iv(\s|$)|4)/i]},f={narrow:/^(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)/i,abbreviated:/^(1-р сар|2-р сар|3-р сар|4-р сар|5-р сар|6-р сар|7-р сар|8-р сар|9-р сар|10-р сар|11-р сар|12-р сар)/i,wide:/^(нэгдүгээр сар|хоёрдугаар сар|гуравдугаар сар|дөрөвдүгээр сар|тавдугаар сар|зургаадугаар сар|долоодугаар сар|наймдугаар сар|есдүгээр сар|аравдугаар сар|арван нэгдүгээр сар|арван хоёрдугаар сар)/i},v={narrow:[/^i$/i,/^ii$/i,/^iii$/i,/^iv$/i,/^v$/i,/^vi$/i,/^vii$/i,/^viii$/i,/^ix$/i,/^x$/i,/^xi$/i,/^xii$/i],any:[/^(1|нэгдүгээр)/i,/^(2|хоёрдугаар)/i,/^(3|гуравдугаар)/i,/^(4|дөрөвдүгээр)/i,/^(5|тавдугаар)/i,/^(6|зургаадугаар)/i,/^(7|долоодугаар)/i,/^(8|наймдугаар)/i,/^(9|есдүгээр)/i,/^(10|аравдугаар)/i,/^(11|арван нэгдүгээр)/i,/^(12|арван хоёрдугаар)/i]},h={narrow:/^[ндмлпбб]/i,short:/^(ня|да|мя|лх|пү|ба|бя)/i,abbreviated:/^(ням|дав|мяг|лха|пүр|баа|бям)/i,wide:/^(ням|даваа|мягмар|лхагва|пүрэв|баасан|бямба)/i},p={narrow:[/^н/i,/^д/i,/^м/i,/^л/i,/^п/i,/^б/i,/^б/i],any:[/^ня/i,/^да/i,/^мя/i,/^лх/i,/^пү/i,/^ба/i,/^бя/i]},m={narrow:/^(ү\.ө\.|ү\.х\.|шөнө дунд|үд дунд|өглөө|өдөр|орой|шөнө)/i,any:/^(ү\.ө\.|ү\.х\.|шөнө дунд|үд дунд|өглөө|өдөр|орой|шөнө)/i},w={any:{am:/^ү\.ө\./i,pm:/^ү\.х\./i,midnight:/^шөнө дунд/i,noon:/^үд дунд/i,morning:/өглөө/i,afternoon:/өдөр/i,evening:/орой/i,night:/шөнө/i}},W={ordinalNumber:(0,i.default)({matchPattern:d,parsePattern:u,valueCallback:function(b){return parseInt(b,10)}}),era:(0,a.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:o,defaultParseWidth:"any"}),quarter:(0,a.default)({matchPatterns:t,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(b){return b+1}}),month:(0,a.default)({matchPatterns:f,defaultMatchWidth:"wide",parsePatterns:v,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:p,defaultParseWidth:"any"}),dayPeriod:(0,a.default)({matchPatterns:m,defaultMatchWidth:"any",parsePatterns:w,defaultParseWidth:"any"})},k=W;e.default=k,n.exports=e.default})(_,_.exports);var C=_.exports;(function(n,e){var r=c.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=r(z),i=r(F),d=r(R),u=r(q),l=r(C),o={code:"mn",formatDistance:a.default,formatLong:i.default,formatRelative:d.default,localize:u.default,match:l.default,options:{weekStartsOn:1,firstWeekContainsDate:1}},t=o;e.default=t,n.exports=e.default})(I,I.exports);var M=I.exports;const L=D(M),H=j({__proto__:null,default:L},[M]);export{H as i};
