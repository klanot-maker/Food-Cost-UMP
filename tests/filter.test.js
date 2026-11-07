const fs=require('fs');
const path=require('path');
// Found relative to this file rather than at a fixed location, so the suite
// runs wherever the repository is checked out — a laptop, a CI runner.
const ROOT=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'CaloDeliveries.gs'),'utf8');
const grid=Array.from({length:170},()=>Array(24).fill(''));
[1,2,3,4,5,6,7].forEach((d,i)=>{grid[133+i][20]=`Nov ${d}, 26`;});
[2427,5939,5999,6000,5828,3404,792].forEach((v,i)=>grid[133+i][21]=v);
const written=[];
const SHEET={getDataRange:()=>({getValues:()=>grid}),getRange:(r,c)=>({setValue:v=>{written.push({r,c,v});grid[r-1][c-1]=v;}})};
global.SpreadsheetApp={openById:()=>({getName:()=>'W',getSheetByName:n=>n==='DELIVERIES'?SHEET:null})};
global.SS_COMPLAINTS_=()=>'x'; global.CFG_KITCHEN_=()=>'AE001';
const props={CALO_API_KEY:'k',CALO_QS_STYLE:'brackets'};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})};
global.Session={getScriptTimeZone:()=>'Asia/Dubai'};
global.Logger={log:()=>{}};
global.Utilities={formatDate:()=>'2026-11-05'};
global.ScriptApp={newTrigger:()=>({timeBased:()=>({atHour:()=>({everyDays:()=>({create:()=>{}})})})}),getProjectTriggers:()=>[]};

const TRUTH={'2026-11-01':2130,'2026-11-02':5570,'2026-11-03':5625,'2026-11-04':5602,'2026-11-05':5321,'2026-11-06':3807};
const SURPLUS={'2026-11-01':297,'2026-11-02':369,'2026-11-03':374,'2026-11-04':398,'2026-11-05':507,'2026-11-06':410};
let lastUrl='';
global.UrlFetchApp={fetch:u=>{
  const q=lastUrl=decodeURIComponent(u);
  const day=(q.match(/filters\[day\]\[gte\]=(\d{4}-\d{2}-\d{2})/)||[])[1];
  if(!day)return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({count:60635664})};
  const t=TRUTH[day], sur=SURPLUS[day];
  const sk   = /filters\[skipped\]=false/.test(q);
  const up   = /filters\[status\]\[\]=upcoming/.test(q);
  const np   = /filters\[status\]\[\]=paymentRequired/.test(q);
  const ctry = /filters\[country\]=AE/.test(q);
  let n = t + sur;
  if (sk && up && np) n = t;                       // the dashboard's own filter
  else if (sk && up)  n = t - 160;                 // missing the unpaid ones
  else if (up && np)  n = t + 237;                 // skipped still included
  else if (sk)        n = t + 120;
  else if (/filters\[status\]\[\]=cancelled/.test(q)) n = 180;
  else if (/filters\[status\]\[\]=paused/.test(q))    n = 90;
  else if (/filters\[status\]\[\]=suspended/.test(q)) n = 70;
  else if (/filters\[skipped\]=true/.test(q))         n = 237;
  else if (/filters\[deliveryStatus\]=delivered/.test(q)) n = Math.round(t*0.6);
  if (ctry && !(sk&&up&&np)) n = n;                // country alone changes nothing
  return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({count:n,cost:[]})};
}};
eval(src);
let pass=0,fail=0;
const t=(n,c,w)=>{const ok=JSON.stringify(c)===JSON.stringify(w);console.log((ok?'  PASS  ':'  FAIL  ')+n+'  got='+JSON.stringify(c)+(ok?'':' want='+JSON.stringify(w)));ok?pass++:fail++;};

t('country derived from kitchen', _caloCountry_(), 'AE');
const u=decodeURIComponent(_caloDlvUrl_('2026-11-06','AE001',{skipped:false,status:['upcoming','paymentRequired']}));
t('two status values both sent', u.includes('filters[status][]=upcoming')&&u.includes('filters[status][]=paymentRequired'), true);
t('skipped=false sent',          u.includes('filters[skipped]=false'), true);

let r=caloFindFilter();
t('finds the dashboard filter', /MATCHES EVERY DAY/.test(r), true);
t('saves exactly it', JSON.parse(props.CALO_DLV_FILTER), {skipped:false,status:['upcoming','paymentRequired']});
t('dashboard candidate ranked first', r.indexOf('DASHBOARD skipped=false')<r.indexOf('(no filter)'), true);
t('shows the half-filters failing', /skipped=false status=upcoming /.test(r), true);

// The wire format, on a single day. The sync window is h5's job: this
// fixture only defines six truth days, so a three-week window would error
// on the rest and any "left alone" assertion here would pass for the wrong
// reason rather than because the window held.
_caloCountFor_('2026-11-06',{skipped:false,status:['upcoming','paymentRequired']});
t('wire carries the saved filter', /filters\[status\]\[\]=paymentRequired/.test(lastUrl), true);
t('wire carries skipped=false',    /filters\[skipped\]=false/.test(lastUrl), true);
t('wire pins the single day',      /filters\[day\]\[gte\]=2026-11-06/.test(lastUrl)&&/filters\[day\]\[lte\]=2026-11-06/.test(lastUrl), true);
t('wire carries the kitchen',      /filters\[kitchen\]=AE001/.test(lastUrl), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
