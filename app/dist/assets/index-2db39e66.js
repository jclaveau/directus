import{g as L}from"./index.c1b672a5.entry.js";import{i as c,a as R,b as z,c as F,d as V}from"./index-ead2b777.js";function q(i,e){for(var t=0;t<e.length;t++){const a=e[t];if(typeof a!="string"&&!Array.isArray(a)){for(const r in a)if(r!=="default"&&!(r in i)){const n=Object.getOwnPropertyDescriptor(a,r);n&&Object.defineProperty(i,r,n.get?n:{enumerable:!0,get:()=>a[r]})}}}return Object.freeze(Object.defineProperty(i,Symbol.toStringTag,{value:"Module"}))}var b={exports:{}},p={exports:{}},v={},C=c.default;Object.defineProperty(v,"__esModule",{value:!0});v.default=void 0;v.numberToLocale=y;var m=C(R),T={locale:{1:"১",2:"২",3:"৩",4:"৪",5:"৫",6:"৬",7:"৭",8:"৮",9:"৯",0:"০"},number:{"১":"1","২":"2","৩":"3","৪":"4","৫":"5","৬":"6","৭":"7","৮":"8","৯":"9","০":"0"}},X={narrow:["খ্রিঃপূঃ","খ্রিঃ"],abbreviated:["খ্রিঃপূর্ব","খ্রিঃ"],wide:["খ্রিস্টপূর্ব","খ্রিস্টাব্দ"]},S={narrow:["১","২","৩","৪"],abbreviated:["১ত্রৈ","২ত্রৈ","৩ত্রৈ","৪ত্রৈ"],wide:["১ম ত্রৈমাসিক","২য় ত্রৈমাসিক","৩য় ত্রৈমাসিক","৪র্থ ত্রৈমাসিক"]},N={narrow:["জানু","ফেব্রু","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্ট","অক্টো","নভে","ডিসে"],abbreviated:["জানু","ফেব্রু","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্ট","অক্টো","নভে","ডিসে"],wide:["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"]},Y={narrow:["র","সো","ম","বু","বৃ","শু","শ"],short:["রবি","সোম","মঙ্গল","বুধ","বৃহ","শুক্র","শনি"],abbreviated:["রবি","সোম","মঙ্গল","বুধ","বৃহ","শুক্র","শনি"],wide:["রবিবার","সোমবার","মঙ্গলবার","বুধবার","বৃহস্পতিবার ","শুক্রবার","শনিবার"]},A={narrow:{am:"পূ",pm:"অপ",midnight:"মধ্যরাত",noon:"মধ্যাহ্ন",morning:"সকাল",afternoon:"বিকাল",evening:"সন্ধ্যা",night:"রাত"},abbreviated:{am:"পূর্বাহ্ন",pm:"অপরাহ্ন",midnight:"মধ্যরাত",noon:"মধ্যাহ্ন",morning:"সকাল",afternoon:"বিকাল",evening:"সন্ধ্যা",night:"রাত"},wide:{am:"পূর্বাহ্ন",pm:"অপরাহ্ন",midnight:"মধ্যরাত",noon:"মধ্যাহ্ন",morning:"সকাল",afternoon:"বিকাল",evening:"সন্ধ্যা",night:"রাত"}},H={narrow:{am:"পূ",pm:"অপ",midnight:"মধ্যরাত",noon:"মধ্যাহ্ন",morning:"সকাল",afternoon:"বিকাল",evening:"সন্ধ্যা",night:"রাত"},abbreviated:{am:"পূর্বাহ্ন",pm:"অপরাহ্ন",midnight:"মধ্যরাত",noon:"মধ্যাহ্ন",morning:"সকাল",afternoon:"বিকাল",evening:"সন্ধ্যা",night:"রাত"},wide:{am:"পূর্বাহ্ন",pm:"অপরাহ্ন",midnight:"মধ্যরাত",noon:"মধ্যাহ্ন",morning:"সকাল",afternoon:"বিকাল",evening:"সন্ধ্যা",night:"রাত"}};function Q(i,e){if(i>18&&i<=31)return e+"শে";switch(i){case 1:return e+"লা";case 2:case 3:return e+"রা";case 4:return e+"ঠা";default:return e+"ই"}}var $=function(e,t){var a=Number(e),r=y(a),n=t==null?void 0:t.unit;if(n==="date")return Q(a,r);if(a>10||a===0)return r+"তম";var o=a%10;switch(o){case 2:case 3:return r+"য়";case 4:return r+"র্থ";case 6:return r+"ষ্ঠ";default:return r+"ম"}};function y(i){return i.toString().replace(/\d/g,function(e){return T.locale[e]})}var I={ordinalNumber:$,era:(0,m.default)({values:X,defaultWidth:"wide"}),quarter:(0,m.default)({values:S,defaultWidth:"wide",argumentCallback:function(e){return e-1}}),month:(0,m.default)({values:N,defaultWidth:"wide"}),day:(0,m.default)({values:Y,defaultWidth:"wide"}),dayPeriod:(0,m.default)({values:A,defaultWidth:"wide",formattingValues:H,defaultFormattingWidth:"wide"})},B=I;v.default=B;(function(i,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t=v,a={lessThanXSeconds:{one:"প্রায় ১ সেকেন্ড",other:"প্রায় {{count}} সেকেন্ড"},xSeconds:{one:"১ সেকেন্ড",other:"{{count}} সেকেন্ড"},halfAMinute:"আধ মিনিট",lessThanXMinutes:{one:"প্রায় ১ মিনিট",other:"প্রায় {{count}} মিনিট"},xMinutes:{one:"১ মিনিট",other:"{{count}} মিনিট"},aboutXHours:{one:"প্রায় ১ ঘন্টা",other:"প্রায় {{count}} ঘন্টা"},xHours:{one:"১ ঘন্টা",other:"{{count}} ঘন্টা"},xDays:{one:"১ দিন",other:"{{count}} দিন"},aboutXWeeks:{one:"প্রায় ১ সপ্তাহ",other:"প্রায় {{count}} সপ্তাহ"},xWeeks:{one:"১ সপ্তাহ",other:"{{count}} সপ্তাহ"},aboutXMonths:{one:"প্রায় ১ মাস",other:"প্রায় {{count}} মাস"},xMonths:{one:"১ মাস",other:"{{count}} মাস"},aboutXYears:{one:"প্রায় ১ বছর",other:"প্রায় {{count}} বছর"},xYears:{one:"১ বছর",other:"{{count}} বছর"},overXYears:{one:"১ বছরের বেশি",other:"{{count}} বছরের বেশি"},almostXYears:{one:"প্রায় ১ বছর",other:"প্রায় {{count}} বছর"}},r=function(l,u,d){var s,f=a[l];return typeof f=="string"?s=f:u===1?s=f.one:s=f.other.replace("{{count}}",(0,t.numberToLocale)(u)),d!=null&&d.addSuffix?d.comparison&&d.comparison>0?s+" এর মধ্যে":s+" আগে":s},n=r;e.default=n,i.exports=e.default})(p,p.exports);var G=p.exports,g={exports:{}};(function(i,e){var t=c.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(z),r={full:"EEEE, MMMM do, y",long:"MMMM do, y",medium:"MMM d, y",short:"MM/dd/yyyy"},n={full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},o={full:"{{date}} {{time}} 'সময়'",long:"{{date}} {{time}} 'সময়'",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},l={date:(0,a.default)({formats:r,defaultWidth:"full"}),time:(0,a.default)({formats:n,defaultWidth:"full"}),dateTime:(0,a.default)({formats:o,defaultWidth:"full"})},u=l;e.default=u,i.exports=e.default})(g,g.exports);var J=g.exports,P={exports:{}};(function(i,e){Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var t={lastWeek:"'গত' eeee 'সময়' p",yesterday:"'গতকাল' 'সময়' p",today:"'আজ' 'সময়' p",tomorrow:"'আগামীকাল' 'সময়' p",nextWeek:"eeee 'সময়' p",other:"P"},a=function(o,l,u,d){return t[o]},r=a;e.default=r,i.exports=e.default})(P,P.exports);var K=P.exports,w={exports:{}};(function(i,e){var t=c.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(F),r=t(V),n=/^(\d+)(ম|য়|র্থ|ষ্ঠ|শে|ই|তম)?/i,o=/\d+/i,l={narrow:/^(খ্রিঃপূঃ|খ্রিঃ)/i,abbreviated:/^(খ্রিঃপূর্ব|খ্রিঃ)/i,wide:/^(খ্রিস্টপূর্ব|খ্রিস্টাব্দ)/i},u={narrow:[/^খ্রিঃপূঃ/i,/^খ্রিঃ/i],abbreviated:[/^খ্রিঃপূর্ব/i,/^খ্রিঃ/i],wide:[/^খ্রিস্টপূর্ব/i,/^খ্রিস্টাব্দ/i]},d={narrow:/^[১২৩৪]/i,abbreviated:/^[১২৩৪]ত্রৈ/i,wide:/^[১২৩৪](ম|য়|র্থ)? ত্রৈমাসিক/i},s={any:[/১/i,/২/i,/৩/i,/৪/i]},f={narrow:/^(জানু|ফেব্রু|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্ট|অক্টো|নভে|ডিসে)/i,abbreviated:/^(জানু|ফেব্রু|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্ট|অক্টো|নভে|ডিসে)/i,wide:/^(জানুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)/i},x={any:[/^জানু/i,/^ফেব্রু/i,/^মার্চ/i,/^এপ্রিল/i,/^মে/i,/^জুন/i,/^জুলাই/i,/^আগস্ট/i,/^সেপ্ট/i,/^অক্টো/i,/^নভে/i,/^ডিসে/i]},M={narrow:/^(র|সো|ম|বু|বৃ|শু|শ)+/i,short:/^(রবি|সোম|মঙ্গল|বুধ|বৃহ|শুক্র|শনি)+/i,abbreviated:/^(রবি|সোম|মঙ্গল|বুধ|বৃহ|শুক্র|শনি)+/i,wide:/^(রবিবার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার |শুক্রবার|শনিবার)+/i},W={narrow:[/^র/i,/^সো/i,/^ম/i,/^বু/i,/^বৃ/i,/^শু/i,/^শ/i],short:[/^রবি/i,/^সোম/i,/^মঙ্গল/i,/^বুধ/i,/^বৃহ/i,/^শুক্র/i,/^শনি/i],abbreviated:[/^রবি/i,/^সোম/i,/^মঙ্গল/i,/^বুধ/i,/^বৃহ/i,/^শুক্র/i,/^শনি/i],wide:[/^রবিবার/i,/^সোমবার/i,/^মঙ্গলবার/i,/^বুধবার/i,/^বৃহস্পতিবার /i,/^শুক্রবার/i,/^শনিবার/i]},D={narrow:/^(পূ|অপ|মধ্যরাত|মধ্যাহ্ন|সকাল|বিকাল|সন্ধ্যা|রাত)/i,abbreviated:/^(পূর্বাহ্ন|অপরাহ্ন|মধ্যরাত|মধ্যাহ্ন|সকাল|বিকাল|সন্ধ্যা|রাত)/i,wide:/^(পূর্বাহ্ন|অপরাহ্ন|মধ্যরাত|মধ্যাহ্ন|সকাল|বিকাল|সন্ধ্যা|রাত)/i},E={any:{am:/^পূ/i,pm:/^অপ/i,midnight:/^মধ্যরাত/i,noon:/^মধ্যাহ্ন/i,morning:/সকাল/i,afternoon:/বিকাল/i,evening:/সন্ধ্যা/i,night:/রাত/i}},O={ordinalNumber:(0,r.default)({matchPattern:n,parsePattern:o,valueCallback:function(h){return parseInt(h,10)}}),era:(0,a.default)({matchPatterns:l,defaultMatchWidth:"wide",parsePatterns:u,defaultParseWidth:"wide"}),quarter:(0,a.default)({matchPatterns:d,defaultMatchWidth:"wide",parsePatterns:s,defaultParseWidth:"any",valueCallback:function(h){return h+1}}),month:(0,a.default)({matchPatterns:f,defaultMatchWidth:"wide",parsePatterns:x,defaultParseWidth:"any"}),day:(0,a.default)({matchPatterns:M,defaultMatchWidth:"wide",parsePatterns:W,defaultParseWidth:"wide"}),dayPeriod:(0,a.default)({matchPatterns:D,defaultMatchWidth:"wide",parsePatterns:E,defaultParseWidth:"any"})},k=O;e.default=k,i.exports=e.default})(w,w.exports);var U=w.exports;(function(i,e){var t=c.default;Object.defineProperty(e,"__esModule",{value:!0}),e.default=void 0;var a=t(G),r=t(J),n=t(K),o=t(v),l=t(U),u={code:"bn",formatDistance:a.default,formatLong:r.default,formatRelative:n.default,localize:o.default,match:l.default,options:{weekStartsOn:0,firstWeekContainsDate:1}},d=u;e.default=d,i.exports=e.default})(b,b.exports);var _=b.exports;const Z=L(_),te=q({__proto__:null,default:Z},[_]);export{te as i};
