// 3.9.0 server: default 10s turn, after a six the next roll phase opens at once, and the diamond re-roll stays valid in that phase
const {spawn}=require('child_process'),WebSocket=require('ws'),assert=require('assert');const PORT=19900+Math.floor(Math.random()*90);
const env={...process.env,PORT,QUICK_MS:300,BOT_MS:5,ANIM_MS:5,NOMOVE_MS:5};delete env.TURN_MS;
const srv=spawn('node',[__dirname+'/index.js'],{env,stdio:['ignore','ignore','inherit']});const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{await wait(700);const ws=new WebSocket('ws://localhost:'+PORT);let seat=-1,turnMs=0,sixAt=0,gap=-1,reOk=false,done=false,phaseRollAfterSix=false,sent=false;
 ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name:'T',diamonds:100})));
 ws.on('message',b=>{const m=JSON.parse(b);if(m.t==='welcome')ws.send(JSON.stringify({t:'quick',mode:'classic',size:2}));if(m.t==='room')seat=m.you;
  if(m.t==='state'){turnMs=m.turnMs;if(m.g.turn===seat&&m.phase==='roll'){if(sixAt&&gap<0){gap=Date.now()-sixAt;phaseRollAfterSix=true;ws.send(JSON.stringify({t:'reroll'}));return}if(!sent){sent=true;setTimeout(()=>{sent=false;ws.send(JSON.stringify({t:'roll'}))},20)}}
   if(m.g.turn===seat&&m.phase==='move'&&m.moves&&m.moves.length)ws.send(JSON.stringify({t:'move',ti:m.moves[0].ti,di:m.moves[0].di}))}
  if(m.t==='rolled'&&m.pi===seat){if(m.reroll&&gap>=0){reOk=true;done=true}else if(m.again&&m.canRe&&!sixAt)sixAt=Date.now();
   if(m.moves&&m.moves.length&&!m.again)setTimeout(()=>ws.send(JSON.stringify({t:'move',ti:m.moves[0].ti,di:m.moves[0].di})),3000)}});
 const t0=Date.now();while(!done&&Date.now()-t0<120000)await wait(100);
 assert.strictEqual(turnMs,10000,'default TURN_MS 10000');assert.ok(phaseRollAfterSix&&gap<900,'roll phase after six in '+gap+'ms');assert.ok(reOk,'re-roll accepted during the roll phase after a six');
 console.log('test-v390: ALL PASSED (turnMs',turnMs,'next roll phase after six',gap+'ms, re-roll ok)');srv.kill();process.exit(0)})().catch(e=>{console.error('FAIL',e.message);srv.kill();process.exit(1)});
