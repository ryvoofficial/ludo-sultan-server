// 3.8.0 matchmaking: queues keyed by player count + mode + night; fill seats with normal-looking players after QUICK_MS; Must Kill online
const {spawn}=require('child_process'),WebSocket=require('ws'),assert=require('assert');
const PORT=19080+Math.floor(Math.random()*800),QMS=1500;
const srv=spawn('node',[__dirname+'/index.js'],{env:{...process.env,PORT,TURN_MS:400,BOT_MS:5,OFFLINE_MS:20,QUICK_MS:QMS,ANIM_MS:5,NOMOVE_MS:5},stdio:['ignore','ignore','inherit']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function client(name){return new Promise(res=>{const ws=new WebSocket('ws://localhost:'+PORT);const c={ws,name,room:null,seat:-1,over:null,state:null,pen:0};
 ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name})));
 ws.on('message',b=>{const m=JSON.parse(b);if(m.t==='welcome'){c.pid=m.pid;res(c)}if(m.t==='room'){c.room=m;c.seat=m.you}
  if(m.t==='state'){c.state=m;if(c.play&&m.phase==='roll'&&m.g.turn===c.seat)ws.send(JSON.stringify({t:'roll'}))}
  if(m.t==='rolled'&&c.play&&m.pi===c.seat&&m.moves.length){const o=m.moves[Math.floor(Math.random()*m.moves.length)];ws.send(JSON.stringify({t:'move',ti:o.ti,di:o.di}))}
  if(m.t==='moved'&&m.res&&m.res.penalty)c.pen++;if(m.t==='over')c.over=m.rank});});}
const q=(c,mode,size,night)=>c.ws.send(JSON.stringify({t:'quick',mode,size,night}));
async function until(f,ms=20000){const t=Date.now();while(!f()){if(Date.now()-t>ms)throw new Error('timeout');await wait(20)}}
let n=0;const ok=(c,m)=>{n++;assert.ok(c,m)};
(async()=>{await wait(700);
 // 1) different keys never share a room
 const A=await client('A'),B=await client('B'),C=await client('C'),D=await client('D'),E=await client('E');
 q(A,'classic',2,false);q(B,'classic',2,true);q(C,'arrow',2,false);q(D,'classic',4,false);await until(()=>A.room&&B.room&&C.room&&D.room);
 const codes=[A,B,C,D].map(x=>x.room.code);ok(new Set(codes).size===4,'4 distinct rooms for 4 keys '+codes);
 ok(B.room.opts.night===true&&A.room.opts.night===false,'night flag in room opts');ok(D.room.size===4&&A.room.size===2,'sizes');
 // 2) same key matches immediately (2P full -> starts)
 q(E,'classic',2,false);await until(()=>E.room&&E.room.started&&A.room.started);ok(E.room.code===A.room.code,'same key matched');ok(E.room.players.every(p=>!p.bot),'two real players');
 // 3) nobody else for key -> after QUICK_MS seats filled with normal-looking players, game starts
 const t0=Date.now();await until(()=>D.room&&D.room.started,QMS+4000);const dt=Date.now()-t0;
 ok(dt>=QMS-300,'waited for QUICK_MS ('+dt+'ms)');ok(D.room.players.length===4,'4 seats filled');
 const fill=D.room.players.filter((p,i)=>i!==D.room.you);ok(fill.every(p=>!p.bot&&p.name&&!/bot/i.test(p.name)&&p.avatar!=='🤖'),'fill players look normal '+JSON.stringify(fill.map(p=>p.name+p.avatar)));
 ok(new Set(D.room.players.map(p=>p.name)).size===4,'unique names');
 await until(()=>B.room.started&&C.room.started,QMS+4000);ok(B.room.players.length===2&&C.room.players.length===2,'2P fills');ok(B.state&&B.state.g.opts.night===true,'night game state');
 // 4) 3-player key + team key
 const F=await client('F'),G=await client('G'),H=await client('H');q(F,'quick',3,false);q(G,'quick',3,false);q(H,'team',2,true);
 await until(()=>F.room&&G.room&&H.room);ok(F.room.code===G.room.code&&F.room.size===3,'3P key shared');ok(H.room.size===4&&H.room.opts.mode==='team','team -> 4 seats');
 // 5) Must Kill online: accepted by server, game plays to the end with random (capture-skipping) moves -> penalties applied server-side
 const K=await client('K');K.play=true;q(K,'kill',2,false);await until(()=>K.room&&K.room.started,QMS+4000);ok(K.room.opts.mode==='kill','kill mode online');
 await until(()=>K.over,120000);ok(K.over.length>=1,'kill game finished');console.log('kill penalties seen',K.pen);
 // 6) unknown mode -> classic; size 6 -> 4 (6P is offline only)
 const Z=await client('Z');q(Z,'weird',6,false);await until(()=>Z.room);ok(Z.room.opts.mode==='classic'&&Z.room.size===4,'fallbacks');
 console.log('test-match: ALL PASSED ('+n+' checks)');srv.kill();process.exit(0)})().catch(e=>{console.error('FAIL',e);srv.kill();process.exit(1)});
