// Ludo Sultan social layer: profiles, friend requests, DMs, gifts, block/report, chat rooms with voice seats,
// clubs, recent players, and WebRTC signaling relay. Persistence: JSON file (DATA_FILE). Identity = device pid (no auth yet).
const fs=require('fs'),path=require('path');
const DATA_FILE=process.env.DATA_FILE||path.join(__dirname,'data','social.json');
const BAD=['fuck','shit','bitch','bastard','asshole','dick','cunt','slut','whore','madarchod','behenchod','bhenchod','chutiya','chutia','gandu','harami','kutta','kutti','randi','bhosdi','lund','gaand','mc','bc','kanjar','haramzada','kameena','sharmoota','kalb','ibn el','khara'];
const BADRE=new RegExp('(^|[^a-z])('+BAD.map(w=>w.replace(/ /g,'\\s*')).join('|')+')(?=[^a-z]|$)','gi');
function clean(t,max){t=String(t||'').replace(/[\u0000-\u001f]/g,' ').slice(0,max||200).trim();return t.replace(BADRE,(m,a,w)=>a+'*'.repeat(w.length))}
const ROOMDEFS=[['general','🌍 General',8],['pakistan','🇵🇰 Pakistan',8],['india','🇮🇳 India',8],['arabic','🌙 Arabic',8],['english','🇬🇧 English',8],['ludo-pro','👑 Ludo Pros',4]];
module.exports=function(ctx){const {clients,send,fids,fidOf}=ctx;
 let D={users:{},dms:{},reports:[],clubs:{}};try{D=Object.assign(D,JSON.parse(fs.readFileSync(DATA_FILE,'utf8')))}catch(e){}
 let wt=null;function persist(){if(wt)return;wt=setTimeout(()=>{wt=null;try{fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});fs.writeFileSync(DATA_FILE+'.tmp',JSON.stringify(D));fs.renameSync(DATA_FILE+'.tmp',DATA_FILE)}catch(e){console.error('persist',e.message)}},+process.env.PERSIST_MS||300)}
 function flush(){if(wt){clearTimeout(wt);wt=null}try{fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});fs.writeFileSync(DATA_FILE,JSON.stringify(D))}catch(e){}}
 // users keyed by fid (public 6-char id); pid kept privately for routing
 function U(fid){return D.users[fid]}
 function ensure(pid,c){const fid=c.fid;let u=D.users[fid];if(!u)u=D.users[fid]={fid,pid,name:c.name,avatar:c.avatar,level:1,wins:0,games:0,frame:'none',friends:[],reqIn:[],reqOut:[],blocked:[],recent:[],inbox:[],club:null,created:Date.now()};
  u.pid=pid;u.name=c.name;u.avatar=c.avatar;u.seen=Date.now();['friends','reqIn','reqOut','blocked','recent','inbox'].forEach(k=>{if(!Array.isArray(u[k]))u[k]=[]});return u}
 function online(fid){const u=U(fid);const c=u&&clients.get(u.pid);return !!(c&&c.ws&&c.ws.readyState===1)}
 function toFid(fid,m){const u=U(fid);const c=u&&clients.get(u.pid);if(c&&c.ws)send(c.ws,m);return !!(c&&c.ws&&c.ws.readyState===1)}
 function setHw(u,h){u.hw={pts:Math.max(0,Math.min(1e7,h.pts|0)),games:Math.max(0,Math.min(1e5,h.games|0)),wins:Math.max(0,Math.min(1e5,h.wins|0))}}
function pub(u,viewer){if(!u)return null;const cl=u.club&&D.clubs[u.club];return {fid:u.fid,name:u.name,avatar:u.avatar,level:u.level,wins:u.wins,games:u.games,caps:u.caps,best:u.best,cc:u.cc||'',frame:u.frame,online:online(u.fid),club:cl?{id:cl.id,name:cl.name,badge:cl.badge}:null,
  friend:viewer?viewer.friends.includes(u.fid):false,pending:viewer?viewer.reqOut.includes(u.fid):false,incoming:viewer?viewer.reqIn.includes(u.fid):false,blocked:viewer?viewer.blocked.includes(u.fid):false}}
 function blockedEither(a,b){return (a.blocked||[]).includes(b.fid)||(b.blocked||[]).includes(a.fid)}
 function social(u){return {t:'social',me:pub(u),friends:u.friends.map(f=>pub(U(f),u)).filter(Boolean),reqIn:u.reqIn.map(f=>pub(U(f),u)).filter(Boolean),reqOut:u.reqOut.slice(),blocked:u.blocked.map(f=>pub(U(f),u)).filter(Boolean),
  recent:u.recent.map(r=>Object.assign({t:r.t},pub(U(r.fid),u))).filter(x=>x.fid),unread:Object.fromEntries(u.friends.map(f=>[f,((D.dms[dk(u.fid,f)]||[]).filter(x=>x.to===u.fid&&!x.read)).length]))}}
 function dk(a,b){return a<b?a+':'+b:b+':'+a}
 function pushSocial(fid){const u=U(fid);if(u)toFid(fid,social(u))}
 // ---------- chat rooms ----------
 const CR=new Map();ROOMDEFS.forEach(([id,name,n])=>CR.set(id,{id,name,members:new Set(),seats:Array.from({length:n},()=>({fid:null,locked:false,mic:false})),host:null,chat:[]}));
 function crInfo(r){return {t:'croom',id:r.id,name:r.name,host:r.host,members:[...r.members].map(f=>pub(U(f))).filter(Boolean),seats:r.seats.map(s=>({fid:s.fid,locked:s.locked,mic:s.mic})),chat:r.chat.slice(-30)}}
 function crBc(r,m){r.members.forEach(f=>toFid(f,m))}
 function crLeave(fid){CR.forEach(r=>{if(!r.members.has(fid))return;r.members.delete(fid);r.seats.forEach(s=>{if(s.fid===fid){s.fid=null;s.mic=false}});if(r.host===fid)r.host=[...r.members][0]||null;crBc(r,crInfo(r))})}
 function roomOf(fid){for(const r of CR.values())if(r.members.has(fid))return r;return null}
 function addRecent(a,b){const ua=U(a);if(!ua||a===b)return;ua.recent=[{fid:b,t:Date.now()}].concat(ua.recent.filter(x=>x.fid!==b)).slice(0,20)}
 // voice peer check: both in the same started/pending match room, or both seated in the same chat room
 function sameVoice(a,b){const ua=U(a),ub=U(b);if(!ua||!ub)return false;const ca=clients.get(ua.pid),cb=clients.get(ub.pid);
  if(ca&&cb&&ca.room&&ca.room===cb.room)return true;const r=roomOf(a);return !!(r&&r.members.has(b)&&r.seats.some(s=>s.fid===a)&&r.seats.some(s=>s.fid===b))}
 const lastMsg=new Map();function rate(fid,ms,ch){const k=fid+(ch||'');const t=Date.now(),l=lastMsg.get(k)||0;if(t-l<ms)return false;lastMsg.set(k,t);return true}
 return {clean,D,flush,CR,
  onHello(pid,c,m){const u=ensure(pid,c);if(m.prof){const p=m.prof;u.level=Math.max(1,Math.min(999,p.level|0||1));u.wins=Math.max(0,p.wins|0);u.games=Math.max(0,p.games|0);u.frame=String(p.frame||'none').slice(0,16)}
   persist();send(c.ws,social(u));if(u.inbox.length){u.inbox.forEach(g=>send(c.ws,g));u.inbox=[];persist()}
   u.friends.forEach(f=>pushSocial(f))},
  onClose(pid,c){if(c&&c.fid){crLeave(c.fid);const u=U(c.fid);if(u)u.friends.forEach(f=>pushSocial(f))}},
  onGameStart(r){const fs_=r.seats.filter(s=>s.pid).map(s=>fidOf(s.pid));fs_.forEach(a=>fs_.forEach(b=>addRecent(a,b)));persist()},
  matchChat(c,text){return clean(text,120)},
  handle(m,pid,c,ws){const me=c.fid,u=ensure(pid,c);const tf=String(m.fid||m.to||'').toUpperCase().slice(0,6),tu=U(tf);
   switch(m.t){
    case 'prof':{const p=m.prof||{};u.level=Math.max(1,Math.min(999,p.level|0||1));u.wins=Math.max(0,p.wins|0);u.games=Math.max(0,p.games|0);u.frame=String(p.frame||'none').slice(0,16);
     // 3.10.0 profile popup + Halloween contest
     u.caps=Math.max(0,p.caps|0);u.best=Math.max(0,Math.min(9999,p.best|0));u.cc=/^[A-Z]{2}$/.test(p.cc||'')?p.cc:'';if(p.hw)setHw(u,p.hw);persist();return true}
    case 'hwscore':setHw(u,m);persist();return true;
    case 'hwlb':{const all=Object.values(D.users).filter(x=>x.hw&&x.hw.pts>0).sort((a,b)=>b.hw.pts-a.hw.pts);const rank=all.indexOf(u)+1;
     send(ws,{t:'hwlb',list:all.slice(0,50).map(x=>({fid:x.fid,name:x.name,avatar:x.avatar,cc:x.cc||'',pts:x.hw.pts,wins:x.hw.wins,games:x.hw.games})),rank,total:all.length});return true}
    case 'social':send(ws,social(u));return true;
    case 'profile':send(ws,{t:'profile',p:tu?pub(tu,u):null,fid:tf});return true;
    case 'freq':{if(!tu||tf===me){send(ws,{t:'error',msg:'Player not found'});return true}if(blockedEither(u,tu)){send(ws,{t:'error',msg:'Cannot add this player'});return true}
     if(u.friends.includes(tf)){send(ws,{t:'toast',msg:'Already friends'});return true}
     if(u.reqIn.includes(tf)){return this.handle({t:'faccept',fid:tf},pid,c,ws)}
     if(!u.reqOut.includes(tf))u.reqOut.push(tf);if(!tu.reqIn.includes(me))tu.reqIn.push(me);persist();
     toFid(tf,{t:'freqIn',from:pub(u,tu)});pushSocial(tf);send(ws,social(u));send(ws,{t:'toast',msg:'Friend request sent'});return true}
    case 'faccept':{if(!tu||!u.reqIn.includes(tf))return true;u.reqIn=u.reqIn.filter(x=>x!==tf);tu.reqOut=tu.reqOut.filter(x=>x!==me);
     if(!u.friends.includes(tf))u.friends.push(tf);if(!tu.friends.includes(me))tu.friends.push(me);persist();send(ws,social(u));pushSocial(tf);toFid(tf,{t:'toast',msg:`${u.name} accepted your friend request`});return true}
    case 'fdecline':{if(!tu)return true;u.reqIn=u.reqIn.filter(x=>x!==tf);tu.reqOut=tu.reqOut.filter(x=>x!==me);persist();send(ws,social(u));pushSocial(tf);return true}
    case 'funfriend':{if(!tu)return true;u.friends=u.friends.filter(x=>x!==tf);tu.friends=tu.friends.filter(x=>x!==me);persist();send(ws,social(u));pushSocial(tf);return true}
    case 'block':{if(!tu||tf===me)return true;if(!u.blocked.includes(tf))u.blocked.push(tf);u.friends=u.friends.filter(x=>x!==tf);tu.friends=tu.friends.filter(x=>x!==me);
     u.reqIn=u.reqIn.filter(x=>x!==tf);u.reqOut=u.reqOut.filter(x=>x!==tf);tu.reqIn=tu.reqIn.filter(x=>x!==me);tu.reqOut=tu.reqOut.filter(x=>x!==me);persist();send(ws,social(u));pushSocial(tf);return true}
    case 'unblock':{u.blocked=u.blocked.filter(x=>x!==tf);persist();send(ws,social(u));return true}
    case 'report':{if(!tu)return true;D.reports.push({by:me,fid:tf,reason:clean(m.reason,100),ctx:clean(m.ctx,300),t:Date.now()});if(D.reports.length>2000)D.reports=D.reports.slice(-2000);persist();send(ws,{t:'toast',msg:'Report sent. Thank you.'});return true}
    case 'dm':{if(!tu||!u.friends.includes(tf)){send(ws,{t:'error',msg:'You can only message friends'});return true}if(blockedEither(u,tu))return true;if(!rate(me,400,'d'))return true;
     const text=clean(m.text,300);if(!text)return true;const k=dk(me,tf);const msg={from:me,to:tf,text,t:Date.now(),read:false};(D.dms[k]=D.dms[k]||[]).push(msg);if(D.dms[k].length>200)D.dms[k]=D.dms[k].slice(-200);persist();
     send(ws,{t:'dm',m:msg});toFid(tf,{t:'dm',m:msg,from:pub(u,tu)});return true}
    case 'dmhist':{if(!tu)return true;const k=dk(me,tf);const list=D.dms[k]||[];list.forEach(x=>{if(x.to===me)x.read=true});persist();send(ws,{t:'dmhist',fid:tf,list:list.slice(-100)});return true}
    case 'sgift':{// coin/diamond gift to a friend; sender deducts locally, server caps amounts (no auth yet)
     if(!tu||!u.friends.includes(tf)){send(ws,{t:'error',msg:'Gifts are for friends only'});return true}const kind=m.kind==='diamonds'?'diamonds':'coins';
     const amt=Math.max(1,Math.min(kind==='diamonds'?100:10000,m.amount|0));const day=new Date().toISOString().slice(0,10);u.giftDay=u.giftDay===day?day:(u.giftSent=0,day);
     if((u.giftSent||0)>=10){send(ws,{t:'error',msg:'Daily gift limit reached'});return true}u.giftSent=(u.giftSent||0)+1;
     const g={t:'giftIn',kind,amount:amt,from:pub(u,tu),at:Date.now()};if(!toFid(tf,g))tu.inbox.push(g);persist();send(ws,{t:'giftSent',kind,amount:amt,to:tf});return true}
    // ----- chat rooms -----
    case 'crooms':send(ws,{t:'crooms',list:[...CR.values()].map(r=>({id:r.id,name:r.name,count:r.members.size,seats:r.seats.length,used:r.seats.filter(s=>s.fid).length}))});return true;
    case 'cjoin':{const r=CR.get(String(m.id));if(!r)return true;crLeave(me);r.members.add(me);if(!r.host)r.host=me;crBc(r,crInfo(r));return true}
    case 'cleave':crLeave(me);send(ws,{t:'cleft'});return true;
    case 'cchat':{const r=roomOf(me);if(!r||!rate(me,500,'c'))return true;const text=clean(m.text,200);if(!text)return true;const x={fid:me,name:u.name,avatar:u.avatar,text,t:Date.now()};r.chat.push(x);if(r.chat.length>50)r.chat.shift();crBc(r,{t:'cmsg',id:r.id,m:x});return true}
    case 'seat':{const r=roomOf(me);const i=m.i|0;if(!r||!r.seats[i])return true;const s=r.seats[i];if(s.fid||(s.locked&&r.host!==me))return true;r.seats.forEach(x=>{if(x.fid===me){x.fid=null;x.mic=false}});s.fid=me;s.mic=false;crBc(r,crInfo(r));return true}
    case 'unseat':{const r=roomOf(me);if(!r)return true;r.seats.forEach(x=>{if(x.fid===me){x.fid=null;x.mic=false}});crBc(r,crInfo(r));return true}
    case 'smic':{const r=roomOf(me);if(!r)return true;const s=r.seats.find(x=>x.fid===me);if(s){s.mic=!!m.on;crBc(r,crInfo(r))}return true}
    case 'slock':{const r=roomOf(me);const i=m.i|0;if(!r||r.host!==me||!r.seats[i])return true;r.seats[i].locked=!!m.lock;if(m.lock&&r.seats[i].fid&&r.seats[i].fid!==me){r.seats[i].fid=null;r.seats[i].mic=false}crBc(r,crInfo(r));return true}
    case 'ckick':{const r=roomOf(me);if(!r||r.host!==me||tf===me||!r.members.has(tf))return true;crLeave(tf);toFid(tf,{t:'ckicked',name:r.name});return true}
    case 'cstart':{const r=roomOf(me);if(!r||r.host!==me)return true;const seated=r.seats.filter(s=>s.fid).map(s=>s.fid).slice(0,4);if(seated.length<2){send(ws,{t:'error',msg:'Need at least 2 seated players'});return true}
     const md=['classic','quick','arrow','team','blitz','kill'].includes(m.mode)?m.mode:'classic';const n=md==='team'?4:Math.max(2,seated.length);const nr=ctx.newRoom(n,{mode:md},false);
     ctx.joinRoom(c,pid,nr);seated.filter(f=>f!==me).forEach(f=>toFid(f,{t:'cgame',code:nr.code,mode:md,from:u.name}));send(ws,{t:'cgame',code:nr.code,mode:md,host:true});return true}
    // ----- clubs (basic) -----
    case 'clubnew':{if(u.club){send(ws,{t:'error',msg:'Leave your club first'});return true}const name=clean(m.name,20);if(name.length<3){send(ws,{t:'error',msg:'Club name too short'});return true}
     const id='C'+Math.random().toString(36).slice(2,7).toUpperCase();D.clubs[id]={id,name,badge:String(m.badge||'🛡️').slice(0,4),owner:me,members:[me],chat:[],created:Date.now()};u.club=id;persist();send(ws,{t:'club',club:clubInfo(id)});send(ws,social(u));return true}
    case 'clubs':send(ws,{t:'clubs',list:Object.values(D.clubs).sort((a,b)=>b.members.length-a.members.length).slice(0,30).map(cl=>({id:cl.id,name:cl.name,badge:cl.badge,count:cl.members.length}))});return true;
    case 'clubjoin':{const cl=D.clubs[String(m.id)];if(!cl||u.club)return true;if(cl.members.length>=30){send(ws,{t:'error',msg:'Club is full'});return true}cl.members.push(me);u.club=cl.id;persist();cl.members.forEach(f=>toFid(f,{t:'club',club:clubInfo(cl.id)}));return true}
    case 'clubleave':{const cl=u.club&&D.clubs[u.club];if(!cl)return true;cl.members=cl.members.filter(x=>x!==me);u.club=null;if(!cl.members.length)delete D.clubs[cl.id];else{if(cl.owner===me)cl.owner=cl.members[0];cl.members.forEach(f=>toFid(f,{t:'club',club:clubInfo(cl.id)}))}persist();send(ws,{t:'club',club:null});return true}
    case 'club':send(ws,{t:'club',club:u.club?clubInfo(u.club):null});return true;
    case 'clubchat':{const cl=u.club&&D.clubs[u.club];if(!cl||!rate(me,500,'k'))return true;const x={fid:me,name:u.name,avatar:u.avatar,text:clean(m.text,200),t:Date.now()};if(!x.text)return true;cl.chat.push(x);if(cl.chat.length>50)cl.chat.shift();persist();cl.members.forEach(f=>toFid(f,{t:'clubmsg',m:x}));return true}
    // ----- WebRTC signaling relay -----
    case 'rtc':{if(!tu||tf===me||!sameVoice(me,tf)||blockedEither(u,tu))return true;const data=m.data;if(!data||JSON.stringify(data).length>20000)return true;toFid(tf,{t:'rtc',from:me,data});return true}
    case 'vstate':{// broadcast mic on/off + speaking to voice peers
     const on=!!m.on;const cc=c.room&&ctx.rooms.get(c.room);if(cc)cc.seats.forEach(s=>{if(s.pid&&s.pid!==pid){const x=clients.get(s.pid);x&&send(x.ws,{t:'vstate',fid:me,on})}});const r=roomOf(me);if(r){const s=r.seats.find(x=>x.fid===me);if(s){s.mic=on;crBc(r,crInfo(r))}}return true}
   }
   return false;
   function clubInfo(id){const cl=D.clubs[id];if(!cl)return null;return {id:cl.id,name:cl.name,badge:cl.badge,owner:cl.owner,members:cl.members.map(f=>pub(U(f),u)).filter(Boolean),chat:cl.chat.slice(-30)}}
  }}};
