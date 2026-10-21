// Social server tests: friend requests, DMs, gifts (offline inbox), block, report, profile, chat rooms+seats+lock/kick+start, signaling relay, persistence, profanity filter
const a=require('assert'),{spawn}=require('child_process'),WS=require('ws'),fs=require('fs'),os=require('os'),path=require('path');
const PORT=8211,DATA=path.join(os.tmpdir(),'ls-social-test-'+process.pid+'.json');try{fs.unlinkSync(DATA)}catch(e){}
let srv;function start(){return new Promise(res=>{srv=spawn('node',[path.join(__dirname,'index.js')],{env:Object.assign({},process.env,{PORT,DATA_FILE:DATA,PERSIST_MS:20,BOT_MS:100})});srv.stdout.once('data',()=>res())})}
function stop(){return new Promise(res=>{srv.once('exit',res);srv.kill('SIGTERM')})}
function client(pid,name,prof){return new Promise(res=>{const ws=new WS('ws://localhost:'+PORT);const q=[],waits=[];const C={ws,pid,name,q,
 send:o=>ws.send(JSON.stringify(o)),
 wait:(pred,ms=3000)=>new Promise((ok,ko)=>{const i=q.findIndex(pred);if(i>=0){ok(q.splice(i,1)[0]);return}const w={pred,ok};waits.push(w);setTimeout(()=>{const k=waits.indexOf(w);if(k>=0){waits.splice(k,1);ko(new Error('timeout waiting in '+name+': '+pred))}},ms)}),
 close:()=>ws.close()};
 ws.on('message',d=>{const m=JSON.parse(d);const i=waits.findIndex(w=>w.pred(m));if(i>=0){const w=waits.splice(i,1)[0];w.ok(m)}else q.push(m)});
 ws.on('open',()=>C.send({t:'hello',pid,name,avatar:'🦁',prof:prof||{level:5,wins:3,games:9,frame:'gold'}}));
 C.wait(m=>m.t==='welcome').then(w=>{C.fid=w.fid;return C.wait(m=>m.t==='social')}).then(()=>res(C))})}
const T=t=>m=>m.t===t;
(async()=>{await start();
 const A=await client('pidA-'+Date.now(),'Alice'),B=await client('pidB-'+Date.now(),'Bob'),Cc=await client('pidC-'+Date.now(),'Carl');
 // profile card
 A.send({t:'profile',fid:B.fid});let p=await A.wait(T('profile'));a.strictEqual(p.p.name,'Bob');a.strictEqual(p.p.level,5);a.strictEqual(p.p.frame,'gold');a.strictEqual(p.p.online,true);
 // DM to non-friend refused
 A.send({t:'dm',to:B.fid,text:'hi'});await A.wait(m=>m.t==='error'&&/friends/.test(m.msg));
 // friend request -> accept
 A.send({t:'freq',fid:B.fid});await B.wait(T('freqIn'));let sb=await B.wait(m=>m.t==='social'&&m.reqIn.length===1);a.strictEqual(sb.reqIn[0].fid,A.fid);
 B.send({t:'faccept',fid:A.fid});sb=await B.wait(m=>m.t==='social'&&m.friends.length===1);a.strictEqual(sb.friends[0].fid,A.fid);
 let sa=await A.wait(m=>m.t==='social'&&m.friends.length===1);a.strictEqual(sa.friends[0].fid,B.fid);
 console.log('friend request/accept ok');
 // DM with profanity filter + history + unread
 A.send({t:'dm',to:B.fid,text:'hello you shit player'});let d1=await B.wait(T('dm'));a.strictEqual(d1.m.text,'hello you **** player');await A.wait(T('dm'));
 B.send({t:'dmhist',fid:A.fid});let h=await B.wait(T('dmhist'));a.strictEqual(h.list.length,1);console.log('DM + filter ok');
 // gift to offline friend lands in inbox on next hello
 B.close();await new Promise(r=>setTimeout(r,200));A.send({t:'sgift',to:B.fid,kind:'diamonds',amount:500});let gs=await A.wait(T('giftSent'));a.strictEqual(gs.amount,100);// capped
 const B2=await client(B.pid,'Bob');let gi=await B2.wait(T('giftIn'));a.strictEqual(gi.kind,'diamonds');a.strictEqual(gi.amount,100);a.strictEqual(gi.from.fid,A.fid);console.log('offline gift inbox ok');
 // block: removes friendship, blocks DMs and requests
 Cc.send({t:'freq',fid:A.fid});await A.wait(T('freqIn'));A.send({t:'block',fid:Cc.fid});let sa2=await A.wait(m=>m.t==='social'&&m.blocked.length===1);a.strictEqual(sa2.reqIn.length,0);
 Cc.send({t:'freq',fid:A.fid});await Cc.wait(m=>m.t==='error'&&/Cannot/.test(m.msg));A.send({t:'report',fid:Cc.fid,reason:'abuse'});await A.wait(m=>m.t==='toast'&&/Report/.test(m.msg));console.log('block/report ok');
 // chat rooms
 A.send({t:'crooms'});let cl=await A.wait(T('crooms'));a.ok(cl.list.some(r=>r.id==='pakistan'));a.ok(cl.list.length>=5);
 A.send({t:'cjoin',id:'pakistan'});let ci=await A.wait(m=>m.t==='croom'&&m.members.length===1);a.strictEqual(ci.host,A.fid);a.strictEqual(ci.seats.length,8);
 B2.send({t:'cjoin',id:'pakistan'});await A.wait(m=>m.t==='croom'&&m.members.length===2);
 Cc.send({t:'cjoin',id:'pakistan'});await A.wait(m=>m.t==='croom'&&m.members.length===3);
 B2.send({t:'cchat',text:'salam sab ko, chutiya'});let cm=await A.wait(T('cmsg'));a.strictEqual(cm.m.text,'salam sab ko, *******');
 A.send({t:'seat',i:0});await A.wait(m=>m.t==='croom'&&m.seats[0].fid===A.fid);
 A.send({t:'slock',i:1,lock:true});await A.wait(m=>m.t==='croom'&&m.seats[1].locked);
 B2.send({t:'seat',i:1});B2.send({t:'seat',i:2});let cs=await A.wait(m=>m.t==='croom'&&m.seats[2].fid===B2.fid);a.strictEqual(cs.seats[1].fid,null);
 // signaling relay between seated members only
 B2.send({t:'rtc',to:A.fid,data:{sdp:{type:'offer',sdp:'x'}}});let rt=await A.wait(T('rtc'));a.strictEqual(rt.from,B2.fid);a.strictEqual(rt.data.sdp.type,'offer');
 Cc.send({t:'rtc',to:A.fid,data:{x:1}});await new Promise(r=>setTimeout(r,250));a.ok(!A.q.some(m=>m.t==='rtc'&&m.from===Cc.fid),'unseated/blocked peer must not relay');
 // kick
 A.send({t:'ckick',fid:Cc.fid});await Cc.wait(T('ckicked'));await A.wait(m=>m.t==='croom'&&m.members.length===2);
 // non-host can't lock/start
 B2.send({t:'slock',i:3,lock:true});B2.send({t:'cstart'});await new Promise(r=>setTimeout(r,200));a.ok(!B2.q.some(m=>m.t==='cgame'));
 // start game from room
 A.send({t:'cstart',mode:'classic'});const ga=await A.wait(T('cgame')),gb=await B2.wait(T('cgame'));a.strictEqual(ga.code,gb.code);
 B2.send({t:'join',code:gb.code});const st=await B2.wait(m=>m.t==='state',5000);a.ok(st.g);
 const rm=await A.wait(m=>m.t==='room'&&m.players&&m.players.length===2&&m.players.every(p=>p.fid));
 // in-match chat filter + fid, and match-voice signaling relay
 A.send({t:'chat',text:'gg bastard'});const mc=await B2.wait(T('chat'));a.strictEqual(mc.text,'gg *******');a.strictEqual(mc.fid,A.fid);
 A.send({t:'leave'});B2.send({t:'cleave'});A.send({t:'cleave'});
 // recent players recorded
 A.send({t:'social'});const s3=await A.wait(m=>m.t==='social'&&m.recent.length>0);a.strictEqual(s3.recent[0].fid,B2.fid);console.log('chat rooms, seats, lock/kick, start, relay, match chat ok');
 // clubs
 A.send({t:'clubnew',name:'Sultans',badge:'👑'});const c1=await A.wait(m=>m.t==='club'&&m.club);B2.send({t:'clubjoin',id:c1.club.id});await A.wait(m=>m.t==='club'&&m.club&&m.club.members.length===2);
 B2.send({t:'clubchat',text:'hi club'});await A.wait(m=>m.t==='clubmsg'&&m.m.text==='hi club');console.log('clubs ok');
 // persistence across restart
 A.close();B2.close();Cc.close();await new Promise(r=>setTimeout(r,200));await stop();await start();
 const A2=await client(A.pid,'Alice');A2.send({t:'social'});const s4=await A2.wait(m=>m.t==='social'&&m.friends.length===1);a.strictEqual(s4.friends[0].fid,B.fid);a.strictEqual(s4.blocked.length,1);
 A2.send({t:'dmhist',fid:B.fid});const h2=await A2.wait(T('dmhist'));a.strictEqual(h2.list.length,1);console.log('persistence ok');
 A2.close();await stop();try{fs.unlinkSync(DATA)}catch(e){}console.log('ALL SOCIAL TESTS PASSED');process.exit(0)
})().catch(e=>{console.error('FAIL',e);try{srv.kill()}catch(_){}process.exit(1)});
