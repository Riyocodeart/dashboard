/* Desk Performance Board · static front end (HTML + CSS + JS), shared data in Supabase. */
(function(){
'use strict';

/* ╔══════════════════════════════════════════════════════════════════════════╗
   ║  CONFIGURATION — the only part you normally edit                         ║
   ╚══════════════════════════════════════════════════════════════════════════╝ */
var CONFIG={

  /* 1 · Supabase project (Supabase → Project Settings → API).
     The key is the public "anon" / "publishable" key. It only allows reading the
     dashboard and calling the password-protected functions. Never put the
     service_role / secret key here. */
  supabase:{
    url:'https://YOUR-PROJECT-REF.supabase.co',
    key:'YOUR-ANON-OR-PUBLISHABLE-KEY'
  },

  refreshSeconds:60,     // viewers pick up new uploads automatically (0 = off)
  maxFileMB:6,           // largest .xlsx accepted per file

  /* 2 · Validation targets shown in "Merge check". They are a warning, not a block.
     Update them for new files, or set  expected:null  to hide the check. */
  expected:{users:24,gls:3,tls:6,clients:307,greyRows:231,from:'2026-10-12',to:'2026-10-23'},

  /* 3 · Column mapping. For each field: the column names to look for (case, spaces
     and symbols are ignored), plus optional "contains" fallbacks.
     If a future file renames a column, add the new name to the list.            */
  files:{
    map:{title:'Mapping file',tag:'MAP',sheet:0,fields:{
      gl:   {label:'GL',            names:['GL','GL Name','Group Leader'],                         required:true},
      tl:   {label:'TL',            names:['TL','TL Name','Team Leader'],                          required:true},
      id:   {label:'User ID',       names:['User ID','UID','Emp ID','Employee ID','ID','User','Users']},
      name: {label:'User Name',     names:['User Name','Name','Employee Name']},
      uniq: {label:'Unique Clients',names:['Unique Clients','Unique Client','Unique'],contains:['unique'],type:'number',required:true},
      total:{label:'Total Clients', names:['Total Clients','Total Client','Total'], contains:['total'], type:'number',required:true},
      opts: {label:'Options',       names:['Options','Option'],                     contains:['option'],type:'number',required:true}
    }},
    margin:{title:'Margin file',tag:'MRG',sheet:0,fields:{
      user:  {label:'User ID',     names:['User ID','UID','Emp ID','Employee ID','ID','User','Users','User Name'],required:true},
      client:{label:'Client ID',   names:['Client ID','Client','Client Code','Client Name','UCC']},
      margin:{label:'Margin (INR)',names:['Margin (INR)','Margin','Margin Amount'],contains:['margin'],type:'number',required:true}
    }},
    grey:{title:'Greylabs file',tag:'GRY',sheet:0,fields:{
      date:  {label:'Date',             names:['Date','Day'],contains:['date'],type:'date',required:true},
      user:  {label:'User ID',          names:['User ID','UID','Emp ID','Employee ID','ID','User','Users','User Name'],required:true},
      domain:{label:'Domain',           names:['Domain','Project']},
      type:  {label:'Task Type',        names:['Task Type','Type','Activity','Task']},
      lang:  {label:'Language',         names:['Language','Lang']},
      tasks: {label:'Tasks Completed',  names:['Tasks Completed','Tasks','Task Count','Completed'],contains:['completed','count'],type:'number',required:true},
      hours: {label:'Hours',            names:['Hours','Hrs','Hours Worked'],contains:['hour'],type:'number'},
      q:     {label:'Quality Score (%)',names:['Quality Score (%)','Quality Score','Quality','Score','QA Score','QA'],contains:['quality','score'],type:'percent'}
    }}
  },

  /* 4 · Chart and display settings */
  charts:{
    marginCutoff:100000,             // clients at/above this margin count as "high"
    marginCutoffShort:'₹1L',
    marginCutoffLong:'₹1,00,000',
    qualityGood:90, qualityWarn:85,  // quality pill colours: ≥good green, ≥warn amber, else red
    taskTypes:[                      // Task Type text containing "match" is grouped under "label"
      {match:'eval',label:'Voice Evaluation'},
      {match:'test',label:'Voice Testing'}
    ],
    seriesColors:['#12a594','#4f7fe0'],  // line chart / task-mix colours
    lineHeight:250,                  // px
    marginGroupBy:'auto'             // 'auto' (TL, or users when one TL is selected) | 'tl' | 'gl' | 'user'
  }
};
/* ═══════════════════════════ END OF CONFIGURATION ═══════════════════════════ */


/* ---------- parsing ---------- */
var CH=CONFIG.charts,CUT=CH.marginCutoff;
var p2=function(n){return (n<10?'0':'')+n};
var norm=function(s){return String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]/g,'')};
var up=function(s){return String(s==null?'':s).trim().replace(/\s+/g,' ').toUpperCase()};
var num=function(v){if(typeof v==='number')return isFinite(v)?v:0;var n=parseFloat(String(v).replace(/[₹,\s%]/g,''));return isFinite(n)?n:0};
var txt=function(v){return String(v==null?'':v).trim()};
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDate(iso){var a=iso.split('-');return (+a[2])+' '+MON[+a[1]-1]}
function isoDate(v){
  var d,m;
  if(v instanceof Date&&!isNaN(v)){d=new Date(v.getTime()+432e5);return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
  if(typeof v==='number'){return new Date(Math.round((v-25569)*864e5)).toISOString().slice(0,10)}
  var s=String(v).trim();if(!s)return null;
  if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})/)))return m[1]+'-'+m[2]+'-'+m[3];
  if((m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)))return m[3]+'-'+p2(+m[2])+'-'+p2(+m[1]);   // dd/mm/yyyy
  var t=Date.parse(s);if(!isNaN(t)){d=new Date(t);return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
  return null;
}
/* Find the sheet column for a configured field: exact names first, then "contains" fallbacks. Each column is used once. */
function findCol(keys,f,used){
  var i,k,ex=f.names.map(norm),pa=(f.contains||[]).map(norm);
  for(i=0;i<ex.length;i++){k=keys.filter(function(x){return x.n===ex[i]&&!used[x.raw]})[0];if(k)return k.raw}
  for(i=0;i<pa.length;i++){k=keys.filter(function(x){return x.n.indexOf(pa[i])>-1&&!used[x.raw]})[0];if(k)return k.raw}
  return null;
}
function cast(v,type){
  if(type==='number')return num(v);
  if(type==='date')return isoDate(v);
  if(type==='percent')return txt(v)===''?null:num(v);
  return txt(v);
}
function taskType(s){
  var l=s.toLowerCase();
  for(var i=0;i<CH.taskTypes.length;i++)if(l.indexOf(CH.taskTypes[i].match)>-1)return CH.taskTypes[i].label;
  return s||'Other tasks';
}
var POST={
  map:function(data,cols){
    if(!cols.id&&!cols.name)return {error:'Missing column(s): User ID / User Name'};
    data=data.filter(function(d){return d.id||d.name}).map(function(d){
      d.id=d.id||d.name;d.name=d.name||d.id;d.gl=d.gl||'Unassigned';d.tl=d.tl||'Unassigned';return d});
    var ids={},g={},t={};data.forEach(function(d){ids[up(d.id)]=1;g[d.gl]=1;t[d.tl]=1});
    return {data:data,msg:Object.keys(ids).length+' users · '+Object.keys(g).length+' GLs · '+Object.keys(t).length+' TLs'};
  },
  margin:function(data,cols){
    data=data.filter(function(d){return d.user});
    var hi=data.filter(function(d){return d.margin>=CUT}).length;
    return {data:data,msg:data.length+' rows · '+hi+' at '+CH.marginCutoffShort+' and above · '+(data.length-hi)+' below'+(cols.client?'':' · no Client ID column')};
  },
  grey:function(data){
    data=data.filter(function(d){return d.date&&d.user});
    if(!data.length)return {error:'No usable rows. Check the Date and User ID columns'};
    data.forEach(function(d){d.type=taskType(d.type)});
    var qs=data.filter(function(x){return x.q!=null});   // 0–1 fractions → percent
    if(qs.length&&qs.every(function(x){return x.q<=1})&&qs.some(function(x){return x.q>0}))qs.forEach(function(x){x.q=Math.round(x.q*1000)/10});
    var ds=uniq(data.map(function(x){return x.date})).sort();
    return {data:data,msg:data.length+' entries · '+ds.length+' days ('+shortDate(ds[0])+' to '+shortDate(ds[ds.length-1])+')'};
  }
};
function uniq(a){var o={};a.forEach(function(x){o[x]=1});return Object.keys(o)}
function parseFile(kind,rows){
  if(!rows.length)return {ok:false,error:'The file has no rows'};
  var spec=CONFIG.files[kind].fields,keys=Object.keys(rows[0]).map(function(raw){return {raw:raw,n:norm(raw)}});
  var cols={},used={},miss=[];
  Object.keys(spec).forEach(function(k){var c=findCol(keys,spec[k],used);cols[k]=c;if(c)used[c]=1;else if(spec[k].required)miss.push(spec[k].label)});
  if(miss.length)return {ok:false,error:'Missing column(s): '+miss.join(', ')};
  var data=rows.map(function(r){var o={};Object.keys(spec).forEach(function(k){o[k]=cols[k]?cast(r[cols[k]],spec[k].type):(spec[k].type==='number'?0:spec[k].type==='percent'?null:'')});return o});
  var res=POST[kind](data,cols);
  return res.error?{ok:false,error:res.error}:{ok:true,data:res.data,msg:res.msg};
}

/* ---------- merge ----------
   Mapping is the master list (one row per User ID). Margin and Greylabs rows join by User ID
   (or by User Name when that name is unique in the mapping). Duplicates are dropped before anything
   is summed, and rows with no matching user are left out of every total. */
function merge(ds){
  var rep={dupMap:0,dupMargin:0,dupGrey:0,unmMargin:0,unmGrey:0,matMargin:0,matGrey:0,rowsMargin:0,rowsGrey:0,noClient:false,exMargin:[],exGrey:[],nameMatched:0,noMargin:0,noGrey:0,diff:0,okChk:0,missing:[],dates:[]};
  var mapRows=ds.map?ds.map.rows:[],marRows=ds.margin?ds.margin.rows:[],greyRows=ds.grey?ds.grey.rows:[];
  ['map','margin','grey'].forEach(function(k){if(!ds[k])rep.missing.push(k)});
  var byId={},order=[],nameIdx={};
  mapRows.forEach(function(r){
    var k=up(r.id);if(!k)return;
    if(byId[k])rep.dupMap++;else order.push(k);
    byId[k]={id:r.id,name:r.name||r.id,gl:r.gl,tl:r.tl,uniq:r.uniq,total:r.total,opts:r.opts,hi:0,lo:0,mSum:0,tasks:0,hours:0,qw:0,qt:0,mRows:0,gRows:0};
  });
  order.forEach(function(k){var n=up(byId[k].name);(nameIdx[n]=nameIdx[n]||[]).push(k)});
  function resolve(s){var k=up(s);if(byId[k])return k;var c=nameIdx[k];if(c&&c.length===1){rep.nameMatched++;return c[0]}return null}
  var seenM={},hasClient=marRows.some(function(r){return r.client!==''});
  rep.noClient=marRows.length>0&&!hasClient;rep.rowsMargin=marRows.length;
  marRows.forEach(function(r){
    var k=resolve(r.user);
    if(!k){rep.unmMargin++;if(rep.exMargin.length<5)rep.exMargin.push(r.user);return}
    if(hasClient){var key=k+'|'+up(r.client);if(seenM[key]){rep.dupMargin++;return}seenM[key]=1}
    var u=byId[k];u.mRows++;rep.matMargin++;
    if(r.margin>=CUT)u.hi++;else u.lo++;u.mSum+=r.margin;
  });
  var seenG={},gr=[],dset={};rep.rowsGrey=greyRows.length;
  greyRows.forEach(function(r){
    var k=resolve(r.user);
    if(!k){rep.unmGrey++;if(rep.exGrey.length<5)rep.exGrey.push(r.user);return}
    var key=[k,r.date,r.domain,r.type,r.lang,r.tasks,r.hours,r.q].join('|');
    if(seenG[key]){rep.dupGrey++;return}seenG[key]=1;
    var u=byId[k];u.gRows++;rep.matGrey++;dset[r.date]=1;
    u.tasks+=r.tasks;u.hours+=r.hours;
    if(r.q!=null){var w=Math.max(r.tasks,1);u.qw+=r.q*w;u.qt+=w}
    gr.push({uid:u.id,date:r.date,type:r.type,tasks:r.tasks});
  });
  rep.dates=Object.keys(dset).sort();
  var users=order.map(function(k){
    var u=byId[k];u.q=u.qt?u.qw/u.qt:null;u.tph=u.hours>0?u.tasks/u.hours:null;
    var mc=u.hi+u.lo;
    if(!u.mRows){u.chk='No margin';rep.noMargin++}
    else if(mc===u.uniq){u.chk='Match';rep.okChk++}
    else{u.chk='Δ '+(mc-u.uniq>0?'+':'')+(mc-u.uniq);rep.diff++}
    if(!u.gRows)rep.noGrey++;
    return u;
  });
  return {users:users,grey:gr,rep:rep};
}

/* ---------- helpers ---------- */
var $=function(s){return document.querySelector(s)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var nfI=new Intl.NumberFormat('en-IN');
var fmt=function(n){return nfI.format(Math.round(n))};
var fmt1=function(n){return n.toLocaleString('en-IN',{minimumFractionDigits:1,maximumFractionDigits:1})};
var inr=function(n){if(n>=1e7)return '₹'+(n/1e7).toFixed(2)+' Cr';if(n>=1e5)return '₹'+(n/1e5).toFixed(2)+' L';return '₹'+fmt(n)};
var fmtDT=function(iso){try{return new Date(iso).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return iso||''}};
var fmtSize=function(b){return b>=1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB'};
var sum=function(a,k){return a.reduce(function(s,x){return s+(x[k]||0)},0)};
var KINDS=['map','margin','grey'].map(function(k){var f=CONFIG.files[k];return {k:k,tag:f.tag,title:f.title,cols:Object.keys(f.fields).map(function(x){return f.fields[x].label}).join(' · ')}});
var kindOf=function(k){return KINDS.filter(function(K){return K.k===k})[0]||{tag:k,title:k}};
var EMPTY=function(){return {v:1,updatedAt:null,datasets:{map:null,margin:null,grey:null},history:[]}};
var state=EMPTY();
var M={users:[],grey:[],rep:null},V=M;   // M = full merge, V = merge after Greylabs sidebar filters
var ui={filters:{},gf:{},dFrom:'',dTo:'',sort:null,loaded:false,loadError:'',sheet:null,staged:{},authMsg:null,busy:false,saveErr:''};

/* ---------- Supabase ---------- */
var SB=CONFIG.supabase,sb=null;
var configured=!!(SB.url&&SB.key&&!/YOUR-/.test(SB.url+SB.key));
function client(){
  if(!sb&&configured&&window.supabase)sb=window.supabase.createClient(SB.url,SB.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return sb;
}
async function rpc(fn,args){
  var c=client();if(!c)throw Object.assign(new Error('Supabase is not set up'),{code:'config'});
  var r=await c.rpc(fn,args);
  if(r.error)throw Object.assign(new Error(r.error.message||'Request failed'),{code:r.error.code||''});
  return r.data;
}
var TOKEN_KEY='dpb_upload_token',memToken='';
function getToken(){try{return sessionStorage.getItem(TOKEN_KEY)||memToken}catch(e){return memToken}}
function setToken(t){memToken=t||'';try{if(t)sessionStorage.setItem(TOKEN_KEY,t);else sessionStorage.removeItem(TOKEN_KEY)}catch(e){}}
var NOT_SET='Supabase is not connected yet. Add your project URL and key in the CONFIGURATION block at the top of assets/script.js (see README).';

/* ---------- table columns ---------- */
var COLS=[
  {k:'gl',l:'GL'},{k:'tl',l:'TL'},{k:'id',l:'User ID'},{k:'name',l:'User'},
  {k:'uniq',l:'Unique clients',n:1,d:fmt},{k:'total',l:'Total clients',n:1,d:fmt},{k:'opts',l:'Options',n:1,d:fmt},
  {k:'hi',l:'Margin ≥ '+CH.marginCutoffShort,n:1,d:fmt},{k:'lo',l:'Margin < '+CH.marginCutoffShort,n:1,d:fmt},{k:'mSum',l:'Total margin ₹',n:1,d:fmt},
  {k:'tasks',l:'Voice tasks',n:1,d:fmt},{k:'hours',l:'Hours',n:1,d:fmt1},{k:'tph',l:'Tasks / hr',n:1,d:fmt1},{k:'q',l:'Quality %',n:1,d:fmt1},
  {k:'chk',l:'Client check'}
];
var COLMAP={};COLS.forEach(function(c){COLMAP[c.k]=c});
function fk(u,c){var v=u[c.k];if(v==null||v==='')return '–';return c.d?c.d(v):String(v)}
function passes(u,except){
  for(var k in ui.filters){if(k===except)continue;var s=ui.filters[k];if(s&&!s.has(fk(u,COLMAP[k])))return false}
  return true;
}
function inGrey(u){return u.gRows>0||!GF.some(function(x){return ui.gf[x.k]})}   // a Language/Task/Domain filter keeps only users with matching entries
function filtered(){return V.users.filter(function(u){return inGrey(u)&&passes(u,null)})}
function overallQ(us){var w=0,t=0;us.forEach(function(u){w+=u.qw;t+=u.qt});return t?w/t:null}
function qPill(q){if(q==null)return '<span class="q none">–</span>';var c=q>=CH.qualityGood?'good':q>=CH.qualityWarn?'warn':'bad',s=c==='good'?'✓':c==='warn'?'!':'✕';return '<span class="q '+c+'">'+s+' '+fmt1(q)+'</span>'}

/* ---------- Greylabs sidebar filters (date, language, task type, domain) ---------- */
var GF=[{k:'lang',l:'Language'},{k:'type',l:'Task type'},{k:'domain',l:'Domain'}];
var gval=function(r,k){return r[k]||'(blank)'};
function greyPass(r,except){
  if(ui.dFrom&&r.date<ui.dFrom)return false;
  if(ui.dTo&&r.date>ui.dTo)return false;
  for(var i=0;i<GF.length;i++){var k=GF[i].k;if(k!==except&&ui.gf[k]&&!ui.gf[k].has(gval(r,k)))return false}
  return true;
}
function greyActive(){return !!(ui.dFrom||ui.dTo||GF.some(function(g){return ui.gf[g.k]}))}
function computeView(){
  if(!greyActive())return M;
  var d=state.datasets;
  return merge({map:d.map,margin:d.margin,grey:d.grey?{rows:d.grey.rows.filter(function(r){return greyPass(r)})}:null});
}
function activeCount(){return Object.keys(ui.filters).length+GF.filter(function(g){return ui.gf[g.k]}).length+(ui.dFrom?1:0)+(ui.dTo?1:0)}
function clearAll(){ui.filters={};ui.gf={};ui.dFrom='';ui.dTo='';closePop();renderBody()}

function selLabel(set,total){return !set?'All'+(total?' ('+total+')':''):set.size===1?Array.from(set)[0]:set.size+' of '+total}
function renderSide(){
  var greyRows=state.datasets.grey?state.datasets.grey.rows:[];
  var dates=greyRows.map(function(r){return r.date}).sort(),mn=dates[0]||'',mx=dates[dates.length-1]||'';
  var btn=function(key,label,set,total){return '<button class="fsel'+(set?' on':'')+'" type="button" data-sf="'+key+'" aria-haspopup="dialog"><span class="fl">'+esc(label)+'</span><span class="fv">'+esc(selLabel(set,total))+'</span></button>'};
  var nOf=function(k){return uniq(M.users.map(function(u){return fk(u,COLMAP[k])})).length};
  var h='<div class="fgroup"><h3>Team</h3>'+btn('gl','GL',ui.filters.gl,nOf('gl'))+btn('tl','TL',ui.filters.tl,nOf('tl'))+btn('name','User',ui.filters.name,nOf('name'))+'</div>';
  h+='<div class="fgroup"><h3>Greylabs</h3>'+
    '<label class="fdate">From<input type="date" id="dfrom" value="'+esc(ui.dFrom)+'" min="'+mn+'" max="'+mx+'" class="'+(ui.dFrom?'on':'')+'"'+(mn?'':' disabled')+'></label>'+
    '<label class="fdate">To<input type="date" id="dto" value="'+esc(ui.dTo)+'" min="'+mn+'" max="'+mx+'" class="'+(ui.dTo?'on':'')+'"'+(mn?'':' disabled')+'></label>'+
    GF.map(function(g){return btn('g:'+g.k,g.l,ui.gf[g.k],uniq(greyRows.map(function(r){return gval(r,g.k)})).length)}).join('')+'</div>';
  h+='<div class="fgroup"><h3>Margin</h3>'+btn('chk','Client check',ui.filters.chk,nOf('chk'))+'</div>';
  h+='<p class="hint">Every table column also has its own filter (funnel icon).</p>';
  var keep=document.activeElement&&document.activeElement.id;
  $('#fbody').innerHTML=h;
  if(keep==='dfrom'||keep==='dto'){var el=$('#'+keep);if(el)el.focus()}
  var n=activeCount();$('#fcount').hidden=!n;$('#fcount').textContent=n;$('#freset').hidden=!n;
}
$('#fbody').addEventListener('click',function(e){var b=e.target.closest('[data-sf]');if(b)openPop(b.getAttribute('data-sf'),b,false)});
$('#fbody').addEventListener('change',function(e){
  var t=e.target;if(t.id!=='dfrom'&&t.id!=='dto')return;
  if(t.id==='dfrom')ui.dFrom=t.value;else ui.dTo=t.value;
  if(ui.dFrom&&ui.dTo&&ui.dFrom>ui.dTo){var x=ui.dFrom;ui.dFrom=ui.dTo;ui.dTo=x}
  renderBody();
});
$('#freset').addEventListener('click',clearAll);
$('#ftoggle').addEventListener('click',function(){var s=$('#fside'),o=!s.classList.contains('open');s.classList.toggle('open',o);this.setAttribute('aria-expanded',o);this.textContent=o?'Hide':'Show'});

/* ---------- header ---------- */
function renderTicker(){
  var h='';
  if(ui.loadError)h+='<span class="live err"><span class="dot"></span>'+(configured?'DATA UNAVAILABLE':'NOT CONNECTED')+'</span>';
  else if(!ui.loaded)h+='<span class="live"><span class="dot"></span>LOADING</span>';
  else if(!state.updatedAt)h+='<span class="live"><span class="dot"></span>NO DATA YET</span>';
  else h+='<span class="live ok"><span class="dot"></span>SAVED · '+esc(fmtDT(state.updatedAt))+'</span>';
  KINDS.forEach(function(K){var d=state.datasets[K.k];if(d&&d.file)h+='<span class="chip" title="'+esc(d.file.name)+'"><b>'+K.tag+'</b>'+esc(d.file.name)+' · '+fmt(d.rows.length)+' rows</span>'});
  $('#ticker').innerHTML=h;
}

/* ---------- KPIs ---------- */
function renderKPIs(us){
  var hi=sum(us,'hi'),lo=sum(us,'lo'),n=hi+lo,q=overallQ(us);
  var k=[['Users',fmt(us.length),'of '+fmt(M.users.length)+' total',''],['Unique clients',fmt(sum(us,'uniq')),'',''],['Total clients',fmt(sum(us,'total')),'',''],['Options',fmt(sum(us,'opts')),'',''],
    ['Clients ≥ '+CH.marginCutoffShort,fmt(hi),n?'▲ '+Math.round(hi/n*100)+'% of margin clients':'no margin data','up'],['Clients < '+CH.marginCutoffShort,fmt(lo),n?'▼ '+Math.round(lo/n*100)+'% of margin clients':'no margin data','down'],
    ['Total margin',inr(sum(us,'mSum')),n?'avg '+inr(sum(us,'mSum')/n)+' / client':'',''],['Voice tasks',fmt(sum(us,'tasks')),fmt(sum(us,'hours'))+' hours',''],['Avg quality',q==null?'–':fmt1(q)+'%','weighted by tasks','']];
  $('#kpis').innerHTML=k.map(function(x){return '<div class="kpi"><span class="l">'+esc(x[0])+'</span><span class="v '+x[3]+'">'+x[1]+'</span><span class="s">'+(x[2]||'&nbsp;')+'</span></div>'}).join('');
}

/* ---------- data overview table ---------- */
var FUNNEL='<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1 2h10L7.2 6.4V10.5L4.8 11.5V6.4z" fill="currentColor"/></svg>';
function sortedUsers(us){
  var s=ui.sort,c=s&&COLMAP[s.k];
  return us.slice().sort(function(a,b){
    if(!c)return a.gl.localeCompare(b.gl)||a.tl.localeCompare(b.tl)||a.name.localeCompare(b.name);
    var x=a[c.k],y=b[c.k];if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;
    return (c.n?(x-y):String(x).localeCompare(String(y),undefined,{numeric:true}))*s.d;
  });
}
function cell(u,c){
  var v=u[c.k];
  if(c.k==='q')return '<td class="num">'+qPill(v)+'</td>';
  if(c.k==='chk'){var cl=v==='Match'?'good':v==='No margin'?'none':'warn';return '<td><span class="q '+cl+'">'+(v==='Match'?'✓ ':'')+esc(v)+'</span></td>'}
  if(c.k==='hi')return '<td class="num up">'+fmt(v)+'</td>';
  if(c.k==='lo')return '<td class="num down">'+fmt(v)+'</td>';
  if(c.k==='id')return '<td class="idc mono">'+esc(v)+'</td>';
  if(c.n)return '<td class="num">'+(v==null?'–':c.d(v))+'</td>';
  return '<td>'+esc(v)+'</td>';
}
function renderTable(us){
  var rows=sortedUsers(us),s=ui.sort;
  var h='<thead><tr>'+COLS.map(function(c){
    var on=s&&s.k===c.k,fon=!!ui.filters[c.k];
    return '<th class="'+(c.n?'num':'')+'"'+(on?' aria-sort="'+(s.d>0?'ascending':'descending')+'"':'')+'><div class="th"><button class="hl" type="button" data-sort="'+c.k+'">'+esc(c.l)+(on?(s.d>0?' ▲':' ▼'):'')+'</button>'+
      '<button class="fb'+(fon?' on':'')+'" type="button" data-filter="'+c.k+'" aria-label="Filter '+esc(c.l)+(fon?' (filter active)':'')+'" aria-haspopup="dialog">'+FUNNEL+'</button></div></th>'}).join('')+'</tr></thead>';
  var b='<tbody>'+rows.map(function(u){return '<tr>'+COLS.map(function(c){return cell(u,c)}).join('')+'</tr>'}).join('')+'</tbody>';
  var th=sum(us,'hours'),tt=sum(us,'tasks');
  var f='<tfoot><tr><td>Total</td><td></td><td></td><td class="mono">'+fmt(us.length)+' users</td><td class="num">'+fmt(sum(us,'uniq'))+'</td><td class="num">'+fmt(sum(us,'total'))+'</td><td class="num">'+fmt(sum(us,'opts'))+'</td><td class="num up">'+fmt(sum(us,'hi'))+'</td><td class="num down">'+fmt(sum(us,'lo'))+'</td><td class="num">'+fmt(sum(us,'mSum'))+'</td><td class="num">'+fmt(tt)+'</td><td class="num">'+fmt1(th)+'</td><td class="num">'+(th>0?fmt1(tt/th):'–')+'</td><td class="num">'+qPill(overallQ(us))+'</td><td></td></tr></tfoot>';
  var emptyMsg=M.users.length?'No users match these filters.':ui.loadError?esc(ui.loadError):ui.loaded?'No data yet. Use Upload data to add the three files.':'Loading…';
  $('#tbl').innerHTML=h+(rows.length?b+f:'<tbody><tr><td colspan="'+COLS.length+'" class="empty">'+emptyMsg+'</td></tr></tbody>');
  var nf=activeCount();
  $('#clearall').hidden=!nf;
  $('#ov-sub').textContent=M.users.length?fmt(us.length)+' of '+fmt(M.users.length)+' users · '+(nf?nf+' filter'+(nf>1?'s':'')+' active':'filter any column with its funnel'):'';
}

/* ---------- Excel-style filter popup (used by table headers and the sidebar) ---------- */
var pop={k:null,sel:null,opts:[],q:''};
function popOptions(k){
  var cnt={},raw={};
  if(k.indexOf('g:')===0){
    var gk=k.slice(2),rows=state.datasets.grey?state.datasets.grey.rows:[];
    rows.forEach(function(r){if(!greyPass(r,gk))return;var v=gval(r,gk);cnt[v]=(cnt[v]||0)+1});
    return Object.keys(cnt).sort().map(function(x){return {key:x,count:cnt[x]}});
  }
  var c=COLMAP[k];
  V.users.forEach(function(u){if(!inGrey(u)||!passes(u,k))return;var key=fk(u,c);cnt[key]=(cnt[key]||0)+1;if(raw[key]===undefined)raw[key]=u[k]});
  var keys=Object.keys(cnt);
  keys.sort(function(a,b){if(c.n){var x=raw[a],y=raw[b];if(x==null)return 1;if(y==null)return -1;return x-y}return a.localeCompare(b,undefined,{numeric:true})});
  return keys.map(function(x){return {key:x,count:cnt[x]}});
}
var getSel=function(k){return k.indexOf('g:')===0?ui.gf[k.slice(2)]:ui.filters[k]};
function setSel(k,s){var g=k.indexOf('g:')===0,o=g?ui.gf:ui.filters,kk=g?k.slice(2):k;if(s)o[kk]=s;else delete o[kk]}
function popLabel(k){return k.indexOf('g:')===0?GF.filter(function(g){return 'g:'+g.k===k})[0].l:COLMAP[k].l}
function openPop(k,btn,fromTable){
  if(pop.k===k&&!$('#fpop').hidden){closePop();return}
  pop.k=k;pop.q='';pop.opts=popOptions(k);pop.btn=btn;
  var cur=getSel(k);pop.sel=cur?new Set(cur):new Set(pop.opts.map(function(o){return o.key}));
  var el=$('#fpop'),tw=$('#tw');pop.sx=tw.scrollLeft;pop.sy=tw.scrollTop;el.hidden=false;
  el.innerHTML=(fromTable?'<div class="srt"><button type="button" data-a="asc">Sort A → Z (smallest first)</button><button type="button" data-a="desc">Sort Z → A (largest first)</button></div>':'<h3>'+esc(popLabel(k))+'</h3>')+
    '<input type="text" id="fsearch" placeholder="Search" aria-label="Search values" autocomplete="off">'+
    '<div class="flist" id="flist"></div><div class="ffoot"><button class="linkbtn" type="button" data-a="clear">Clear filter</button><button class="btn sm" type="button" data-a="done">Done</button></div>';
  el.setAttribute('aria-label','Filter '+popLabel(k));
  fillPop();
  var r=btn.getBoundingClientRect(),w=248,left=fromTable?r.left:r.right+6;
  if(left+w>window.innerWidth-8)left=Math.max(8,Math.min(r.left,window.innerWidth-w-8));
  var top=fromTable||left<r.right?r.bottom+4:r.top;
  top=Math.max(8,Math.min(top,window.innerHeight-232));
  el.style.left=left+'px';el.style.top=top+'px';el.style.maxHeight=Math.max(220,window.innerHeight-top-12)+'px';
  var s=$('#fsearch');if(s)s.focus();
}
function visOpts(){var q=pop.q.toLowerCase();return pop.opts.filter(function(o){return !q||o.key.toLowerCase().indexOf(q)>-1})}
function fillPop(){
  var vis=visOpts(),allOn=vis.length>0&&vis.every(function(o){return pop.sel.has(o.key)});
  var h='<label class="fi"><input type="checkbox" id="fall" '+(allOn?'checked':'')+'><span class="t">(Select all'+(pop.q?' results':'')+')</span></label>';
  h+=vis.slice(0,300).map(function(o){return '<label class="fi"><input type="checkbox" data-v="'+esc(o.key)+'" '+(pop.sel.has(o.key)?'checked':'')+'><span class="t">'+esc(o.key)+'</span><span class="c">'+o.count+'</span></label>'}).join('');
  if(vis.length>300)h+='<p class="hint" style="padding:6px">Showing 300 of '+vis.length+'. Type in Search to narrow the list.</p>';
  if(!vis.length)h+='<p class="hint" style="padding:6px">No matching values.</p>';
  $('#flist').innerHTML=h;
}
function applyPop(){
  var all=pop.opts.length&&pop.opts.every(function(o){return pop.sel.has(o.key)});
  setSel(pop.k,all?null:new Set(pop.sel));
  renderBody();
}
function closePop(){$('#fpop').hidden=true;pop.k=null}
$('#fpop').addEventListener('input',function(e){if(e.target.id==='fsearch'){pop.q=e.target.value;fillPop()}});
$('#fpop').addEventListener('change',function(e){
  var t=e.target;
  if(t.id==='fall'){visOpts().forEach(function(o){if(t.checked)pop.sel.add(o.key);else pop.sel.delete(o.key)});fillPop();applyPop()}
  else if(t.hasAttribute('data-v')){
    var v=t.getAttribute('data-v');if(t.checked)pop.sel.add(v);else pop.sel.delete(v);
    var vis=visOpts();$('#fall').checked=vis.length>0&&vis.every(function(o){return pop.sel.has(o.key)});applyPop();
  }
});
$('#fpop').addEventListener('click',function(e){
  var a=e.target.getAttribute&&e.target.getAttribute('data-a');if(!a)return;
  if(a==='asc'||a==='desc'){ui.sort={k:pop.k,d:a==='asc'?1:-1};renderBody();closePop()}
  else if(a==='clear'){setSel(pop.k,null);renderBody();closePop()}
  else closePop();
});
document.addEventListener('mousedown',function(e){if(!$('#fpop').hidden&&!e.target.closest('#fpop')&&!e.target.closest('[data-filter],[data-sf]'))closePop()});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(!$('#fpop').hidden)closePop();else if(ui.sheet)closeSheet()}});
$('#tw').addEventListener('scroll',function(){var w=$('#tw');if(!$('#fpop').hidden&&(Math.abs(w.scrollLeft-pop.sx)>2||Math.abs(w.scrollTop-pop.sy)>2))closePop()});
window.addEventListener('resize',closePop);
$('#tbl').addEventListener('click',function(e){
  var f=e.target.closest('[data-filter]');if(f){openPop(f.getAttribute('data-filter'),f,true);return}
  var s=e.target.closest('[data-sort]');if(s){var k=s.getAttribute('data-sort');ui.sort=ui.sort&&ui.sort.k===k?{k:k,d:-ui.sort.d}:{k:k,d:1};renderBody()}
});
$('#clearall').addEventListener('click',clearAll);

/* ---------- tooltip ---------- */
var tip=$('#tip');
function showTip(html,e){
  tip.innerHTML=html;tip.hidden=false;
  var w=tip.offsetWidth,h=tip.offsetHeight,x=e.clientX+14,y=e.clientY+14;
  if(x+w>window.innerWidth-8)x=e.clientX-w-14;if(x<8)x=8;
  if(y+h>window.innerHeight-8)y=e.clientY-h-14;if(y<8)y=8;
  tip.style.left=x+'px';tip.style.top=y+'px';
}
function hideTip(){tip.hidden=true}

/* ---------- donuts ---------- */
function donut(host,parts,label){
  var tot=parts.reduce(function(s,p){return s+p.v},0),R=56,C=2*Math.PI*R,off=0;
  var svg='<svg class="donut" viewBox="0 0 160 160" role="img" aria-label="'+esc(label)+'"><circle cx="80" cy="80" r="'+R+'" fill="none" stroke="var(--line)" stroke-width="20"/>';
  if(tot>0)parts.forEach(function(p,i){
    var len=p.v/tot*C,gap=Math.min(2.5,len*0.5);
    if(p.v>0)svg+='<circle data-i="'+i+'" cx="80" cy="80" r="'+R+'" fill="none" stroke="'+p.c+'" stroke-width="20" stroke-dasharray="'+(len-gap).toFixed(2)+' '+(C-len+gap).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 80 80)"/>';
    off+=len;
  });
  svg+='<text x="80" y="78" text-anchor="middle" font-family="var(--fm)" font-size="22" font-weight="500" fill="var(--ink)">'+(tot>0?fmt(tot):'–')+'</text><text x="80" y="96" text-anchor="middle" font-family="var(--fd)" font-size="9.5" letter-spacing="1" fill="var(--muted)">'+esc(label.toUpperCase())+'</text></svg>';
  var lg='<div class="legend">'+parts.map(function(p){return '<div class="li"><span class="sw" style="background:'+p.c+'"></span><span class="nm">'+esc(p.g?p.g+' ':'')+esc(p.n)+'</span><span class="vl">'+fmt(p.v)+' · '+(tot?Math.round(p.v/tot*100):0)+'%</span></div>'}).join('')+'</div>';
  host.innerHTML=tot>0?svg+lg:'<p class="empty">No data for this view.</p>';
  host.onpointermove=function(e){var c=e.target.closest&&e.target.closest('circle[data-i]');if(!c){hideTip();return}var p=parts[+c.getAttribute('data-i')];showTip('<b>'+esc(p.n)+'</b><br><span class="m">'+fmt(p.v)+'</span> · '+Math.round(p.v/tot*100)+'%',e)};
  host.onpointerleave=hideTip;
}
function idSet(us){var o={};us.forEach(function(u){o[u.id]=1});return o}
function renderDonuts(us){
  donut($('#d1'),[{n:'Margin ≥ '+CH.marginCutoffShort,g:'▲',v:sum(us,'hi'),c:'var(--up)'},{n:'Margin < '+CH.marginCutoffShort,g:'▼',v:sum(us,'lo'),c:'var(--down)'}],'clients');
  var ids=idSet(us),by={};
  V.grey.forEach(function(r){if(ids[r.uid])by[r.type]=(by[r.type]||0)+r.tasks});
  var types=Object.keys(by).sort(),cols=CH.seriesColors;
  var parts=types.slice(0,cols.length).map(function(t,i){return {n:t,v:by[t],c:cols[i]}});
  if(types.length>cols.length)parts.push({n:'Other',v:types.slice(cols.length).reduce(function(s,t){return s+by[t]},0),c:'var(--muted)'});
  donut($('#d2'),parts,'tasks');
}

/* ---------- margin comparison bars ---------- */
var mgroups=[];
function renderMargin(us){
  var mode=CH.marginGroupBy;
  if(mode==='auto')mode=uniq(us.map(function(u){return u.tl})).length===1&&us.length>1?'user':'tl';
  var groups={};
  us.forEach(function(u){
    var key=mode==='user'?u.id:mode==='gl'?u.gl:u.tl,g=groups[key];
    if(!g)g=groups[key]={label:mode==='user'?u.name:key,sub:mode==='user'?u.id+' · '+u.tl:mode==='gl'?'GL':u.gl,hi:0,lo:0,mSum:0};
    g.hi+=u.hi;g.lo+=u.lo;g.mSum+=u.mSum;
  });
  mgroups=Object.keys(groups).map(function(k){return groups[k]}).sort(function(a,b){return (b.hi+b.lo)-(a.hi+a.lo)||b.hi-a.hi});
  $('#c1-sub').textContent='Client count per '+(mode==='user'?'user':mode.toUpperCase());
  var max=Math.max.apply(null,mgroups.map(function(g){return g.hi+g.lo}).concat([1]));
  var el=$('#mrows');
  if(!mgroups.length||!sum(mgroups,'hi')&&!sum(mgroups,'lo')){el.innerHTML='<p class="empty">No margin data for this view.</p>';return}
  el.innerHTML=mgroups.map(function(g,i){
    return '<div class="row" data-i="'+i+'" tabindex="0" aria-label="'+esc(g.label)+': '+g.hi+' clients at '+CH.marginCutoffShort+' and above, '+g.lo+' below"><div class="lab"><b>'+esc(g.label)+'</b><span>'+esc(g.sub)+'</span></div>'+
      '<div class="bar"><i class="hi" style="width:'+(g.hi/max*100)+'%"></i><i class="lo" style="width:'+(g.lo/max*100)+'%"></i></div>'+
      '<div class="val"><span class="up">▲ '+g.hi+'</span> · <span class="down">▼ '+g.lo+'</span></div></div>';
  }).join('');
}
function marginTip(i){
  var g=mgroups[i];if(!g)return '';var t=g.hi+g.lo;
  return '<b>'+esc(g.label)+'</b><br><span class="m">'+g.hi+'</span> clients at '+CH.marginCutoffShort+' and above ('+(t?Math.round(g.hi/t*100):0)+'%)<br><span class="m">'+g.lo+'</span> clients below '+CH.marginCutoffShort+'<br>Total margin <span class="m">'+inr(g.mSum)+'</span>';
}
var mr=$('#mrows');
mr.addEventListener('pointermove',function(e){var r=e.target.closest('.row');if(!r){hideTip();return}showTip(marginTip(+r.getAttribute('data-i')),e)});
mr.addEventListener('pointerleave',hideTip);
mr.addEventListener('focusin',function(e){var r=e.target.closest('.row');if(!r)return;var b=r.getBoundingClientRect();showTip(marginTip(+r.getAttribute('data-i')),{clientX:b.left+b.width/2,clientY:b.top})});
mr.addEventListener('focusout',hideTip);

/* ---------- daily voice tasks ---------- */
function niceMax(v){if(v<=0)return 4;var e=Math.pow(10,Math.floor(Math.log10(v))),f=v/e;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*e}
function renderLine(us){
  var ids=idSet(us),rows=V.grey.filter(function(r){return ids[r.uid]});
  var host=$('#line'),leg=$('#lleg');
  if(!rows.length){leg.innerHTML='';host.innerHTML='<p class="empty">No Greylabs entries for this view.</p>';return}
  var types=[],dset={},val={};
  rows.forEach(function(r){if(types.indexOf(r.type)<0)types.push(r.type);dset[r.date]=1;var k=r.type+'|'+r.date;val[k]=(val[k]||0)+r.tasks});
  var cols=CH.seriesColors;types.sort();types=types.slice(0,cols.length);
  var dates=Object.keys(dset).sort(),n=dates.length;
  var series=types.map(function(t,i){return {name:t,color:cols[i],v:dates.map(function(d){return val[t+'|'+d]||0})}});
  leg.innerHTML=series.map(function(s){return '<span><i style="background:'+s.color+'"></i>'+esc(s.name)+'</span>'}).join('');
  var W=Math.max(host.clientWidth,260),H=CH.lineHeight,L=42,R=14,T=10,B=28,pw=W-L-R,ph=H-T-B;
  var ymax=niceMax(Math.max.apply(null,series.map(function(s){return Math.max.apply(null,s.v)})));
  var X=function(i){return n===1?L+pw/2:L+i*pw/(n-1)},Y=function(v){return T+ph-v/ymax*ph};
  var out='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Voice tasks per day by task type">';
  for(var g=0;g<=4;g++){var yv=ymax/4*g,yy=Y(yv);
    out+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)" stroke-width="1"/><text x="'+(L-8)+'" y="'+(yy+4)+'" text-anchor="end" font-size="11" font-family="var(--fm)" fill="var(--muted)">'+fmt(yv)+'</text>'}
  var step=Math.max(1,Math.ceil(n/Math.max(1,Math.floor(pw/62))));
  dates.forEach(function(d,i){if(i%step===0)out+='<text x="'+X(i)+'" y="'+(H-8)+'" text-anchor="middle" font-size="11" font-family="var(--fm)" fill="var(--muted)">'+shortDate(d)+'</text>'});
  series.forEach(function(s){
    out+='<polyline fill="none" stroke="'+s.color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="'+s.v.map(function(v,i){return X(i).toFixed(1)+','+Y(v).toFixed(1)}).join(' ')+'"/>';
    out+='<circle cx="'+X(n-1)+'" cy="'+Y(s.v[n-1])+'" r="4" fill="'+s.color+'" stroke="var(--panel)" stroke-width="2"/>';
  });
  out+='<g class="cross" style="display:none"><line class="cl" y1="'+T+'" y2="'+(T+ph)+'" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>'+
    series.map(function(s,i){return '<circle class="cd'+i+'" r="4" fill="'+s.color+'" stroke="var(--panel)" stroke-width="2"/>'}).join('')+'</g>';
  out+='<rect class="hit" x="'+L+'" y="'+T+'" width="'+pw+'" height="'+ph+'" fill="transparent"/></svg>';
  host.innerHTML=out;
  var hit=host.querySelector('.hit'),cross=host.querySelector('.cross'),svg=host.querySelector('svg');
  function move(e){
    var r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*(W/r.width);
    var i=n===1?0:Math.round((px-L)/pw*(n-1));i=Math.max(0,Math.min(n-1,i));
    cross.style.display='';
    var cl=host.querySelector('.cl');cl.setAttribute('x1',X(i));cl.setAttribute('x2',X(i));
    series.forEach(function(s,j){var c=host.querySelector('.cd'+j);c.setAttribute('cx',X(i));c.setAttribute('cy',Y(s.v[i]))});
    var total=series.reduce(function(a,s){return a+s.v[i]},0);
    showTip('<b>'+shortDate(dates[i])+'</b><br>'+series.map(function(s){return '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:'+s.color+';margin-right:6px"></span>'+esc(s.name)+' <span class="m">'+fmt(s.v[i])+'</span>'}).join('<br>')+'<br>Total <span class="m">'+fmt(total)+'</span>',e);
  }
  hit.addEventListener('pointermove',move);hit.addEventListener('pointerdown',move);
  hit.addEventListener('pointerleave',function(){cross.style.display='none';hideTip()});
}

/* ---------- merge check + validation targets ---------- */
function targetCheck(m){
  var E=CONFIG.expected;if(!E||!m.users.length)return null;
  var a={users:m.users.length,gls:uniq(m.users.map(function(u){return u.gl})).length,tls:uniq(m.users.map(function(u){return u.tl})).length,
    clients:m.rep.matMargin,greyRows:m.rep.matGrey,from:m.rep.dates[0]||'–',to:m.rep.dates[m.rep.dates.length-1]||'–'};
  var lab={users:'users',gls:'GLs',tls:'TLs',clients:'clients',greyRows:'Greylabs entries'},bad=[],ok=[];
  Object.keys(lab).forEach(function(k){if(E[k]==null)return;(a[k]===E[k]?ok:bad).push(a[k]===E[k]?fmt(a[k])+' '+lab[k]:lab[k]+' '+fmt(a[k])+' (expected '+fmt(E[k])+')')});
  if(E.from&&E.to){var dOk=a.from===E.from&&a.to===E.to,dt=(a.from==='–'?'no dates':shortDate(a.from)+' to '+shortDate(a.to));(dOk?ok:bad).push(dOk?dt:'dates '+dt+' (expected '+shortDate(E.from)+' to '+shortDate(E.to)+')')}
  return {ok:!bad.length,text:bad.length?bad.join(' · '):ok.join(' · ')};
}
function healthItems(m){
  var rep=m.rep;if(!rep)return [];
  var o=[],it=function(ok,t,d){o.push({ok:ok,t:t,d:d})};
  if(rep.missing.length)it(false,'Missing file'+(rep.missing.length>1?'s':''),rep.missing.map(function(k){return kindOf(k).title}).join(', '));
  it(!rep.dupMap,'Mapping · '+fmt(m.users.length)+' users',rep.dupMap?rep.dupMap+' repeated User ID row(s) merged into one':'One row per User ID');
  it(!rep.unmMargin&&!rep.dupMargin,'Margin · '+fmt(rep.matMargin)+' of '+fmt(rep.rowsMargin)+' rows used',
    [rep.dupMargin?rep.dupMargin+' duplicate client row(s) removed':'',rep.unmMargin?rep.unmMargin+' with no matching user left out'+(rep.exMargin.length?' ('+rep.exMargin.join(', ')+')':''):'',rep.noClient?'No Client ID column, so duplicates cannot be detected':''].filter(Boolean).join('. ')||'Each client counted once');
  it(!rep.unmGrey&&!rep.dupGrey,'Greylabs · '+fmt(rep.matGrey)+' of '+fmt(rep.rowsGrey)+' rows used',
    [rep.dupGrey?rep.dupGrey+' duplicate row(s) removed':'',rep.unmGrey?rep.unmGrey+' with no matching user left out'+(rep.exGrey.length?' ('+rep.exGrey.join(', ')+')':''):''].filter(Boolean).join('. ')||'No repeated entries');
  it(!rep.diff&&!rep.noMargin,'Client counts',rep.okChk+' of '+fmt(m.users.length)+' users: margin clients equal Unique Clients'+(rep.diff?'. '+rep.diff+' differ':'')+(rep.noMargin?'. '+rep.noMargin+' have no margin rows':''));
  var t=targetCheck(m);if(t)it(t.ok,'Validation targets',t.text);
  return o;
}
function renderHealth(){
  var h=healthItems(M);
  $('#health').innerHTML=h.length&&M.users.length+M.rep.rowsMargin+M.rep.rowsGrey?h.map(function(x){return '<div class="it"><span class="ic '+(x.ok?'up':'warn')+'">'+(x.ok?'✓':'!')+'</span><div><div class="tt">'+esc(x.t)+'</div><div class="dd">'+esc(x.d)+'</div></div></div>'}).join(''):'<p class="empty">Nothing merged yet.</p>';
}

function renderBody(){
  V=computeView();
  var us=filtered();
  renderSide();renderKPIs(us);renderTable(us);renderDonuts(us);renderMargin(us);renderLine(us);
}
function rebuild(){
  M=merge(state.datasets);
  // drop filter values that no longer exist after new data arrives
  Object.keys(ui.filters).forEach(function(k){var have={};M.users.forEach(function(u){have[fk(u,COLMAP[k])]=1});var s=new Set(Array.from(ui.filters[k]).filter(function(v){return have[v]}));if(s.size)ui.filters[k]=s;else delete ui.filters[k]});
  renderTicker();renderHealth();renderBody();if(ui.sheet==='upload')renderSheet();
}

/* ---------- toast ---------- */
var toastT=null;
function toast(msg,bad){var t=$('#toast');t.textContent=msg;t.className=bad?'bad':'';t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},bad?9000:4500)}

/* ---------- load shared data ---------- */
function setState(s){
  s=s||{};var d=s.datasets||{};
  state={v:1,updatedAt:s.updatedAt||null,datasets:{map:d.map||null,margin:d.margin||null,grey:d.grey||null},history:s.history||[]};
}
var lastStamp=null;
async function load(silent){
  if(!configured){ui.loaded=true;ui.loadError=NOT_SET;rebuild();return}
  try{
    var c=client();if(!c)throw new Error('the Supabase library did not load');
    var r=await c.from('dashboard_state').select('data,updated_at').eq('id',1).maybeSingle();
    if(r.error)throw new Error(r.error.message);
    if(!r.data)throw new Error('the dashboard table is empty. Run supabase/setup.sql');
    lastStamp=r.data.updated_at;setState(r.data.data);ui.loaded=true;ui.loadError='';
  }catch(e){ui.loaded=true;if(silent&&state.updatedAt)return;ui.loadError='Could not load the shared data ('+(e&&e.message?e.message:'network error')+').'}
  rebuild();
  if(ui.loadError&&!silent)toast(ui.loadError,true);
}
async function poll(){
  if(!configured||document.hidden||ui.busy)return;
  try{
    var r=await client().from('dashboard_state').select('updated_at').eq('id',1).maybeSingle();
    if(!r.error&&r.data&&r.data.updated_at!==lastStamp){await load(true);toast('New data was uploaded. The dashboard has been updated.')}
  }catch(e){}
}

/* ---------- upload: password once per browser session, then the upload sheet ---------- */
function closeSheet(){ui.sheet=null;$('#sheet').hidden=true;$('#fab').focus()}
function showSheet(v){ui.sheet=v;$('#sheet').hidden=false;renderSheet();var p=$('#u-pass');if(p)p.focus()}
async function openUpload(){
  if(ui.sheet){closeSheet();return}
  ui.authMsg=null;
  if(!configured){ui.authMsg={t:'bad',m:NOT_SET};showSheet('auth');return}
  var t=getToken();
  if(t){
    try{if(await rpc('upload_check',{p_token:t})){showSheet('upload');return}setToken('')}
    catch(e){ui.authMsg={t:'bad',m:'Cannot reach Supabase. Check your connection and try again.'}}
  }
  showSheet('auth');
}
async function doLogin(){
  var p=$('#u-pass').value;
  if(!p){ui.authMsg={t:'bad',m:'Enter the upload password.'};renderSheet();return}
  if(!configured){ui.authMsg={t:'bad',m:NOT_SET};renderSheet();return}
  ui.authMsg={t:'',m:'Checking…'};renderSheet();
  var r=null;
  try{r=await rpc('upload_login',{p_password:p})}catch(e){ui.authMsg={t:'bad',m:'Cannot reach Supabase ('+e.message+').'};renderSheet();return}
  if(r&&r.ok){setToken(r.token);ui.authMsg=null;showSheet('upload');return}
  var err=r&&r.error;
  ui.authMsg={t:'bad',m:err==='locked'?'Too many attempts. Try again in '+(r.retryIn||60)+' seconds.':
    err==='no_password'||err==='default_password'?'The upload password has not been set yet. Set it in Supabase (README, step 2).':'That password is not correct.'};
  renderSheet();var pw=$('#u-pass');if(pw)pw.focus();
}
async function doLogout(){var t=getToken();setToken('');try{if(t)await rpc('upload_logout',{p_token:t})}catch(e){}closeSheet();toast('Upload access locked for this session.')}
$('#fab').addEventListener('click',openUpload);

function slotHtml(K){
  var d=state.datasets[K.k],f=d&&d.file,st=ui.staged[K.k];
  var h='<div class="slot" data-k="'+K.k+'"><div class="slot-top"><span class="tag">'+K.tag+'</span><h3>'+esc(K.title)+'</h3></div><p class="cols">'+esc(K.cols)+'</p>';
  h+='<p class="cur">'+(f?'Current: <b>'+esc(f.name)+'</b> · '+fmt(d.rows.length)+' rows · '+esc(fmtDT(f.at)):'No file saved yet.')+'</p>';
  if(st)h+='<p class="stg '+(st.res.ok?'ok':'bad')+'">'+(st.res.ok?'✓ Ready to save: '+esc(st.file.name)+' · '+esc(st.res.msg):'✕ '+esc(st.file.name)+' · '+esc(st.res.error)+'. Expected: '+esc(K.cols)+'.')+'</p>';
  h+='<div class="acts"><label class="btn ghost sm filebtn" for="f-'+K.k+'">Choose .xlsx file<input type="file" id="f-'+K.k+'" data-k="'+K.k+'" accept=".xlsx,.xls,.csv" aria-label="Choose '+esc(K.title)+'"></label>';
  if(f&&f.orig)h+='<button class="linkbtn" type="button" data-dl="'+esc(f.orig)+'" data-name="'+esc(f.name)+'">Download saved original</button>';
  return h+'</div></div>';
}
function previewHtml(){
  var ready=Object.keys(ui.staged).filter(function(k){return ui.staged[k].res.ok});if(!ready.length)return '';
  var hyp={map:state.datasets.map,margin:state.datasets.margin,grey:state.datasets.grey};
  ready.forEach(function(k){hyp[k]={rows:ui.staged[k].res.data}});
  var m=merge(hyp),rep=m.rep,issue=rep.unmMargin||rep.unmGrey,dup=rep.dupMargin+rep.dupGrey+rep.dupMap,t=targetCheck(m);
  return '<div class="msg'+(issue||(t&&!t.ok)?'':' ok')+'"><b>After saving:</b> '+fmt(m.users.length)+' users · '+fmt(rep.matMargin)+' margin rows · '+fmt(rep.matGrey)+' Greylabs rows used'+
    (dup?' · '+dup+' duplicate(s) removed':'')+(issue?' · '+(rep.unmMargin+rep.unmGrey)+' row(s) match no user and will be left out':'')+
    (t?'<br>'+(t.ok?'✓ Matches validation targets':'! Differs from validation targets: '+esc(t.text)):'')+'</div>';
}
function renderSheet(){
  var el=$('#sheet');if(!ui.sheet){el.hidden=true;return}
  var h;
  if(ui.sheet==='auth'){
    h='<div class="sheet-h"><h2 id="sheet-t">Upload password</h2><button class="x" type="button" data-close aria-label="Close">✕</button></div>'+
      (ui.authMsg?'<div class="msg '+(ui.authMsg.t||'')+'" role="alert">'+esc(ui.authMsg.m)+'</div>':'')+
      '<form id="login" autocomplete="on"><div style="display:flex;flex-direction:column;gap:10px">'+
      '<input type="text" name="username" value="dashboard-upload" autocomplete="username" hidden>'+
      '<label class="hint" for="u-pass">Password</label><input type="password" id="u-pass" autocomplete="current-password" required>'+
      '<div class="sheet-f" style="position:static;padding:0"><button class="btn sm" type="submit">Unlock upload</button></div></div></form>'+
      '<p class="hint">Viewing needs no password. You enter it once per browser session, the first time you upload. It is checked by Supabase and never stored in this page.</p>';
  }else{
    var staged=Object.keys(ui.staged).filter(function(k){return ui.staged[k].res.ok}).length;
    h='<div class="sheet-h"><h2 id="sheet-t">Upload data</h2><button class="x" type="button" data-close aria-label="Close">✕</button></div>'+
      '<p class="hint">Upload unlocked · <button class="linkbtn" type="button" data-logout>Lock</button><br>Choose any of the three files. Each new file replaces the saved one for everyone; every original is kept.</p>'+
      KINDS.map(slotHtml).join('')+previewHtml()+(ui.saveErr?'<div class="msg bad">'+esc(ui.saveErr)+'</div>':'')+
      '<div class="sheet-f"><button class="btn ghost sm" type="button" data-close>Close</button><button class="btn sm" type="button" id="savebtn" '+(staged&&!ui.busy?'':'disabled')+'>'+(ui.busy?'Saving…':'Save to dashboard')+'</button></div>'+
      (state.history.length?'<details class="hist"><summary>Stored originals ('+state.history.length+')</summary><div class="tablewrap" style="max-height:200px"><table><tbody>'+state.history.slice().reverse().map(function(x){return '<tr><td><span class="tag">'+esc(kindOf(x.kind).tag)+'</span></td><td>'+esc(x.name)+'<br><span class="hint">'+esc(fmtSize(x.size))+' · '+esc(fmtDT(x.at))+'</span></td><td>'+(x.orig?'<button class="linkbtn" type="button" data-dl="'+esc(x.orig)+'" data-name="'+esc(x.name)+'">Download</button>':'')+'</td></tr>'}).join('')+'</tbody></table></div></details>':'');
  }
  el.innerHTML=h;
}
$('#sheet').addEventListener('click',function(e){
  var t=e.target;
  if(t.closest('[data-close]')){closeSheet();return}
  if(t.closest('[data-logout]')){doLogout();return}
  if(t.id==='savebtn'){saveStaged();return}
  var d=t.closest('[data-dl]');if(d)downloadOriginal(d.getAttribute('data-dl'),d.getAttribute('data-name'));
});
$('#sheet').addEventListener('submit',function(e){if(e.target.id==='login'){e.preventDefault();doLogin()}});
$('#sheet').addEventListener('change',function(e){var i=e.target;if(i.type==='file'&&i.files[0])stageFile(i.getAttribute('data-k'),i.files[0])});

async function stageFile(kind,file){
  ui.saveErr='';var res;
  if(file.size>CONFIG.maxFileMB*1048576)res={ok:false,error:'File is larger than '+CONFIG.maxFileMB+' MB. Remove unused sheets or rows and try again'};
  else if(typeof XLSX==='undefined')res={ok:false,error:'The spreadsheet reader did not load. Reload the page'};
  else try{
    var wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true}),sh=CONFIG.files[kind].sheet;
    var ws=wb.Sheets[typeof sh==='number'?wb.SheetNames[sh]:sh];
    if(!ws)res={ok:false,error:'Sheet "'+sh+'" was not found'};
    else res=parseFile(kind,XLSX.utils.sheet_to_json(ws,{defval:''}));
  }catch(e){res={ok:false,error:'Could not read this file. Save it as .xlsx and try again'}}
  ui.staged[kind]={file:file,res:res};renderSheet();
}
function toB64(file){return new Promise(function(ok,no){var fr=new FileReader();fr.onload=function(){ok(String(fr.result).split(',')[1]||'')};fr.onerror=function(){no(fr.error)};fr.readAsDataURL(file)})}
async function saveStaged(){
  var kinds=Object.keys(ui.staged).filter(function(k){return ui.staged[k].res.ok});
  if(!kinds.length||ui.busy)return;
  ui.busy=true;ui.saveErr='';renderSheet();
  try{
    var files=[];
    for(var i=0;i<kinds.length;i++){var k=kinds[i],st=ui.staged[k];files.push({kind:k,name:st.file.name,b64:await toB64(st.file),rows:st.res.data})}
    var s=await rpc('save_dashboard',{p_token:getToken(),p_files:files});
    ui.busy=false;setState(s);ui.staged={};
    try{var r=await client().from('dashboard_state').select('updated_at').eq('id',1).maybeSingle();if(r.data)lastStamp=r.data.updated_at}catch(e){}
    rebuild();closeSheet();toast('Saved. Everyone opening this link now sees the new data.');return;
  }catch(e){
    ui.busy=false;
    if(e.code==='PT401'){setToken('');ui.authMsg={t:'bad',m:'Your upload session has ended. Enter the password again; your selected files are still here.'};showSheet('auth');return}
    ui.saveErr=(e.code&&e.code.indexOf('PT')===0?e.message:'Saving failed ('+e.message+').')+' Nothing was changed; your files are still selected.';
  }
  renderSheet();
}
async function downloadOriginal(orig,name){
  try{
    var r=await rpc('get_original',{p_token:getToken(),p_id:+orig});
    var bin=atob(r.b64),u8=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
    var u=URL.createObjectURL(new Blob([u8],{type:'application/octet-stream'})),a=document.createElement('a');
    a.href=u;a.download=name||r.name||'original.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},4000);
  }catch(e){
    if(e.code==='PT401'){setToken('');ui.authMsg={t:'bad',m:'Enter the upload password to download original files.'};showSheet('auth');return}
    toast('Could not download the original file ('+e.message+').',true);
  }
}

/* ---------- boot ---------- */
$('#d1-sub').textContent='clients, '+CH.marginCutoffLong+' cut-off';
$('#mleg').innerHTML='<span class="up"><i style="background:var(--up)"></i>▲ Margin '+esc(CH.marginCutoffLong)+' and above</span><span class="down"><i style="background:var(--down)"></i>▼ Below '+esc(CH.marginCutoffLong)+'</span>';
var rz=null;
if(window.ResizeObserver)new ResizeObserver(function(){if(rz)cancelAnimationFrame(rz);rz=requestAnimationFrame(function(){if(M.users.length)renderLine(filtered())})}).observe($('#line'));
if(CONFIG.refreshSeconds>0)setInterval(poll,CONFIG.refreshSeconds*1000);
document.addEventListener('visibilitychange',function(){if(!document.hidden)poll()});
renderTicker();renderBody();load(false);
})();
