// Ludo Sultan online server: static hosting + WebSocket rooms, server-authoritative
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer}=require('ws');
const L=require(path.join(__dirname,'..','logic.js'));
const PORT=+process.env.PORT||8080,TURN_MS=+process.env.TURN_MS||10000,BOT_MS=+process.env.BOT_MS||900,
 OFFLINE_MS=+process.env.OFFLINE_MS||1500,QUICK_MS=+process.env.QUICK_MS||60000,ANIM_MS=+process.env.ANIM_MS||1400,NOMOVE_MS=+process.env.NOMOVE_MS||900;
const ROOT=path.join(__dirname,'..');
const store=require('./store.js');const LB=new Map();for(const e of (store.get('leaderboard')||[]))if(e&&e.pid)LB.set(e.pid,e);
function lbSave(){store.set('leaderboard',[...LB.values()],2000)}
const MIME={'.html':'text/html','.js':'application/javascript','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';
 if(u==='/health'){res.end('ok');return}
 if(u.startsWith('/custom-emoji')){customEmoji(req,res,u);return}
 const f=path.normalize(path.join(ROOT,u));if(!f.startsWith(ROOT)||f.includes(path.sep+'server'+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end('not found');return}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)});
// ---- 3.5.8 "Make Your Own Emojis" (stub + pluggable generator; see server/emojigen.js) ----
const GEN=require('./emojigen.js');const CE_DIR=path.join(__dirname,'data','custom-emoji');const ceJobs=new Map();
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')}
function customEmoji(req,res,u){cors(res);const J=(c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
 if(req.method==='GET'){const id=u.split('/')[2];const j=ceJobs.get(id);if(!j)return J(404,{error:'unknown job'});return J(200,{job:id,status:j.status,emojis:j.status==='done'?j.emojis:undefined,error:j.error})}
 if(req.method!=='POST')return J(405,{error:'method'});
 let body='',big=false;req.on('data',d=>{body+=d;if(body.length>12e6){big=true;req.destroy()}});
 req.on('end',()=>{if(big)return;let m;try{m=JSON.parse(body)}catch(e){return J(400,{error:'bad json'})}
  const photos=Array.isArray(m.photos)?m.photos.slice(0,5):[];if(!m.consent)return J(400,{error:'consent required'});if(!photos.length)return J(400,{error:'no photos'});
  if(!photos.every(x=>typeof x==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(x)&&x.length<3e6))return J(400,{error:'bad photo'});
  const id=crypto.randomUUID();const pid=String(m.pid||'').slice(0,40);
  if(!GEN.configured()){return J(200,{job:null,status:'unconfigured'})}
  fs.mkdirSync(CE_DIR,{recursive:true});const job={id,pid,status:'processing',created:Date.now(),n:photos.length};ceJobs.set(id,job);
  fs.writeFileSync(path.join(CE_DIR,id+'.json'),JSON.stringify({id,pid,created:job.created,n:photos.length}));
  GEN.generate({photos:photos.map(x=>Buffer.from(x.split(',')[1],'base64')),styles:GEN.STYLES}).then(pngs=>{job.emojis=pngs.map(b=>'data:image/png;base64,'+b.toString('base64'));job.status='done'}).catch(e=>{job.status='failed';job.error=String(e.message||e)});
  J(202,{job:id,status:'processing'})})}
const wss=new WebSocketServer({server});
const rooms=new Map(),clients=new Map();// pid -> {ws,room,name,avatar}
const SEATS={2:['red','yellow'],3:['red','green','yellow'],4:['red','green','yellow','blue']};
const BOTN=['Bot Leo','Bot Mia','Bot Kai','Bot Zed'];
// 3.8.0: quick-match fill players (after QUICK_MS with no real opponent) get normal names/avatars
const FILLN=['Ali','Sana','Bilal','Ayesha','Hamza','Zara','Omar','Fatima','Usman','Hira','Daniel','Lucia','Marco','Sofia','Arjun','Priya','Yusuf','Mariam','Diego','Elena','Kemal','Aisha','Rafael','Noor'];
const FILLA=['🦁','🐯','🦊','🐼','🐵','🐸','🐨','🦄','🐲','🦉','🐙','👳'];
function qkey(size,mode,night,blockade){return size+'|'+mode+'|'+(night?1:0)+'|'+(blockade?1:0)}
function code(){let c;do c=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(c));return c}
function send(ws,m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m))}
function bc(r,m){r.seats.forEach(s=>{if(s.pid&&clients.get(s.pid)&&clients.get(s.pid).room===r.code)send(clients.get(s.pid).ws,m)})}
function roomInfo(r){return {t:'room',code:r.code,public:r.public,size:r.size,host:r.host,started:r.started,opts:r.opts,fillIn:r.fillAt&&!r.started?Math.max(0,r.fillAt-Date.now()):null,
 players:r.seats.map(s=>({fid:s.pid?fidOf(s.pid):null,name:s.name,avatar:s.avatar,bot:!!s.bot&&!s.fill,online:s.bot||!!(s.pid&&clients.get(s.pid)&&clients.get(s.pid).ws&&clients.get(s.pid).room===r.code&&clients.get(s.pid).ws.readyState===1)}))}}
function sendRoom(r){r.seats.forEach((s,i)=>{const c=s.pid&&clients.get(s.pid);if(c&&c.room===r.code)send(c.ws,{...roomInfo(r),you:i})})}
function stateMsg(r){return {t:'state',g:r.g,phase:r.phase,dice:r.dice,moves:r.moves,deadline:r.deadline,left:Math.max(0,r.deadline-Date.now()),turnMs:TURN_MS,colors:r.colors}}
const MODES=['classic','quick','team','arrow','blitz','kill'];
function newRoom(size,opts,pub){const md=MODES.includes(opts&&opts.mode)?opts.mode:'classic';if(md==='team')size=4;const r={code:code(),size,opts:{blockade:!!(opts&&opts.blockade),three6:!!(opts&&opts.three6),mode:md,night:!!(opts&&opts.night)},public:!!pub,seats:[],host:null,started:false,g:null,phase:'wait',dice:0,moves:[],timer:null,created:Date.now()};rooms.set(r.code,r);return r}
function joinRoom(c,pid,r){if(c.room&&c.room!==r.code)leaveRoom(pid);let i=r.seats.findIndex(s=>s.pid===pid);
 if(i<0){if(r.started)return send(c.ws,{t:'error',msg:'Game already started'});if(r.seats.length>=r.size)return send(c.ws,{t:'error',msg:'Room is full'});r.seats.push({pid,name:c.name,avatar:c.avatar});if(!r.host)r.host=pid}
 c.room=r.code;sendRoom(r);if(r.started)send(c.ws,stateMsg(r));
 if(!r.started&&r.seats.length===r.size)startGame(r);
 if(r.public&&!r.started&&r.seats.length>=1&&!r.qt){r.fillAt=Date.now()+QUICK_MS;sendRoom(r)}if(r.public&&!r.started&&r.seats.length>=1&&!r.qt)r.qt=setTimeout(()=>{if(!r.started&&r.seats.some(s=>s.pid)){while(r.seats.length<r.size)addFill(r);startGame(r)}},QUICK_MS)}
function addFill(r){const used=new Set(r.seats.map(s=>s.name));const pool=FILLN.filter(n=>!used.has(n));const name=pool.length?pool[crypto.randomInt(pool.length)]:'Player'+(100+crypto.randomInt(900));r.seats.push({bot:true,fill:true,name,avatar:FILLA[crypto.randomInt(FILLA.length)]})}
function addBot(r){const k=r.seats.length;r.seats.push({bot:true,name:BOTN[k%4],avatar:'🤖'})}
function leaveRoom(pid){const c=clients.get(pid);if(!c||!c.room)return;const r=rooms.get(c.room);c.room=null;if(!r)return;
 if(!r.started){r.seats=r.seats.filter(s=>s.pid!==pid);if(r.host===pid)r.host=(r.seats.find(s=>s.pid)||{}).pid||null;if(!r.seats.length){clearTimeout(r.qt);rooms.delete(r.code)}else sendRoom(r)}
 else{const s=r.seats.find(s=>s.pid===pid);if(s){s.bot=true;s.name+=' (left)';s.pid=null}sendRoom(r);schedule(r);cleanup(r)}}
function cleanup(r){if(r.seats.every(s=>!s.pid)){clearTimeout(r.timer);rooms.delete(r.code)}}
function startGame(r){clearTimeout(r.qt);r.size=r.seats.length;r.colors=SEATS[r.size];r.started=true;r.g=L.newGame(r.colors,r.opts);r.rerolls=r.seats.map(()=>0);try{social.onGameStart(r)}catch(e){}r.g.turn=0;sendRoom(r);beginTurn(r)}
function isAuto(r,i){const s=r.seats[i];if(s.bot)return BOT_MS;const c=clients.get(s.pid);if(!c||c.room!==r.code||!c.ws||c.ws.readyState!==1)return OFFLINE_MS;return 0}
function schedule(r,extraDelay=0){if(!r.started||(r.phase!=='roll'&&r.phase!=='move'))return;clearTimeout(r.timer);const a=isAuto(r,r.g.turn);
 const ms=a?a+extraDelay:Math.max(0,r.deadline-Date.now())+extraDelay;r.timer=setTimeout(()=>autoAct(r),ms)}
function autoAct(r){if(r.phase==='roll')doRoll(r);else if(r.phase==='move'){const ch=L.aiChoose(r.g,r.g.turn);if(ch)doMove(r,ch.ti,ch.di);else endTurn(r)}}
function beginTurn(r,delay=0,keep=false){if(!keep){r.g.queue=[];r.rerollOpen=false}r.phase='roll';r.dice=0;r.moves=[];r.deadline=Date.now()+TURN_MS+delay;bc(r,stateMsg(r));schedule(r,delay)}
function endTurn(r){r.rerollOpen=false;L.endDice(r.g);beginTurn(r)}
const REROLL_WIN=+process.env.REROLL_WIN||2600;
function canAfford(r,pi){const s=r.seats[pi];const c=s&&!s.bot&&clients.get(s.pid);return c&&c.diamonds>=L.rerollCost((r.rerolls||[])[pi]|0)}
// 3.5.5 dice queue: 6 -> roll again; when rolling ends the player applies queued values in any order
function doRoll(r,re){if(r.phase!=='roll'&&!re)return;const pi=r.g.turn;L.qInit(r.g);
 if(!re){r.sixesBefore=r.g.sixes||0;r.qBefore=r.g.queue.slice()}else{r.g.sixes=r.sixesBefore;r.g.queue=r.qBefore.slice()}
 const d=1+crypto.randomInt(6);r.dice=d;const rr=L.rollPush(r.g,d);const moves=rr.forfeit||rr.again?[]:L.options(r.g,pi);
 r.rerollOpen=!rr.forfeit&&!!canAfford(r,pi);r.rerollUntil=Date.now()+REROLL_WIN;
 bc(r,Object.assign({t:'rolled',pi,dice:d,queue:r.g.queue.slice(),again:rr.again,moves,forfeit:rr.forfeit,n:(r.rerolls||[])[pi]|0,canRe:r.rerollOpen},re||{}));
 r.phase='busy';clearTimeout(r.timer);const wn=r.rerollOpen?REROLL_WIN:0;
 if(rr.forfeit){r.g.bonus=0;r.timer=setTimeout(()=>endTurn(r),NOMOVE_MS);return}
 if(rr.again){/* 3.9.0: next roll available at once; the re-roll offer stays valid until the player rolls again or REROLL_WIN ends */r.timer=setTimeout(()=>beginTurn(r,0,true),450);return}
 if(!moves.length){r.timer=setTimeout(()=>endTurn(r),Math.max(wn,NOMOVE_MS));return}
 r.phase='move';r.moves=moves;r.deadline=Date.now()+TURN_MS;schedule(r,700)}
function doMove(r,ti,di){if(r.phase!=='move')return false;const pi=r.g.turn;di=di|0;if(!L.canUse(r.g,pi,di,ti))return false;r.rerollOpen=false;const from=r.g.tokens[pi][ti];
 const res=L.useDie(r.g,pi,di,ti);r.phase='busy';clearTimeout(r.timer);
 bc(r,{t:'moved',pi,ti,di,dice:res.d,from,res});
 const steps=from<0?1:res.d;const anim=Math.min(ANIM_MS,200+steps*180)+(res.arrow?450:0);
 if(L.over(r.g)){r.phase='over';const order=L.standings(r.g);r.overRank=order;r.timer=setTimeout(()=>{bc(r,{t:'over',rank:order,mode:r.opts.mode});},anim);return true}
 const os=res.done?[]:L.options(r.g,pi);
 if(os.length){r.timer=setTimeout(()=>{r.phase='move';r.moves=os;r.dice=0;r.deadline=Date.now()+TURN_MS;bc(r,stateMsg(r));schedule(r,300)},anim);return true}
 r.timer=setTimeout(()=>endTurn(r),anim);return true}
// a client that was offline when the game ended still gets the result
function resendOver(r,ws){if(r.phase==='over'&&r.overRank)setTimeout(()=>send(ws,{t:'over',rank:r.overRank,mode:r.opts.mode}),50)}
function fidOf(pid){return crypto.createHash('sha256').update('ls-friend:'+pid).digest('hex').slice(0,6).toUpperCase()}
const fids=new Map();// public friend code -> pid
const social=require('./social.js')({clients,send,fids,fidOf,rooms,newRoom:(...a)=>newRoom(...a),joinRoom:(...a)=>joinRoom(...a)});
function seatOf(r,pid){return r.seats.findIndex(s=>s.pid===pid)}
wss.on('connection',ws=>{let pid=null;ws.isAlive=true;ws.on('pong',()=>ws.isAlive=true);
 ws.on('message',buf=>{let m;try{m=JSON.parse(buf)}catch(e){return}
  if(m.t==='hello'){pid=(typeof m.pid==='string'&&m.pid.length<=40&&m.pid)||crypto.randomUUID();let c=clients.get(pid);
   if(c){if(c.ws&&c.ws!==ws)try{c.ws.close()}catch(e){};c.ws=ws}else{c={ws,room:null};clients.set(pid,c)}
   c.name=String(m.name||'Player').slice(0,16);c.avatar=String(m.avatar||'🦁').slice(0,4);
   c.diamonds=Math.max(0,Math.min(100000,(m.diamonds|0)||0));c.fid=fidOf(pid);fids.set(c.fid,pid);send(ws,{t:'welcome',pid,fid:c.fid});social.onHello(pid,c,m);const r=c.room&&rooms.get(c.room);if(r){sendRoom(r);if(r.started){send(ws,stateMsg(r));schedule(r);resendOver(r,ws)}}return}
  if(!pid)return;const c=clients.get(pid);const r=c.room&&rooms.get(c.room);
  switch(m.t){
   case 'create':{const n=Math.min(4,Math.max(2,m.size|0||4));if(m.opts&&m.night!=null&&m.opts.night==null)m.opts.night=m.night;joinRoom(c,pid,newRoom(n,m.opts,false));break}
   case 'join':{const rr=rooms.get(String(m.code||'').toUpperCase().trim());if(!rr)send(ws,{t:'error',msg:'Room not found'});else joinRoom(c,pid,rr);break}
   case 'quick':{// queue key = player count + mode + night mode + house rule (blockade); only same-key players share a room.
     // 3.10.3: computer players fill empty seats only after QUICK_MS (60 s) without enough real players
     const md=MODES.includes(m.mode)?m.mode:'classic';const sz=md==='team'?4:([2,3,4].includes(m.size|0)?(m.size|0):4);const nt=!!m.night,bl=!!m.blockade;const k=qkey(sz,md,nt,bl);
     if(c.room){const cur=rooms.get(c.room);if(cur&&!cur.started)leaveRoom(pid)}
     let rr=[...rooms.values()].find(x=>x.public&&!x.started&&x.qkey===k&&x.seats.length<x.size);if(!rr){rr=newRoom(sz,{mode:md,night:nt,blockade:bl,three6:true},true);rr.qkey=k}joinRoom(c,pid,rr);break}
   case 'start':if(r&&!r.started&&r.host===pid){while(r.seats.length<(r.opts.mode==='team'?4:2))addBot(r);startGame(r)}break;
   case 'addbot':if(r&&!r.started&&r.host===pid&&r.seats.length<r.size){addBot(r);sendRoom(r);if(r.seats.length===r.size)startGame(r)}break;
   case 'roll':if(r&&r.started&&seatOf(r,pid)===r.g.turn)doRoll(r);break;
   case 'reroll':{if(!(r&&r.started&&r.rerollOpen&&seatOf(r,pid)===r.g.turn&&Date.now()<=r.rerollUntil+400)){send(ws,{t:'rerollDenied',bal:c.diamonds});break}
     const pi=r.g.turn;const sp=L.spendReroll(c.diamonds,r.rerolls[pi]|0);if(!sp){r.rerollOpen=false;send(ws,{t:'rerollDenied',bal:c.diamonds});break}
     c.diamonds=sp.bal;r.rerolls[pi]=sp.n;clearTimeout(r.timer);doRoll(r,{reroll:true,cost:sp.cost,bal:sp.bal,n:sp.n});break}
   case 'gems':c.diamonds=Math.max(0,Math.min(100000,m.diamonds|0));break;
   case 'move':if(r&&r.started&&seatOf(r,pid)===r.g.turn)doMove(r,m.ti|0,m.di|0);break;
   case 'chat':if(r){const i=seatOf(r,pid);if(i>=0)bc(r,{t:'chat',pi:i,fid:c.fid,text:social.matchChat(c,m.text)})}break;
   case 'gift':if(r&&r.started){const i=seatOf(r,pid);const to=m.to|0;if(i>=0&&to>=0&&to<r.seats.length&&to!==i)bc(r,{t:'gift',from:i,to,item:String(m.item||'').slice(0,8)})}break;
   case 'sync':if(r){sendRoom(r);if(r.started){send(ws,stateMsg(r));resendOver(r,ws)}}break;
   case 'presence':{const out={};(Array.isArray(m.fids)?m.fids:[]).slice(0,100).forEach(f=>{f=String(f).toUpperCase();const cp=fids.get(f),cc=cp&&clients.get(cp);out[f]=cc?{online:!!(cc.ws&&cc.ws.readyState===1),name:cc.name,avatar:cc.avatar,playing:!!(cc.room&&rooms.get(cc.room)&&rooms.get(cc.room).started)}:{online:false}});send(ws,{t:'presence',list:out});break}
   case 'challenge':{const tp=fids.get(String(m.to||'').toUpperCase()),tc=tp&&clients.get(tp);if(!tc||!tc.ws||tc.ws.readyState!==1||tp===pid){send(ws,{t:'error',msg:'Friend is offline'});break}
     const md=MODES.includes(m.mode)&&m.mode!=='team'?m.mode:'classic';const nr=newRoom(2,{mode:md,night:!!m.night},false);joinRoom(c,pid,nr);send(tc.ws,{t:'challenge',code:nr.code,mode:md,from:{fid:c.fid,name:c.name,avatar:c.avatar}});break}
   case 'decline':{const rr=rooms.get(String(m.code||''));if(rr&&!rr.started&&rr.host){const hc=clients.get(rr.host);hc&&send(hc.ws,{t:'declined',name:c.name})}break}
   case 'lbpost':{const e={pid,fid:c.fid||'',name:String(m.name||'Player').slice(0,16),av:String(m.av||'').slice(0,4),tr:Math.max(0,Math.min(1e6,m.tr|0)),wins:Math.max(0,m.wins|0),cc:String(m.cc||'').slice(0,3).toUpperCase(),city:String(m.city||'').slice(0,40),t:Date.now()};LB.set(pid,e);lbSave();break}
   case 'lb':{const sc=['local','national','friends','global'].includes(m.scope)?m.scope:'global';let a=[...LB.values()];
    if(sc==='national')a=a.filter(x=>x.cc===String(m.cc||'').toUpperCase());if(sc==='local')a=a.filter(x=>x.city&&x.city===String(m.city||''));
    if(sc==='friends'){const f=new Set((Array.isArray(m.fids)?m.fids:[]).slice(0,300).map(x=>String(x).toUpperCase()));f.add(c.fid);a=a.filter(x=>f.has(x.fid))}
    a.sort((x,y)=>y.tr-x.tr);send(ws,{t:'lb',scope:sc,rows:a.slice(0,100).map(({pid:_,...r})=>r)});break}
   case 'leave':leaveRoom(pid);send(ws,{t:'left'});break;
   default:social.handle(m,pid,c,ws);
  }});
 ws.on('close',()=>{const c=pid&&clients.get(pid);if(c&&c.ws===ws){c.ws=null;social.onClose(pid,c);const r=c.room&&rooms.get(c.room);if(r){sendRoom(r);if(r.started)schedule(r)}
   // forget idle clients after 5 min
   setTimeout(()=>{const cc=clients.get(pid);if(cc&&!cc.ws){leaveRoom(pid);clients.delete(pid)}},+process.env.FORGET_MS||300000)}})});
setInterval(()=>wss.clients.forEach(ws=>{if(!ws.isAlive)return ws.terminate();ws.isAlive=false;ws.ping()}),30000).unref();
server.listen(PORT,()=>console.log('Ludo Sultan server on http://localhost:'+PORT+' (store: '+store.info+')'));
let stopping=false;function shutdown(){if(stopping)return;stopping=true;const k=setTimeout(()=>process.exit(0),8000);social.flush();store.close().catch(e=>console.error('flush',e.message)).finally(()=>{clearTimeout(k);process.exit(0)})}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
module.exports={server,rooms,social};
