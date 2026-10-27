// 3.11.0 online tournaments: 8-player knockout (3 rounds of 1v1). Real players first; computer players fill empty seats
// after TOUR_FILL_MS (60 s). Entry fees are paid on the phone (the game economy is client-side); the server decides the
// bracket, runs every match on its normal rooms, and sends prizes (champion) and the runner-up refund (2x fee).
const crypto=require('crypto');const store=require('./store.js');
const FILL_MS=+process.env.TOUR_FILL_MS||+process.env.QUICK_MS||60000,NEXT_MS=+process.env.TOUR_NEXT_MS||4000;
const CUPS={
 bronze:{name:'Bronze Cup',mode:'quick',fee:{coins:500},prize:{coins:3000}},
 silver:{name:'Silver Cup',mode:'classic',fee:{coins:2000},prize:{coins:12000}},
 sultan:{name:'Sultan Cup',mode:'classic',fee:{coins:10000},prize:{coins:60000,gems:20}},
 diamond:{name:'Diamond Cup',mode:'classic',fee:{gems:10},prize:{gems:100,coins:100000}}};
const ROUNDS=['Quarter-final','Semi-final','Final'];
module.exports=function(ctx){const {clients,send,rooms,newRoom,joinRoom,startGame,fidOf,FILLN,FILLA}=ctx;
 const T=new Map();// id -> tournament
 const byPid=new Map();// pid -> tournament id (active)
 let PEND=(store.get('tours')||{}).pending||{};// pid -> [prize msgs] for players offline when a prize was decided
 function savePend(){store.set('tours',{pending:PEND},1000)}
 const dbl=f=>({coins:(f.coins||0)*2,gems:(f.gems||0)*2});
 function pub(t,pid){const you=t.players.findIndex(p=>p.pid===pid);
  return {t:'tstate',id:t.id,cup:t.cup,name:CUPS[t.cup].name,state:t.state,round:t.round,roundName:ROUNDS[t.round]||'',size:8,you,fillIn:t.state==='wait'?Math.max(0,t.fillAt-Date.now()):null,
   prize:CUPS[t.cup].prize,fee:CUPS[t.cup].fee,champ:t.champ,
   players:t.players.map(p=>({name:p.name,avatar:p.avatar,fid:p.pid?fidOf(p.pid):null,bot:!!p.bot,out:!!p.out})),
   rounds:t.rounds.map(rd=>rd.map(m=>[m.a,m.b,m.w==null?null:m.w,m.live?1:0])),
   room:(()=>{const m=you>=0&&t.rounds[t.round]&&t.rounds[t.round].find(m=>(m.a===you||m.b===you)&&m.w==null&&m.code);return m?m.code:null})()}}
 function bcast(t){t.players.forEach(p=>{if(!p.pid)return;const c=clients.get(p.pid);if(c&&c.ws)send(c.ws,pub(t,p.pid))})}
 function give(pid,msg){const c=clients.get(pid);if(c&&c.ws&&c.ws.readyState===1){send(c.ws,msg);return}(PEND[pid]=PEND[pid]||[]).push(msg);savePend()}
 function deliver(pid,ws){const a=PEND[pid];if(!a||!a.length)return;delete PEND[pid];savePend();a.forEach(m=>send(ws,m))}
 function lobby(){const out={};for(const k of Object.keys(CUPS)){const w=[...T.values()].find(t=>t.cup===k&&t.state==='wait');out[k]={joined:w?w.players.length:0,live:[...T.values()].filter(t=>t.cup===k&&t.state==='play').length}}return {t:'tlist',cups:out,fillMs:FILL_MS}}
 function addBot(t){const used=new Set(t.players.map(p=>p.name));const pool=FILLN.filter(n=>!used.has(n));t.players.push({bot:true,name:pool.length?pool[crypto.randomInt(pool.length)]:'Player'+(100+crypto.randomInt(900)),avatar:FILLA[crypto.randomInt(FILLA.length)]})}
 function create(cup){const t={id:'T'+crypto.randomBytes(4).toString('hex'),cup,state:'wait',players:[],rounds:[],round:0,created:Date.now(),fillAt:Date.now()+FILL_MS};
  t.timer=setTimeout(()=>{if(t.state==='wait'&&t.players.some(p=>p.pid)){while(t.players.length<8)addBot(t);start(t)}},FILL_MS);T.set(t.id,t);return t}
 function start(t){clearTimeout(t.timer);t.state='play';// random seeding
  for(let i=t.players.length-1;i>0;i--){const j=crypto.randomInt(i+1);[t.players[i],t.players[j]]=[t.players[j],t.players[i]]}
  t.rounds=[[0,1,2,3].map(k=>({a:2*k,b:2*k+1,w:null}))];t.round=0;bcast(t);setTimeout(()=>playRound(t),1500)}
 function playRound(t){const rd=t.rounds[t.round];
  rd.forEach((m,mi)=>{const A=t.players[m.a],B=t.players[m.b];
   if(A.bot&&B.bot){m.w=crypto.randomInt(2)?m.a:m.b;return}
   const r=newRoom(2,{mode:CUPS[t.cup].mode,three6:true},false);r.tour={id:t.id,round:t.round,mi};m.code=r.code;m.live=true;
   [A,B].forEach(p=>{if(p.bot)r.seats.push({bot:true,fill:true,name:p.name,avatar:p.avatar});else{const c=clients.get(p.pid);if(c&&c.ws&&c.ws.readyState===1)joinRoom(c,p.pid,r);else r.seats.push({pid:p.pid,name:p.name,avatar:p.avatar})}});
   if(!r.started)startGame(r)});
  bcast(t);check(t)}
 function check(t){const rd=t.rounds[t.round];if(!rd||rd.some(m=>m.w==null))return;
  rd.forEach(m=>{const lo=m.w===m.a?m.b:m.a;t.players[lo].out=true});
  if(rd.length===1){// final decided
   const w=rd[0].w,lo=rd[0].w===rd[0].a?rd[0].b:rd[0].a;t.champ=w;t.state='done';const cup=CUPS[t.cup];
   const W=t.players[w],Lo=t.players[lo];if(W.pid)give(W.pid,{t:'tprize',id:t.id,cup:t.cup,place:1,coins:cup.prize.coins||0,gems:cup.prize.gems||0});
   if(Lo.pid){const r=dbl(cup.fee);give(Lo.pid,{t:'tprize',id:t.id,cup:t.cup,place:2,coins:r.coins,gems:r.gems})}
   bcast(t);t.players.forEach(p=>{if(p.pid&&byPid.get(p.pid)===t.id)byPid.delete(p.pid)});setTimeout(()=>T.delete(t.id),10*60000);return}
  t.players.forEach(p=>{if(p.out&&p.pid&&byPid.get(p.pid)===t.id)byPid.delete(p.pid)});
  const ws=rd.map(m=>m.w);t.rounds.push([...Array(ws.length/2)].map((_,k)=>({a:ws[2*k],b:ws[2*k+1],w:null})));t.round++;bcast(t);setTimeout(()=>playRound(t),NEXT_MS)}
 function onOver(r,order){if(!r.tour)return;const t=T.get(r.tour.id);if(!t)return;const m=t.rounds[r.tour.round]&&t.rounds[r.tour.round][r.tour.mi];if(!m||m.w!=null)return;
  // seat 0 = player a, seat 1 = player b
  m.w=order[0]===0?m.a:m.b;m.live=false;const lo=m.w===m.a?m.b:m.a;const L=t.players[lo];
  if(L.pid&&rd(t).length>1){const c=clients.get(L.pid);c&&c.ws&&send(c.ws,{t:'tout',id:t.id,cup:t.cup,round:t.round,roundName:ROUNDS[t.round]})}
  check(t);bcast(t)}
 const rd=t=>t.rounds[t.round]||[];
 function handle(m,pid,c,ws){switch(m.t){
  case 'tlist':send(ws,lobby());deliver(pid,ws);{const id=byPid.get(pid),t=id&&T.get(id);if(t)send(ws,pub(t,pid))}return true;
  case 'tjoin':{const cup=CUPS[m.cup]?m.cup:null;if(!cup){send(ws,{t:'error',msg:'Unknown tournament'});return true}
   const cur=byPid.get(pid)&&T.get(byPid.get(pid));if(cur&&cur.state!=='done'){send(ws,pub(cur,pid));return true}
   let t=[...T.values()].find(x=>x.cup===cup&&x.state==='wait'&&x.players.length<8);if(!t)t=create(cup);
   t.players.push({pid,name:c.name,avatar:c.avatar});byPid.set(pid,t.id);bcast(t);if(t.players.length>=8)start(t);return true}
  case 'tleave':{const id=byPid.get(pid),t=id&&T.get(id);if(!t){send(ws,{t:'tleft',refund:null});return true}
   if(t.state==='wait'){t.players=t.players.filter(p=>p.pid!==pid);byPid.delete(pid);send(ws,{t:'tleft',refund:CUPS[t.cup].fee,cup:t.cup});
    if(!t.players.some(p=>p.pid)){clearTimeout(t.timer);T.delete(t.id)}else bcast(t)}
   else{byPid.delete(pid);send(ws,{t:'tleft',refund:null,cup:t.cup})}// playing: your matches are played by the computer (no refund)
   return true}
  case 'tsync':{const id=byPid.get(pid),t=id&&T.get(id);if(t)send(ws,pub(t,pid));deliver(pid,ws);return true}
 }return false}
 return {handle,onOver,CUPS,T,_pend:()=>PEND}};
