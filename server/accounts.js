// 3.11.0 accounts: email + password (scrypt, Node built-in), Google / Facebook sign-in (tokens verified on the server),
// session tokens (only their SHA-256 is stored), guest linking (an account owns the device pid it was created on) and a
// cloud copy of the player's save. Postgres table ls_accounts when DATABASE_URL is set, JSON file otherwise.
const crypto=require('crypto'),fs=require('fs'),path=require('path');const store=require('./store.js');
const FILE=process.env.ACC_FILE||path.join(__dirname,'data','accounts.json');
const TBL=/^[a-z_]{1,40}$/.test(process.env.ACC_TABLE||'')?process.env.ACC_TABLE:'ls_accounts';
const SAVE_MAX=+process.env.SAVE_MAX||400000,SESS_DAYS=180,MAX_SESS=10;
const GOOGLE_IDS=()=>String(process.env.GOOGLE_WEB_CLIENT_ID||'').split(',').map(s=>s.trim()).filter(Boolean);
const FB_ID=()=>String(process.env.FB_APP_ID||'').trim(),FB_SECRET=()=>String(process.env.FB_APP_SECRET||'').trim();
const EMAIL_RE=/^[^\s@<>()\[\]\\,;:"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const scryptP=(pw,salt,N)=>new Promise((res,rej)=>crypto.scrypt(pw,salt,64,{N,r:8,p:1,maxmem:64*1024*1024},(e,k)=>e?rej(e):res(k)));
async function hashPw(pw){const salt=crypto.randomBytes(16),N=16384;const k=await scryptP(pw,salt,N);return `scrypt$${N}$${salt.toString('base64')}$${k.toString('base64')}`}
async function checkPw(pw,h){try{const [alg,N,salt,key]=String(h).split('$');if(alg!=='scrypt')return false;const k=await scryptP(pw,Buffer.from(salt,'base64'),+N);const want=Buffer.from(key,'base64');return want.length===k.length&&crypto.timingSafeEqual(k,want)}catch(e){return false}}
// ---- Google ID token (RS256 JWT) verification against Google's public keys ----
let gKeys={at:0,keys:[]};
async function googleKeys(){if(Date.now()-gKeys.at<3600e3&&gKeys.keys.length)return gKeys.keys;const r=await fetch('https://www.googleapis.com/oauth2/v3/certs');if(!r.ok)throw new Error('google certs '+r.status);const j=await r.json();gKeys={at:Date.now(),keys:j.keys||[]};return gKeys.keys}
const b64u=s=>Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'),'base64');
async function verifyGoogle(idToken,keysOverride){const ids=GOOGLE_IDS();if(!ids.length)throw new Error('google not configured');
 const parts=String(idToken||'').split('.');if(parts.length!==3)throw new Error('bad token');const head=JSON.parse(b64u(parts[0])),body=JSON.parse(b64u(parts[1]));
 if(head.alg!=='RS256')throw new Error('bad alg');const keys=keysOverride||await googleKeys();const jwk=keys.find(k=>k.kid===head.kid);if(!jwk)throw new Error('unknown key');
 const ok=crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),crypto.createPublicKey({key:jwk,format:'jwk'}),b64u(parts[2]));if(!ok)throw new Error('bad signature');
 if(!['accounts.google.com','https://accounts.google.com'].includes(body.iss))throw new Error('bad issuer');
 if(!ids.includes(body.aud))throw new Error('wrong audience');if(!(body.exp*1000>Date.now()-60e3))throw new Error('expired');
 return {sub:String(body.sub),email:body.email_verified?String(body.email||'').toLowerCase():'',name:String(body.name||body.given_name||'').slice(0,30),photo:String(body.picture||'')}}
// ---- Facebook access token: debug_token with the app token (FB_APP_SECRET), else /app check; then /me ----
const GRAPH='https://graph.facebook.com/v21.0';
async function verifyFacebook(tok){const id=FB_ID();if(!id)throw new Error('facebook not configured');tok=String(tok||'');if(!tok||tok.length>2048)throw new Error('bad token');let uid=null;
 if(FB_SECRET()){const r=await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(tok)}&access_token=${encodeURIComponent(id+'|'+FB_SECRET())}`);const j=await r.json();const d=j&&j.data;
  if(!d||!d.is_valid||String(d.app_id)!==id)throw new Error('invalid facebook token');uid=String(d.user_id)}
 else{const r=await fetch(`${GRAPH}/app?access_token=${encodeURIComponent(tok)}`);const j=await r.json();if(!j||String(j.id)!==id)throw new Error('token is for another app')}
 const r=await fetch(`${GRAPH}/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(tok)}`);const me=await r.json();if(!me||!me.id)throw new Error('facebook profile failed');
 if(uid&&String(me.id)!==uid)throw new Error('user mismatch');return {sub:String(me.id),email:String(me.email||'').toLowerCase(),name:String(me.name||'').slice(0,30),photo:me.picture&&me.picture.data&&me.picture.data.url||''}}
module.exports=function(ctx){const {send,social}=ctx;
 const A=new Map(),byEmail=new Map(),byG=new Map(),byF=new Map(),bySess=new Map();let ready=null;
 function index(a){if(a.email&&a.hash)byEmail.set(a.email,a.id);if(a.g)byG.set(a.g,a.id);if(a.f)byF.set(a.f,a.id);(a.sess||[]).forEach(s=>bySess.set(s.h,a.id))}
 function unindex(a){if(a.email&&byEmail.get(a.email)===a.id)byEmail.delete(a.email);if(a.g)byG.delete(a.g);if(a.f)byF.delete(a.f);(a.sess||[]).forEach(s=>bySess.delete(s.h))}
 async function load(){if(store.pg){await store.query(`CREATE TABLE IF NOT EXISTS ${TBL}(id text PRIMARY KEY, email text UNIQUE, v jsonb NOT NULL, save jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
   const {rows}=await store.query(`SELECT id,v,save FROM ${TBL}`);rows.forEach(r=>{const a=Object.assign({},r.v,{id:r.id,save:r.save||null});A.set(a.id,a);index(a)})}
  else{try{JSON.parse(fs.readFileSync(FILE,'utf8')).forEach(a=>{A.set(a.id,a);index(a)})}catch(e){}}}
 const ensureLoaded=()=>ready||(ready=load().catch(e=>{ready=null;console.error('accounts load',e.message);throw e}));
 let fileT=null;function saveFile(){clearTimeout(fileT);fileT=setTimeout(()=>{try{fs.mkdirSync(path.dirname(FILE),{recursive:true});fs.writeFileSync(FILE+'.tmp',JSON.stringify([...A.values()]));fs.renameSync(FILE+'.tmp',FILE)}catch(e){console.error('acc file',e.message)}},200)}
 async function put(a,withSave){if(!store.pg){saveFile();return}const {save,id,...v}=a;
  if(withSave)await store.query(`INSERT INTO ${TBL}(id,email,v,save) VALUES($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,v=EXCLUDED.v,save=EXCLUDED.save,updated_at=now()`,[id,a.hash?a.email:null,JSON.stringify(v),save?JSON.stringify(save):null]);
  else await store.query(`INSERT INTO ${TBL}(id,email,v) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,v=EXCLUDED.v,updated_at=now()`,[id,a.hash?a.email:null,JSON.stringify(v)])}
 async function del(a){unindex(a);A.delete(a.id);if(store.pg)await store.query(`DELETE FROM ${TBL} WHERE id=$1`,[a.id]);else saveFile()}
 function newSession(a){const tok=crypto.randomBytes(32).toString('base64url');const h=sha(tok);a.sess=(a.sess||[]).filter(s=>Date.now()-s.t<SESS_DAYS*864e5);a.sess.push({h,t:Date.now()});
  while(a.sess.length>MAX_SESS){bySess.delete(a.sess.shift().h)}bySess.set(h,a.id);return tok}
 function bySession(tok){const h=sha(String(tok||''));const id=bySess.get(h);const a=id&&A.get(id);if(!a)return null;const s=(a.sess||[]).find(x=>x.h===h);if(!s||Date.now()-s.t>SESS_DAYS*864e5)return null;return a}
 const info=a=>({id:a.id,prov:a.prov,email:a.email||'',name:a.name||'',photo:a.photo||'',created:a.created,saveAt:a.save&&a.save.at||0,saveMeta:a.save&&a.save.meta||null});
 // brute-force guard: 8 failed logins per email per 15 min, 30 per connection
 const fails=new Map();function limited(k){const f=fails.get(k);return f&&f.n>=(k.startsWith('c:')?30:8)&&Date.now()-f.t<15*60e3}
 function fail(k){const f=fails.get(k);if(!f||Date.now()-f.t>15*60e3)fails.set(k,{n:1,t:Date.now()});else f.n++}
 setInterval(()=>{const now=Date.now();for(const [k,f] of fails)if(now-f.t>15*60e3)fails.delete(k)},60e3).unref();
 const ok=(ws,a,tok,extra)=>send(ws,Object.assign({t:'acc',ok:true,acct:info(a),pid:a.pid,token:tok||undefined},extra||{}));
 const err=(ws,code,msg,req)=>send(ws,{t:'acc',ok:false,code,msg,req});
 async function socialLogin(m,pid,c,ws){const prov=m.provider==='facebook'?'facebook':m.provider==='google'?'google':null;if(!prov)return err(ws,'bad','Unknown provider');
  let p;try{p=prov==='google'?await verifyGoogle(m.token):await verifyFacebook(m.token)}catch(e){return err(ws,'verify',String(e.message||e).slice(0,80),'social')}
  const k=prov==='google'?'g':'f',idx=prov==='google'?byG:byF;let a=A.get(idx.get(p.sub));let created=false;
  if(!a){a={id:'a_'+crypto.randomUUID(),prov,[k]:p.sub,email:p.email,name:p.name||c.name,photo:p.photo,pid,created:Date.now(),sess:[]};A.set(a.id,a);index(a);created=true}
  else{a.photo=p.photo||a.photo;if(p.email)a.email=a.email||p.email}
  const tok=newSession(a);await put(a);c.acct=a.id;ok(ws,a,tok,{created,req:'social'})}
 function handle(m,pid,c,ws){if(!/^acc_[a-z]+$/.test(String(m.t)))return false;run(m,pid,c,ws).catch(e=>{console.error('acc',m.t,e.message);err(ws,'server','Server error — try again')});return true}
 async function run(m,pid,c,ws){await ensureLoaded();
  {switch(m.t){
  case 'acc_cfg':send(ws,{t:'acccfg',google:GOOGLE_IDS().length>0,facebook:!!FB_ID()});break;
  case 'acc_signup':{const email=String(m.email||'').trim().toLowerCase(),pw=String(m.pass||''),name=social.cleanName?social.cleanName(m.name):String(m.name||'').slice(0,16);
   if(!EMAIL_RE.test(email))return err(ws,'email','Please enter a valid email','signup'),true;if(pw.length<8||pw.length>128)return err(ws,'pass','Password must be at least 8 characters','signup'),true;
   if(byEmail.has(email))return err(ws,'exists','An account with this email already exists — log in instead','signup'),true;
   // guest linking: the new account owns this device's player id (friends, profile, progress stay)
   const a={id:'a_'+crypto.randomUUID(),prov:'email',email,hash:await hashPw(pw),name:name||c.name,pid,created:Date.now(),sess:[]};
   if(byEmail.has(email))return err(ws,'exists','An account with this email already exists','signup'),true;
   A.set(a.id,a);index(a);const tok=newSession(a);await put(a);c.acct=a.id;ok(ws,a,tok,{created:true,req:'signup'});break}
  case 'acc_login':{const email=String(m.email||'').trim().toLowerCase(),pw=String(m.pass||'');const ck='c:'+pid;
   if(limited(email)||limited(ck))return err(ws,'limit','Too many attempts — try again in 15 minutes','login'),true;
   fail(email);fail(ck);// counted before the (slow) hash check so parallel guesses can't slip past the limit
   const a=A.get(byEmail.get(email));const good=a?await checkPw(pw,a.hash):(await hashPw(pw),false);
   if(!good)return err(ws,'wrong','Wrong email or password','login'),true;
   fails.delete(email);{const f=fails.get(ck);if(f)f.n=Math.max(0,f.n-1)}const tok=newSession(a);await put(a);c.acct=a.id;ok(ws,a,tok,{req:'login'});break}
  case 'acc_social':await socialLogin(m,pid,c,ws);break;
  case 'acc_resume':{const a=bySession(m.token);if(!a)return err(ws,'session','Please sign in again','resume'),true;c.acct=a.id;ok(ws,a,null,{req:'resume'});break}
  case 'acc_push':{const a=bySession(m.token);if(!a)return err(ws,'session','Please sign in again','push'),true;const s=m.save;const j=JSON.stringify(s||null);
   if(!s||typeof s!=='object'||j.length>SAVE_MAX)return err(ws,'size','Save too large','push'),true;
   const meta=m.meta&&typeof m.meta==='object'?{level:m.meta.level|0,coins:+m.meta.coins||0,gems:+m.meta.gems||0,wins:m.meta.wins|0}:null;
   a.save={at:Date.now(),data:s,meta};if(m.name)a.name=String(m.name).slice(0,16);await put(a,true);send(ws,{t:'accpushed',at:a.save.at});break}
  case 'acc_pull':{const a=bySession(m.token);if(!a)return err(ws,'session','Please sign in again','pull'),true;send(ws,{t:'accsave',at:a.save&&a.save.at||0,save:a.save&&a.save.data||null,meta:a.save&&a.save.meta||null});break}
  case 'acc_logout':{const a=bySession(m.token);if(a){const h=sha(String(m.token));a.sess=a.sess.filter(s=>s.h!==h);bySess.delete(h);await put(a)}c.acct=null;send(ws,{t:'accout'});break}
  case 'acc_delete':{const a=bySession(m.token);if(!a)return err(ws,'session','Please sign in again','delete'),true;
   if(a.hash&&!(await checkPw(String(m.pass||''),a.hash)))return err(ws,'wrong','Wrong password','delete'),true;
   const p=a.pid;await del(a);c.acct=null;try{social.purge&&social.purge(p)}catch(e){}send(ws,{t:'accdeleted'});break}
  default:err(ws,'bad','Unknown request')}}}
 return {handle,verifyGoogle,verifyFacebook,_A:A,ready:ensureLoaded}};
module.exports.verifyGoogle=verifyGoogle;module.exports.hashPw=hashPw;module.exports.checkPw=checkPw;
