(function(root){
const COLORS=['red','green','yellow','blue'];
const TRACK=[];(function(){const s=[[6,1,0,1,5],[5,6,-1,0,6],[0,7,0,1,1],[0,8,1,0,6],[6,9,0,1,6],[7,14,1,0,1],[8,14,0,-1,6],[9,8,1,0,6],[14,7,0,-1,1],[14,6,-1,0,6],[8,5,0,-1,6],[7,0,-1,0,1]];
// build explicitly
const p=[];for(let c=1;c<=5;c++)p.push([6,c]);for(let r=5;r>=0;r--)p.push([r,6]);p.push([0,7]);for(let r=0;r<=5;r++)p.push([r,8]);
for(let c=9;c<=14;c++)p.push([6,c]);p.push([7,14]);for(let c=14;c>=9;c--)p.push([8,c]);for(let r=9;r<=14;r++)p.push([r,8]);p.push([14,7]);
for(let r=14;r>=9;r--)p.push([r,6]);for(let c=5;c>=0;c--)p.push([8,c]);p.push([7,0]);p.push([6,0]);TRACK.push(...p);})();
const START=[0,13,26,39], SAFE=new Set([0,8,13,21,26,34,39,47]), ARROWS=new Set([4,17,30,43]);
function isArrow(g){return !!(g.opts&&(g.opts.mode==='arrow'||g.opts.arrow));}
function arrowHit(g,c,np){return isArrow(g)&&np>=0&&np<50&&ARROWS.has(trackIdx(c,np));}
// Arrow mode, curved home arrow: own pawn landing on the corner square before its home lane (rel 49) slides straight into home lane sq1 (51)
const HOME_ARROW=49;function arrowDest(g,c,np){if(!isArrow(g))return np;if(arrowHit(g,c,np))return np+1;if(np===HOME_ARROW)return 51;return np;}
function isBlitz(g){return !!(g.opts&&g.opts.mode==='blitz');}
const BLITZ_TURNS=20,BLITZ_PTS={step:1,kill:20,home:15};
const HOMECOL=[[[7,1],[7,2],[7,3],[7,4],[7,5]],[[1,7],[2,7],[3,7],[4,7],[5,7]],[[7,13],[7,12],[7,11],[7,10],[7,9]],[[13,7],[12,7],[11,7],[10,7],[9,7]]];
const BASE=[[[1.5,1.5],[1.5,3.5],[3.5,1.5],[3.5,3.5]],[[1.5,10.5],[1.5,12.5],[3.5,10.5],[3.5,12.5]],[[10.5,10.5],[10.5,12.5],[12.5,10.5],[12.5,12.5]],[[10.5,1.5],[10.5,3.5],[12.5,1.5],[12.5,3.5]]];
const CENTER=[[7,6.2],[6.2,7],[7,7.8],[7.8,7]];
// progress: -1 base, 0..50 track, 51..55 home col, 56 finished
function ci(c){return typeof c==='string'?COLORS.indexOf(c):c;}
function trackIdx(c,p){return (START[ci(c)]+p)%52;}
function cellOf(c,p,i){c=ci(c);if(p<0)return BASE[c][i];if(p<=50)return TRACK[trackIdx(c,p)];if(p<56)return HOMECOL[c][p-51];return CENTER[c];}
function canMove(p,d){if(p===56)return false;if(p<0)return d===6;return p+d<=56;}
function newGame(players,opts){const o=Object.assign({blockade:false,three6:true,mode:'classic'},opts||{});o.three6=true;// 3.7.1: three consecutive 6s burn the turn in every mode
if(o.mode==='team'&&players.length!==4)o.mode='classic';
 return {players,tokens:players.map(()=>o.mode==='quick'||o.mode==='blitz'?[0,-1,-1,-1]:[-1,-1,-1,-1]),turn:0,rank:[],opts:o,sixes:0,
  ...(o.mode==='blitz'?{score:players.map(()=>0),turnsLeft:players.length*(o.blitzTurns||BLITZ_TURNS)}:{})};}
function isTeam(g){return !!(g.opts&&g.opts.mode==='team'&&g.players.length===4);}
function ally(g,a,b){return a===b||(isTeam(g)&&(a+2)%4===b);}
function target(g){return g.opts&&g.opts.mode==='quick'?2:4;}
function homeCount(g,pi){return g.tokens[pi].filter(x=>x===56).length;}
function blockAt(g,pi,t){// opponent with >=2 tokens on track idx t
 for(let oj=0;oj<g.players.length;oj++){if(ally(g,pi,oj))continue;let n=0;for(const op of g.tokens[oj])if(op>=0&&op<=50&&trackIdx(g.players[oj],op)===t)n++;if(n>=2)return true;}return false;}
function legal(g,pi,ti,d){const p=g.tokens[pi][ti];if(!canMove(p,d))return false;if(!g.opts||!g.opts.blockade)return true;const c=g.players[pi];
 const from=p<0?0:p+1,to=p<0?0:p+d;for(let q=from;q<=Math.min(to,50);q++)if(blockAt(g,pi,trackIdx(c,q)))return false;return true;}
function movable(g,pi,d){return g.tokens[pi].map((p,i)=>legal(g,pi,i,d)?i:-1).filter(i=>i>=0);}
// call after a roll: returns {forfeit,moves}
const REROLL_COSTS=[3,8,15,25,40];function rerollCost(n){return REROLL_COSTS[Math.min(Math.max(n|0,0),REROLL_COSTS.length-1)]}
function spendReroll(bal,n){const c=rerollCost(n);if(!(bal>=c))return null;return {cost:c,bal:bal-c,n:n+1}}
function onRoll(g,d){if(d===6)g.sixes=(g.sixes||0)+1;else g.sixes=0;if(g.sixes>=3){return {forfeit:true,moves:[]};}return {forfeit:false,moves:movable(g,g.turn,d)};}
// call after turn action: extra=bool from applyMove (false if no move)
function advance(g,extra){if(over(g))return -1;if(extra&&!g.rank.includes(g.turn))return g.turn;g.sixes=0;return nextTurn(g);}
// apply move, returns {captured:[[pi,ti]],finished,extra}
function applyMove(g,pi,ti,d){const c=g.players[pi];let p=g.tokens[pi][ti];const p0=p;p=p<0?0:p+d;let arrow=false;const ad=arrowDest(g,c,p);if(ad!==p){arrow=ad===51?'home':true;p=ad;}g.tokens[pi][ti]=p;const res={captured:[],finished:p===56,extra:d===6||p===56||arrow,from:null,arrow};
 if(p<=50){const t=trackIdx(c,p);if(!SAFE.has(t)){g.players.forEach((oc,oj)=>{if(ally(g,pi,oj))return;g.tokens[oj].forEach((op,ok)=>{if(op>=0&&op<=50&&trackIdx(oc,op)===t){if(g.shield&&g.shield[oj+':'+ok]){delete g.shield[oj+':'+ok];(res.shielded=res.shielded||[]).push([oj,ok]);return;}g.tokens[oj][ok]=-1;res.captured.push([oj,ok]);if(g.score)g.score[oj]=Math.max(0,g.score[oj]-(op+1));}});});}}
 if(res.captured.length)res.extra=true;
 if(isBlitz(g)){const S=g.score;let pts=(p0<0?1:p-p0)*BLITZ_PTS.step;if(p===56)pts+=BLITZ_PTS.home;res.captured.forEach(([oj])=>{pts+=BLITZ_PTS.kill;});S[pi]+=pts;res.points=pts;
  // victim loses the points its pawn had walked
}
 if(homeCount(g,pi)>=target(g)&&!g.rank.includes(pi)){g.rank.push(pi);res.extra=false;res.done=true;}
 return res;}
function nextTurn(g){const n=g.players.length;if(isBlitz(g)&&g.turnsLeft>0)g.turnsLeft--;for(let k=1;k<=n;k++){const j=(g.turn+k)%n;if(!g.rank.includes(j)){g.turn=j;return j;}}return -1;}
function over(g){if(isBlitz(g))return g.rank.length>=1||g.turnsLeft<=0;if(g.opts&&g.opts.mode==='quick')return g.rank.length>=1;if(isTeam(g))return winTeam(g)>=0;return g.rank.length>=g.players.length-1;}
function winTeam(g){if(!isTeam(g))return -1;for(const t of [0,1])if(g.rank.includes(t)&&g.rank.includes(t+2))return t;return -1;}
function progress(g,pi){return g.tokens[pi].reduce((a,p)=>a+(p<0?-5:p),0);}
// final order of player indices (team: winning team first)
function standings(g){const n=g.players.length,all=[...Array(n).keys()];if(isBlitz(g))return g.rank.concat(all.filter(i=>!g.rank.includes(i)).sort((a,b)=>g.score[b]-g.score[a]||homeCount(g,b)-homeCount(g,a)||progress(g,b)-progress(g,a)));const byProg=(a,b)=>homeCount(g,b)-homeCount(g,a)||progress(g,b)-progress(g,a);
 if(isTeam(g)){const wt=winTeam(g);const win=wt<0?[]:g.rank.filter(i=>i%2===wt);const rest=all.filter(i=>!win.includes(i)).sort((a,b)=>(g.rank.includes(a)?-1:0)-(g.rank.includes(b)?-1:0)||byProg(a,b));return win.concat(rest);}
 return g.rank.concat(all.filter(i=>!g.rank.includes(i)).sort(byProg));}
// AI scoring
function aiPick(g,pi,d){const ms=movable(g,pi,d);if(!ms.length)return -1;let best=ms[0],bs=-1e9;for(const ti of ms){const s=aiScore(g,pi,ti,d);if(s>bs){bs=s;best=ti;}}return best;}
function aiScore(g,pi,ti,d){const c=g.players[pi];{const p=g.tokens[pi][ti];let np=p<0?0:p+d;let s=0;{const ad=arrowDest(g,c,np);if(ad!==np){np=ad;s+=45;}}if(isBlitz(g))s+=(p<0?1:d)*2;
  if(np===56)s+=100;if(p<0)s+=60;
  if(np<=50){const t=trackIdx(c,np);g.players.forEach((oc,oj)=>{if(ally(g,pi,oj))return;g.tokens[oj].forEach(op=>{if(op>=0&&op<=50){if(trackIdx(oc,op)===t&&!SAFE.has(t))s+=120+op;
     // danger: opponent behind within 6
     const ot=trackIdx(oc,op);const dist=(t-ot+52)%52;if(dist>0&&dist<=6&&!SAFE.has(t))s-=40;}});});if(SAFE.has(t))s+=25;}
  else s+=30;
  if(p>=0&&p<=50){const t0=trackIdx(c,p);g.players.forEach((oc,oj)=>{if(ally(g,pi,oj))return;g.tokens[oj].forEach(op=>{if(op>=0&&op<=50){const dist=(t0-trackIdx(oc,op)+52)%52;if(dist>0&&dist<=6&&!SAFE.has(t0))s+=35;}});});}
  s+=np*0.5+Math.random();return s;}}

// ---- 3.5.5 Ludo Star dice queue: 6 -> roll again; after rolling ends, use the queued values in any order ----
function qInit(g){if(!g.queue)g.queue=[];return g.queue;}
// push a rolled value. returns {forfeit, again(roll again), queue}
function rollPush(g,d){const q=qInit(g);if(d===6)g.sixes=(g.sixes||0)+1;else g.sixes=0;
 if(g.sixes>=3){g.queue=[];return {forfeit:true,again:false,queue:[]};}
 q.push(d);return {forfeit:false,again:d===6,queue:q.slice()};}
// legal (die,token) options, deduped by die value and token position
function options(g,pi){const q=g.queue||[];const out=[],seen=new Set();q.forEach((d,di)=>{movable(g,pi,d).forEach(ti=>{const k=d+':'+g.tokens[pi][ti];if(seen.has(k))return;seen.add(k);out.push({di,d,ti});});});return out;}
function canUse(g,pi,di,ti){const q=g.queue||[];return di>=0&&di<q.length&&legal(g,pi,ti,q[di]);}
// apply queued die di to token ti
// ---- 3.7 Must Kill mode: skipping an available capture sends the token(s) that could have captured back to the yard ----
function isKill(g){return !!(g.opts&&g.opts.mode==='kill');}
function capAt(g,pi,ti,d){if(!legal(g,pi,ti,d))return false;const c=g.players[pi];const p=g.tokens[pi][ti];let np=p<0?0:p+d;np=arrowDest(g,c,np);if(np>50)return false;const t=trackIdx(c,np);if(SAFE.has(t))return false;
 return g.players.some((oc,oj)=>!ally(g,pi,oj)&&g.tokens[oj].some((op,ok)=>op>=0&&op<=50&&trackIdx(oc,op)===t&&!(g.shield&&g.shield[oj+':'+ok])));}
function missedKills(g,pi,ti,d){if(!isKill(g)||g.noKillRule||capAt(g,pi,ti,d))return [];const out=[];g.tokens[pi].forEach((p,tj)=>{if(tj!==ti&&p>=0&&p<=50&&capAt(g,pi,tj,d))out.push(tj)});
 // 3.8.2: one missed move costs ONE token only - the most advanced of the tokens that could have captured
 if(out.length>1){let b=out[0];for(const tj of out)if(g.tokens[pi][tj]>g.tokens[pi][b])b=tj;return [b]}return out;}
function useDie(g,pi,di,ti){const d=g.queue[di];const miss=missedKills(g,pi,ti,d);g.queue.splice(di,1);const res=applyMove(g,pi,ti,d);res.d=d;res.di=di;
 if(miss.length){res.penalty=[];miss.forEach(tj=>{const p=g.tokens[pi][tj];if(p>=0&&p<=50){g.tokens[pi][tj]=-1;res.penalty.push(tj)}});}
 const bonus=!res.done&&(res.captured.length>0||res.finished||!!res.arrow);if(bonus)g.bonus=(g.bonus||0)+1;res.bonus=bonus;return res;}
// queue resolved (empty or no options): bonus roll for same player, else next turn. returns next turn index
function endDice(g){g.queue=[];if(over(g))return -1;if(g.bonus&&!g.rank.includes(g.turn)){g.bonus--;g.sixes=0;return g.turn;}g.bonus=0;g.sixes=0;return nextTurn(g);}
function aiChoose(g,pi){const os=options(g,pi);if(!os.length)return null;let b=os[0],bs=-1e9;const K=isKill(g);for(const o of os){let s=aiScore(g,pi,o.ti,o.d)+o.d*0.3;if(K){if(capAt(g,pi,o.ti,o.d))s+=400;else s-=missedKills(g,pi,o.ti,o.d).reduce((a,tj)=>a+150+g.tokens[pi][tj]*3,0);}if(s>bs){bs=s;b=o;}}return b;}

const L={isKill,capAt,missedKills,qInit,rollPush,options,canUse,useDie,endDice,aiChoose,aiScore,HOME_ARROW,arrowDest,isBlitz,BLITZ_TURNS,BLITZ_PTS,REROLL_COSTS,rerollCost,spendReroll,ARROWS,isArrow,arrowHit,isTeam,ally,target,homeCount,winTeam,standings,legal,onRoll,advance,blockAt,COLORS,TRACK,START,SAFE,HOMECOL,BASE,trackIdx,cellOf,canMove,newGame,movable,applyMove,nextTurn,over,aiPick};
if(typeof module!=='undefined')module.exports=L;else root.Ludo=L;})(this);
