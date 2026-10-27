// 3.11.0 skins: equipped token/dice skin is validated, stored in the profile, restored on reconnect and shown to room mates.
// (base: online 6-player, tournaments (bots after fill timer, payouts), email accounts + cloud save + delete, event leaderboard
const {spawn}=require('child_process'),WebSocket=require('ws'),assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const PORT=20080+Math.floor(Math.random()*800),QMS=800;const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'lsskin-'));
const env={...process.env,PORT,TURN_MS:300,BOT_MS:5,OFFLINE_MS:20,QUICK_MS:QMS,TOUR_FILL_MS:QMS,TOUR_NEXT_MS:100,ANIM_MS:5,NOMOVE_MS:5,
 DATA_FILE:TMP+'/s.json',TOUR_FILE:TMP+'/t.json',LB_FILE:TMP+'/l.json',ACC_FILE:TMP+'/a.json',GOOGLE_WEB_CLIENT_ID:'test-client.apps.googleusercontent.com'};delete env.DATABASE_URL;
const srv=spawn('node',[__dirname+'/index.js'],{env,stdio:['ignore','ignore','inherit']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function client(name,pid){return new Promise(res=>{const ws=new WebSocket('ws://localhost:'+PORT);const c={ws,name,room:null,seat:-1,over:null,state:null,acc:[],m:{},all:[]};
 ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name,pid})));
 ws.on('message',b=>{const m=JSON.parse(b);c.all.push(m);c.m[m.t]=m;if(m.t==='welcome'){c.pid=m.pid;c.fid=m.fid;res(c)}if(m.t==='room'){c.room=m;c.seat=m.you}
  if(m.t==='acc')c.acc.push(m);
  if(m.t==='state'){c.state=m;if(c.play&&m.phase==='roll'&&m.g.turn===c.seat)ws.send(JSON.stringify({t:'roll'}))}
  if(m.t==='rolled'&&c.play&&m.pi===c.seat&&m.moves.length){const o=m.moves[Math.floor(Math.random()*m.moves.length)];ws.send(JSON.stringify(Object.assign({t:'move'},o)))}
  if(m.t==='over')c.over=m});});}
const S=(c,o)=>c.ws.send(JSON.stringify(o));
async function until(f,ms=20000){const t=Date.now();while(!f()){if(Date.now()-t>ms)throw new Error('timeout');await wait(20)}}
let n=0;const ok=(c,m)=>{n++;assert.ok(c,m)};
const lastAcc=c=>c.acc[c.acc.length-1];
(async()=>{await wait(800);
 const A=await client('SkinA','skin-pid-a'),B=await client('SkinB','skin-pid-b');
 S(A,{t:'skin',tok:'lion',dice:'gold'});S(B,{t:'skin',tok:'<b>x',dice:'fire'});await wait(150);
 S(A,{t:'create',size:4,opts:{}});await until(()=>A.room&&A.room.code);S(B,{t:'join',code:A.room.code});
 await until(()=>B.room&&B.room.players.length===2&&A.room.players.length===2);
 const pa=B.room.players.find(p=>p.name==='SkinA'),pb=A.room.players.find(p=>p.name==='SkinB');
 ok(pa.tok==='lion'&&pa.dice==='gold','room mate sees equipped skin');ok(pb.tok==='classic'&&pb.dice==='fire','invalid skin id falls back to classic');
 S(A,{t:'skin',tok:'tiger',dice:'galaxy'});await until(()=>{const p=B.room.players.find(p=>p.name==='SkinA');return p.tok==='tiger'&&p.dice==='galaxy'},3000);ok(true,'re-equip pushes room update');
 A.ws.close();await wait(300);const A2=await client('SkinA','skin-pid-a');S(A2,{t:'create',size:4,opts:{}});await until(()=>A2.room&&A2.room.players.length);
 ok(A2.room.players[0].tok==='tiger'&&A2.room.players[0].dice==='galaxy','skin restored from server profile after reconnect');
 console.log('SKINS ALL PASSED',n);srv.kill();process.exit(0)})().catch(e=>{console.error('FAIL',e);srv.kill();process.exit(1)});
