// Tournament bracket + payouts with a fake room layer: the real player wins every match -> champion prize; then a run where they lose the final -> 2x fee
const assert=require('assert');const store=require('./store.js');
(async()=>{await store.init({tours:{file:require('os').tmpdir()+'/tu'+Date.now()+'.json',def:{pending:{}}}});process.env.TOUR_FILL_MS=50;process.env.TOUR_NEXT_MS=5;
 function run(loseFinal){return new Promise(done=>{const sent=[];const rooms=new Map();let rc=0;
  const ws={readyState:1};const clients=new Map([['p1',{ws,name:'Me',avatar:'😀'}]]);
  const send=(w,m)=>sent.push(m);
  const ctx={clients,send,rooms,fidOf:p=>'F'+p,FILLN:['Ali','Sana','Omar','Zara','Hira','Leo','Mia','Kai'],FILLA:['🦁'],
   newRoom:(size,opts)=>{const r={code:'R'+(++rc),size,opts,seats:[],started:false};rooms.set(r.code,r);return r},
   joinRoom:(c,pid,r)=>{r.seats.push({pid,name:c.name})},
   startGame:r=>{r.started=true;setTimeout(()=>{const me=r.seats.findIndex(s=>s.pid==='p1');const fin=T.T.get(r.tour.id).round===2;const win=me<0?0:(loseFinal&&fin?1-me:me);T.onOver(r,[win,1-win])},5)}};
  const T=require('./tour.js')(ctx);T.handle({t:'tjoin',cup:'sultan'},'p1',clients.get('p1'),ws);
  const iv=setInterval(()=>{const pr=sent.find(m=>m.t==='tprize');if(pr){clearInterval(iv);done({pr,sent,rooms})}},10)})}
 const a=await run(false);assert.strictEqual(a.pr.place,1);assert.strictEqual(a.pr.coins,60000);assert.strictEqual(a.pr.gems,20);
 const last=a.sent.filter(m=>m.t==='tstate').pop();assert.strictEqual(last.state,'done');assert.ok(a.rooms.size===3,'3 matches played by the real player: '+a.rooms.size);
 ['quarter','semi','final'];[...a.rooms.values()].forEach(r=>assert.strictEqual(r.opts.mode,'classic'));
 const b=await run(true);assert.strictEqual(b.pr.place,2);assert.strictEqual(b.pr.coins,20000);
 console.log('tour unit tests passed: champion 60000+20 gems, runner-up 2x fee');process.exit(0)})().catch(e=>{console.error('FAIL',e);process.exit(1)});
