function r(e){return e==="Tag"||e==="Monat"?"r":e==="Jahr"?"s":""}var n={code:"de-at",week:{dow:1,doy:4},buttonText:{prev:"Zurück",next:"Vor",today:"Heute",year:"Jahr",month:"Monat",week:"Woche",day:"Tag",list:"Terminübersicht"},weekText:"KW",weekTextLong:"Woche",allDayText:"Ganztägig",moreLinkText(e){return"+ weitere "+e},noEventsText:"Keine Ereignisse anzuzeigen",buttonHints:{prev(e){return`Vorherige${r(e)} ${e}`},next(e){return`Nächste${r(e)} ${e}`},today(e){return e==="Tag"?"Heute":`Diese${r(e)} ${e}`}},viewHint(e){return e+(e==="Woche"?"n":e==="Monat"?"s":"es")+"ansicht"},navLinkHint:"Gehe zu $0",moreLinkHint(e){return"Zeige "+(e===1?"ein weiteres Ereignis":e+" weitere Ereignisse")},closeHint:"Schließen",timeHint:"Uhrzeit",eventHint:"Ereignis"};export{n as default};
