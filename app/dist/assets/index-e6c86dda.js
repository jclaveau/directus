import{g as O}from"./index.c1b672a5.entry.js";import{i as m,b as j,a as z,c as R,d as F}from"./index-ead2b777.js";function S(u,e){for(var a=0;a<e.length;a++){const t=e[a];if(typeof t!="string"&&!Array.isArray(t)){for(const r in t)if(r!=="default"&&!(r in u)){const o=Object.getOwnPropertyDescriptor(t,r);o&&Object.defineProperty(u,r,o.get?o:{enumerable:!0,get:()=>t[r]})}}}return Object.freeze(Object.defineProperty(u,Symbol.toStringTag,{value:"Module"}))}var b={exports:{}},y={exports:{}};(function(u,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a={lessThanXSeconds:{past:"{{count}} წამზე ნაკლები ხნის წინ",present:"{{count}} წამზე ნაკლები",future:"{{count}} წამზე ნაკლებში"},xSeconds:{past:"{{count}} წამის წინ",present:"{{count}} წამი",future:"{{count}} წამში"},halfAMinute:{past:"ნახევარი წუთის წინ",present:"ნახევარი წუთი",future:"ნახევარი წუთში"},lessThanXMinutes:{past:"{{count}} წუთზე ნაკლები ხნის წინ",present:"{{count}} წუთზე ნაკლები",future:"{{count}} წუთზე ნაკლებში"},xMinutes:{past:"{{count}} წუთის წინ",present:"{{count}} წუთი",future:"{{count}} წუთში"},aboutXHours:{past:"დაახლოებით {{count}} საათის წინ",present:"დაახლოებით {{count}} საათი",future:"დაახლოებით {{count}} საათში"},xHours:{past:"{{count}} საათის წინ",present:"{{count}} საათი",future:"{{count}} საათში"},xDays:{past:"{{count}} დღის წინ",present:"{{count}} დღე",future:"{{count}} დღეში"},aboutXWeeks:{past:"დაახლოებით {{count}} კვირას წინ",present:"დაახლოებით {{count}} კვირა",future:"დაახლოებით {{count}} კვირაში"},xWeeks:{past:"{{count}} კვირას კვირა",present:"{{count}} კვირა",future:"{{count}} კვირაში"},aboutXMonths:{past:"დაახლოებით {{count}} თვის წინ",present:"დაახლოებით {{count}} თვე",future:"დაახლოებით {{count}} თვეში"},xMonths:{past:"{{count}} თვის წინ",present:"{{count}} თვე",future:"{{count}} თვეში"},aboutXYears:{past:"დაახლოებით {{count}} წლის წინ",present:"დაახლოებით {{count}} წელი",future:"დაახლოებით {{count}} წელში"},xYears:{past:"{{count}} წლის წინ",present:"{{count}} წელი",future:"{{count}} წელში"},overXYears:{past:"{{count}} წელზე მეტი ხნის წინ",present:"{{count}} წელზე მეტი",future:"{{count}} წელზე მეტი ხნის შემდეგ"},almostXYears:{past:"თითქმის {{count}} წლის წინ",present:"თითქმის {{count}} წელი",future:"თითქმის {{count}} წელში"}},t=function(l,i,n){var d,s=a[l];return typeof s=="string"?d=s:n!=null&&n.addSuffix&&n.comparison&&n.comparison>0?d=s.future.replace("{{count}}",String(i)):n!=null&&n.addSuffix?d=s.past.replace("{{count}}",String(i)):d=s.present.replace("{{count}}",String(i)),d},r=t;e.default=r,u.exports=e.default})(y,y.exports);var q=y.exports,P={exports:{}};(function(u,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(j),r={full:"EEEE, do MMMM, y",long:"do, MMMM, y",medium:"d, MMM, y",short:"dd/MM/yyyy"},o={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},l={full:"{{date}} {{time}}'-ზე'",long:"{{date}} {{time}}'-ზე'",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},i={date:(0,t.default)({formats:r,defaultWidth:"full"}),time:(0,t.default)({formats:o,defaultWidth:"full"}),dateTime:(0,t.default)({formats:l,defaultWidth:"full"})},n=i;e.default=n,u.exports=e.default})(P,P.exports);var C=P.exports,x={exports:{}};(function(u,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a={lastWeek:"'წინა' eeee p'-ზე'",yesterday:"'გუშინ' p'-ზე'",today:"'დღეს' p'-ზე'",tomorrow:"'ხვალ' p'-ზე'",nextWeek:"'შემდეგი' eeee p'-ზე'",other:"P"},t=function(l,i,n,d){return a[l]},r=t;e.default=r,u.exports=e.default})(x,x.exports);var L=x.exports,_={exports:{}};(function(u,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(z),r={narrow:["ჩ.წ-მდე","ჩ.წ"],abbreviated:["ჩვ.წ-მდე","ჩვ.წ"],wide:["ჩვენს წელთაღრიცხვამდე","ჩვენი წელთაღრიცხვით"]},o={narrow:["1","2","3","4"],abbreviated:["1-ლი კვ","2-ე კვ","3-ე კვ","4-ე კვ"],wide:["1-ლი კვარტალი","2-ე კვარტალი","3-ე კვარტალი","4-ე კვარტალი"]},l={narrow:["ია","თე","მა","აპ","მს","ვნ","ვლ","აგ","სე","ოქ","ნო","დე"],abbreviated:["იან","თებ","მარ","აპრ","მაი","ივნ","ივლ","აგვ","სექ","ოქტ","ნოე","დეკ"],wide:["იანვარი","თებერვალი","მარტი","აპრილი","მაისი","ივნისი","ივლისი","აგვისტო","სექტემბერი","ოქტომბერი","ნოემბერი","დეკემბერი"]},i={narrow:["კვ","ორ","სა","ოთ","ხუ","პა","შა"],short:["კვი","ორშ","სამ","ოთხ","ხუთ","პარ","შაბ"],abbreviated:["კვი","ორშ","სამ","ოთხ","ხუთ","პარ","შაბ"],wide:["კვირა","ორშაბათი","სამშაბათი","ოთხშაბათი","ხუთშაბათი","პარასკევი","შაბათი"]},n={narrow:{am:"a",pm:"p",midnight:"შუაღამე",noon:"შუადღე",morning:"დილა",afternoon:"საღამო",evening:"საღამო",night:"ღამე"},abbreviated:{am:"AM",pm:"PM",midnight:"შუაღამე",noon:"შუადღე",morning:"დილა",afternoon:"საღამო",evening:"საღამო",night:"ღამე"},wide:{am:"a.m.",pm:"p.m.",midnight:"შუაღამე",noon:"შუადღე",morning:"დილა",afternoon:"საღამო",evening:"საღამო",night:"ღამე"}},d={narrow:{am:"a",pm:"p",midnight:"შუაღამით",noon:"შუადღისას",morning:"დილით",afternoon:"ნაშუადღევს",evening:"საღამოს",night:"ღამით"},abbreviated:{am:"AM",pm:"PM",midnight:"შუაღამით",noon:"შუადღისას",morning:"დილით",afternoon:"ნაშუადღევს",evening:"საღამოს",night:"ღამით"},wide:{am:"a.m.",pm:"p.m.",midnight:"შუაღამით",noon:"შუადღისას",morning:"დილით",afternoon:"ნაშუადღევს",evening:"საღამოს",night:"ღამით"}},s=function(f){var c=Number(f);return c===1?c+"-ლი":c+"-ე"},v={ordinalNumber:s,era:(0,t.default)({values:r,defaultWidth:"wide"}),quarter:(0,t.default)({values:o,defaultWidth:"wide",argumentCallback:function(f){return f-1}}),month:(0,t.default)({values:l,defaultWidth:"wide"}),day:(0,t.default)({values:i,defaultWidth:"wide"}),dayPeriod:(0,t.default)({values:n,defaultWidth:"wide",formattingValues:d,defaultFormattingWidth:"wide"})},p=v;e.default=p,u.exports=e.default})(_,_.exports);var N=_.exports,M={exports:{}};(function(u,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(R),r=a(F),o=/^(\d+)(-ლი|-ე)?/i,l=/\d+/i,i={narrow:/^(ჩვ?\.წ)/i,abbreviated:/^(ჩვ?\.წ)/i,wide:/^(ჩვენს წელთაღრიცხვამდე|ქრისტეშობამდე|ჩვენი წელთაღრიცხვით|ქრისტეშობიდან)/i},n={any:[/^(ჩვენს წელთაღრიცხვამდე|ქრისტეშობამდე)/i,/^(ჩვენი წელთაღრიცხვით|ქრისტეშობიდან)/i]},d={narrow:/^[1234]/i,abbreviated:/^[1234]-(ლი|ე)? კვ/i,wide:/^[1234]-(ლი|ე)? კვარტალი/i},s={any:[/1/i,/2/i,/3/i,/4/i]},v={any:/^(ია|თე|მა|აპ|მს|ვნ|ვლ|აგ|სე|ოქ|ნო|დე)/i},p={any:[/^ია/i,/^თ/i,/^მარ/i,/^აპ/i,/^მაი/i,/^ი?ვნ/i,/^ი?ვლ/i,/^აგ/i,/^ს/i,/^ო/i,/^ნ/i,/^დ/i]},h={narrow:/^(კვ|ორ|სა|ოთ|ხუ|პა|შა)/i,short:/^(კვი|ორშ|სამ|ოთხ|ხუთ|პარ|შაბ)/i,wide:/^(კვირა|ორშაბათი|სამშაბათი|ოთხშაბათი|ხუთშაბათი|პარასკევი|შაბათი)/i},f={any:[/^კვ/i,/^ორ/i,/^სა/i,/^ოთ/i,/^ხუ/i,/^პა/i,/^შა/i]},c={any:/^([ap]\.?\s?m\.?|შუაღ|დილ)/i},W={any:{am:/^a/i,pm:/^p/i,midnight:/^შუაღ/i,noon:/^შუადღ/i,morning:/^დილ/i,afternoon:/ნაშუადღევს/i,evening:/საღამო/i,night:/ღამ/i}},D={ordinalNumber:(0,r.default)({matchPattern:o,parsePattern:l,valueCallback:function(g){return parseInt(g,10)}}),era:(0,t.default)({matchPatterns:i,defaultMatchWidth:"wide",parsePatterns:n,defaultParseWidth:"any"}),quarter:(0,t.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(g){return g+1}}),month:(0,t.default)({matchPatterns:v,defaultMatchWidth:"any",parsePatterns:p,defaultParseWidth:"any"}),day:(0,t.default)({matchPatterns:h,defaultMatchWidth:"wide",parsePatterns:f,defaultParseWidth:"any"}),dayPeriod:(0,t.default)({matchPatterns:c,defaultMatchWidth:"any",parsePatterns:W,defaultParseWidth:"any"})},E=D;e.default=E,u.exports=e.default})(M,M.exports);var V=M.exports;(function(u,e){var a=m.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=a(q),r=a(C),o=a(L),l=a(N),i=a(V),n={code:"ka",formatDistance:t.default,formatLong:r.default,formatRelative:o.default,localize:l.default,match:i.default,options:{weekStartsOn:1,firstWeekContainsDate:1}},d=n;e.default=d,u.exports=e.default})(b,b.exports);var w=b.exports;const X=O(w),Y=S({__proto__:null,default:X},[w]);export{Y as i};
