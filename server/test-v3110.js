// 3.11.0: online 6-player, tournaments (bots after fill timer, payouts), email accounts + cloud save + delete, event leaderboard
const {spawn}=require('child_process'),WebSocket=require('ws'),assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const PORT=20080+Math.floor(Math.random()*800),QMS=800;const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'ls3110-'));
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
 // ---- 1) online 6-player: two real players share the 6P queue, 4 seats filled after QUICK_MS, game plays to the end ----
 const A=await client('Six1'),B=await client('Six2');A.play=B.play=true;S(A,{t:'quick',size:6,mode:'classic'});S(B,{t:'quick',size:6,mode:'classic'});
 await until(()=>A.room&&A.room.started&&B.room&&B.room.started,QMS+5000);ok(A.room.code===B.room.code&&A.room.size===6&&A.room.six,'6P room shared');
 ok(A.room.players.length===6,'6 seats');ok(A.state&&A.state.six&&A.state.g.players.length===6,'6P state');
 await until(()=>A.m.rolled&&A.m.rolled.six,8000);ok(true,'6P rolled msg');
 await until(()=>A.all.filter(m=>m.t==='moved').length>=25,60000);const mv=A.all.filter(m=>m.t==='moved');ok(mv.every(m=>m.six&&m.pj>=0&&m.pj<6),'6P moves carry pj');
 ok(new Set(mv.map(m=>m.pi)).size>=3,'turns rotate across seats');console.log('6P ok, moves',mv.length);A.play=B.play=false;S(A,{t:'leave'});S(B,{t:'leave'});
 // ---- 2) tournament: one real player, 7 computer players after the fill timer, 3 rounds, prize or knockout ----
 const T=await client('Cup1');T.play=true;S(T,{t:'tlist'});await until(()=>T.m.tlist);ok(T.m.tlist.cups.bronze&&T.m.tlist.cups.diamond,'cup list');
 S(T,{t:'tjoin',cup:'bronze'});await until(()=>T.m.tstate);ok(T.m.tstate.state==='wait'&&T.m.tstate.players.length===1&&T.m.tstate.fillIn>0,'waiting with fill countdown');
 // leave while waiting refunds, then join again
 S(T,{t:'tleave'});await until(()=>T.m.tleft);ok(T.m.tleft.refund&&T.m.tleft.refund.coins===500,'refund before start');
 T.m.tstate=null;S(T,{t:'tjoin',cup:'bronze'});const t0=Date.now();
 await until(()=>T.m.tstate&&T.m.tstate.state==='play',QMS+4000);ok(Date.now()-t0>=QMS-200,'bots only after fill timer');
 ok(T.m.tstate.players.length===8&&T.m.tstate.players.filter(p=>p.bot).length===7,'7 computer players');
 ok(T.m.tstate.players.filter(p=>p.bot).every(p=>!/bot/i.test(p.name)),'normal names');
 await until(()=>T.room&&T.room.tour&&T.room.started,6000);ok(T.room.size===2&&T.room.opts.mode==='quick','1v1 cup match in cup mode');
 await until(()=>T.m.tprize||T.m.tout,300000);
 if(T.m.tprize){ok([1,2].includes(T.m.tprize.place),'prize place '+T.m.tprize.place);if(T.m.tprize.place===1)ok(T.m.tprize.coins===3000,'champion 3000');else ok(T.m.tprize.coins===1000,'runner-up 2x fee')}
 else ok(T.m.tout.cup==='bronze','knocked out msg');console.log('tournament result',T.m.tprize?('place '+T.m.tprize.place):('out in '+T.m.tout.roundName));
 console.log('tournament ok');
 // ---- 3) accounts: signup links the guest pid, wrong password, login from another device, cloud save, delete ----
 const E1=await client('Mail1');const em='t'+crypto.randomBytes(3).toString('hex')+'@example.com';
 S(E1,{t:'acc_signup',email:'bad',pass:'x'});await until(()=>E1.acc.length===1);ok(!lastAcc(E1).ok&&lastAcc(E1).code==='email','invalid email rejected');
 S(E1,{t:'acc_signup',email:em,pass:'short',name:'Mail1'});await until(()=>E1.acc.length===2);ok(lastAcc(E1).code==='pass','short password rejected');
 S(E1,{t:'acc_signup',email:em,pass:'correct horse 1',name:'Mail1'});await until(()=>E1.acc.length===3);const su=lastAcc(E1);ok(su.ok&&su.token&&su.pid===E1.pid&&su.created,'signup ok, guest pid linked');
await wait(500);const raw=JSON.parse(fs.readFileSync(TMP+'/a.json','utf8'));ok(raw[0].hash.startsWith('scrypt$')&&!JSON.stringify(raw).includes('correct horse')&&!JSON.stringify(raw).includes(su.token),'only scrypt hash + token hash stored');
 S(E1,{t:'acc_signup',email:em.toUpperCase(),pass:'another pass 2'});await until(()=>E1.acc.length===4);ok(lastAcc(E1).code==='exists','duplicate email');
 S(E1,{t:'acc_push',token:su.token,save:{coins:12345,lvl:7},meta:{level:7,coins:12345,gems:3,wins:9}});await until(()=>E1.m.accpushed);ok(E1.m.accpushed.at>0,'cloud save stored');
 const E2=await client('OtherPhone');S(E2,{t:'acc_login',email:em,pass:'wrong pass!!'});await until(()=>E2.acc.length===1);ok(!lastAcc(E2).ok&&lastAcc(E2).code==='wrong','wrong password');
 S(E2,{t:'acc_login',email:em,pass:'correct horse 1'});await until(()=>E2.acc.length===2);const li=lastAcc(E2);ok(li.ok&&li.pid===E1.pid&&li.acct.saveMeta.coins===12345,'login returns account pid + save meta');
 S(E2,{t:'acc_pull',token:li.token});await until(()=>E2.m.accsave);ok(E2.m.accsave.save.coins===12345,'cloud save restored');
 S(E2,{t:'acc_resume',token:li.token});await until(()=>E2.acc.length===3);ok(lastAcc(E2).ok,'session resume');
 S(E2,{t:'acc_resume',token:'nope'});await until(()=>E2.acc.length===4);ok(!lastAcc(E2).ok,'bad session rejected');
 // brute force limit
 for(let i=0;i<9;i++)S(E2,{t:'acc_login',email:em,pass:'guess'+i});await until(()=>E2.acc.length===13,8000);{const r=E2.acc.slice(4);ok(r.some(a=>a.code==='limit')&&r.filter(a=>a.code==='wrong').length<=8,'login rate limit')}
 S(E1,{t:'acc_cfg'});await until(()=>E1.m.acccfg);ok(E1.m.acccfg.google===true&&E1.m.acccfg.facebook===false,'social config flags');
 S(E1,{t:'acc_social',provider:'google',token:'x.y.z'});await until(()=>E1.acc.length===5);ok(!lastAcc(E1).ok&&lastAcc(E1).code==='verify','fake google token rejected');
 S(E1,{t:'acc_social',provider:'facebook',token:'abc'});await until(()=>E1.acc.length===6);ok(!lastAcc(E1).ok&&/not configured/.test(lastAcc(E1).msg),'facebook not configured');
 // event leaderboard
 S(E1,{t:'evscore',ev:'fol26',pts:420,games:3,wins:2});S(A,{t:'evscore',ev:'fol26',pts:900,games:5,wins:4});await wait(150);S(E1,{t:'evlb',ev:'fol26'});await until(()=>E1.m.evlb);
 ok(E1.m.evlb.list.length===2&&E1.m.evlb.list[0].pts===900&&E1.m.evlb.rank===2,'event leaderboard');
 // delete account (password required)
 S(E1,{t:'acc_delete',token:su.token,pass:'nope nope'});await until(()=>E1.acc.length===7);ok(lastAcc(E1).code==='wrong','delete needs password');
 S(E1,{t:'acc_delete',token:su.token,pass:'correct horse 1'});await until(()=>E1.m.accdeleted);
 S(E2,{t:'acc_resume',token:li.token});await until(()=>E2.acc.length===14);ok(!lastAcc(E2).ok,'sessions gone after delete');
 await wait(400);const raw2=JSON.parse(fs.readFileSync(TMP+'/a.json','utf8'));ok(raw2.length===0,'account row deleted');
 S(A,{t:'evlb',ev:'fol26'});A.m.evlb=null;await until(()=>A.m.evlb);ok(A.m.evlb.list.length===1,'deleted player removed from leaderboard');
 console.log('v3110 tests passed:',n);srv.kill();process.exit(0)})().catch(e=>{console.error('FAIL',e.message);srv.kill();process.exit(1)});
