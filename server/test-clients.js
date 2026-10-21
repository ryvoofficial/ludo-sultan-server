// Simulated clients: room by code (4p), quick match (2p), reconnect
const {spawn}=require('child_process'),WebSocket=require('ws'),assert=require('assert');
const PORT=18080+Math.floor(Math.random()*1000);
const srv=spawn('node',[__dirname+'/index.js'],{env:{...process.env,PORT,TURN_MS:800,BOT_MS:20,OFFLINE_MS:30,QUICK_MS:600,ANIM_MS:10,NOMOVE_MS:10},stdio:'inherit'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function client(name,pid){return new Promise(res=>{const ws=new WebSocket('ws://localhost:'+PORT);const c={ws,name,msgs:[],seat:-1,room:null,over:null,chats:0,states:0,pid};
 ws.on('open',()=>{ws.send(JSON.stringify({t:'hello',name,pid}))});
 ws.on('message',b=>{const m=JSON.parse(b);c.msgs.push(m.t);
  if(m.t==='welcome'){c.pid=m.pid;c.fid=m.fid;res(c)}
  if(m.t==='moved'&&m.res&&m.res.arrow)c.arrows=(c.arrows||0)+1;if(m.t==='presence')c.pres=m.list;if(m.t==='challenge')c.chal=m;if(m.t==='declined')c.declined=1;
  if(m.t==='room'){c.room=m;c.seat=m.you}
  if(m.t==='state'){c.states++;c.last=m;if(m.phase==='roll'&&m.g.turn===c.seat&&!c.passive)setTimeout(()=>ws.send(JSON.stringify({t:'roll'})),5);if(m.phase==='move'&&m.g.turn===c.seat&&!c.passive&&m.moves.length){const o=m.moves[m.moves.length-1];ws.send(JSON.stringify({t:'move',ti:o.ti,di:o.di}))}}
  if(m.t==='rolled'&&m.pi===c.seat&&m.moves.length&&!c.passive){const o=m.moves[m.moves.length-1];c.queues=Math.max(c.queues||0,(m.queue||[]).length);ws.send(JSON.stringify({t:'move',ti:o.ti,di:o.di}))}
  if(m.t==='chat')c.chats++;
  if(m.t==='over')c.over=m.rank;});});}
async function until(f,ms=60000){const t=Date.now();while(!f()){if(Date.now()-t>ms){console.log(JSON.stringify(global.DBG&&global.DBG()));throw new Error('timeout')};await wait(20)}}
(async()=>{await wait(500);
 if(process.env.ONLY5){}else{
 // 1) create + join by code, 4 players
 const A=await client('A'),B=await client('B'),C=await client('C'),D=await client('D');
 A.ws.send(JSON.stringify({t:'create',size:4,opts:{blockade:true,three6:true}}));await until(()=>A.room);const code=A.room.code;
 for(const x of [B,C,D])x.ws.send(JSON.stringify({t:'join',code}));
 await until(()=>D.room&&D.room.started);assert.deepStrictEqual([A,B,C,D].map(x=>x.seat).sort(),[0,1,2,3]);
 B.ws.send(JSON.stringify({t:'chat',text:'Good luck! 👍'}));await until(()=>A.chats&&D.chats);
 // illegal: wrong player tries to roll -> ignored (state count unchanged quickly isn't deterministic; check no crash)
 // reconnect: drop C mid game, reconnect with same pid
 await wait(300);const pidC=C.pid;C.ws.terminate();await wait(200);
 const C2=await client('C',pidC);await until(()=>C2.room&&C2.last);assert.strictEqual(C2.seat,C.seat);console.log('reconnect ok, seat',C2.seat);
 global.DBG=()=>({last:A.last,msgs:A.msgs.slice(-8),n:A.msgs.length});await until(()=>A.over,120000);await until(()=>C2.over);assert.strictEqual(A.over.length,4);console.log('4p room game finished, rank',A.over);
 // 2) quick match 2 humans + timeout start
 const E=await client('E'),F=await client('F');E.ws.send(JSON.stringify({t:'quick',size:2}));await wait(50);F.ws.send(JSON.stringify({t:'quick',size:2}));
 await until(()=>E.room&&E.room.started&&F.room&&F.room.started);assert.strictEqual(E.room.code,F.room.code);assert.strictEqual(E.room.players.length,2);
 await until(()=>E.over&&F.over,120000);console.log('quick match finished, rank',E.over);
 // 3) solo quick match fills with bot; 3) bad code
 const G=await client('G');G.ws.send(JSON.stringify({t:'join',code:'ZZZZZ'}));await until(()=>G.msgs.includes('error'));
 G.ws.send(JSON.stringify({t:'quick',size:2}));await until(()=>G.room&&G.room.started);assert.strictEqual(G.room.players.length,2);assert.ok(G.room.players.every(p=>!p.bot)&&!/bot/i.test(G.room.players[1-G.seat].name),'3.8.0: fill player looks like a normal player');
 // passive human (afk) — server auto plays on timeout
 G.passive=true;const s0=G.states;await wait(5000);assert.ok(G.states>s0+2,'server auto-plays afk');console.log('afk auto-play ok');G.passive=false;if(G.last.g.turn===G.seat&&G.last.phase==='roll')G.ws.send(JSON.stringify({t:'roll'}));if(G.last.phase==='move'&&G.last.g.turn===G.seat)G.ws.send(JSON.stringify({t:'move',ti:G.last.moves[0]}));await until(()=>G.over,120000);console.log('bot-filled quick match finished');
 // 4) 3-player room where host starts early with addbot
 const H=await client('H'),I=await client('I');H.ws.send(JSON.stringify({t:'create',size:3}));await until(()=>H.room);I.ws.send(JSON.stringify({t:'join',code:H.room.code}));await until(()=>I.room);
 H.ws.send(JSON.stringify({t:'addbot'}));await until(()=>H.room.started&&H.room.players.length==3);await until(()=>H.over,120000);console.log('3p game finished');
 }
 // 5) team quick-match (fills with bots to 4) + gift relay
 const T1=await client('T1'),T2=await client('T2');T1.ws.send(JSON.stringify({t:'quick',mode:'team'}));await wait(50);T2.ws.send(JSON.stringify({t:'quick',mode:'team'}));
 T1.gifts=0;T1.ws.on('message',b=>{const m=JSON.parse(b);if(m.t==='gift')T1.gifts++});
 console.log('t-a');await until(()=>T1.room&&T1.room.started);console.log('t-b');assert.strictEqual(T1.room.players.length,4);assert.strictEqual(T1.room.opts.mode,'team');
 T2.ws.send(JSON.stringify({t:'gift',to:T1.seat,item:'🌹'}));await until(()=>T1.gifts>0);console.log('t-c');global.DBG=()=>({last:T1.last&&{g:T1.last.g,phase:T1.last.phase},msgs:T1.msgs.slice(-6)});
 await until(()=>T1.over&&T2.over,400000);assert.strictEqual(T1.over[0]%2,T1.over[1]%2,'team winners are partners');console.log('team game finished, rank',T1.over);
 // 6) quick mode private room, 3 players
 const U1=await client('U1'),U2=await client('U2'),U3=await client('U3');U1.ws.send(JSON.stringify({t:'create',size:3,opts:{mode:'quick'}}));await until(()=>U1.room);
 for(const x of [U2,U3])x.ws.send(JSON.stringify({t:'join',code:U1.room.code}));await until(()=>U3.room&&U3.room.started);
 await until(()=>U1.over,400000);assert.strictEqual(U1.over.length,3);console.log('quick-mode game finished, rank',U1.over);
 // 7) arrow mode private room 2p with jumps + 8) friends presence/challenge 1v1
 const W1=await client('W1'),W2=await client('W2');assert.ok(/^[0-9A-F]{6}$/.test(W1.fid));
 W1.ws.send(JSON.stringify({t:'presence',fids:[W2.fid,'ZZZZZZ']}));await until(()=>W1.pres);assert.ok(W1.pres[W2.fid].online);assert.strictEqual(W1.pres[W2.fid].name,'W2');assert.ok(!W1.pres.ZZZZZZ.online);
 W1.ws.send(JSON.stringify({t:'challenge',to:W2.fid,mode:'arrow'}));await until(()=>W2.chal&&W1.room);assert.strictEqual(W2.chal.code,W1.room.code);assert.strictEqual(W2.chal.from.name,'W1');
 W2.ws.send(JSON.stringify({t:'join',code:W2.chal.code}));await until(()=>W1.room.started&&W2.room&&W2.room.started);assert.strictEqual(W1.room.opts.mode,'arrow');assert.strictEqual(W1.room.players.length,2);
 await until(()=>W1.over&&W2.over,400000);console.log('arrow 1v1 challenge game finished, arrow jumps seen:',W1.arrows||0);
 const X1=await client('X1'),X2=await client('X2');X1.ws.send(JSON.stringify({t:'challenge',to:X2.fid}));await until(()=>X2.chal);X2.ws.send(JSON.stringify({t:'decline',code:X2.chal.code}));await until(()=>X1.declined);console.log('challenge decline ok');
 console.log('ALL SERVER TESTS PASSED');srv.kill();process.exit(0);
})().catch(e=>{console.error('FAIL',e);srv.kill();process.exit(1)});
