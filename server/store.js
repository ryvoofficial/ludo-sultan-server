// Persistence layer (3.10.2+): Postgres (Neon) when DATABASE_URL is set, JSON files otherwise (local dev/tests).
// Data lives in one key-value table ls_kv(k text pk, v jsonb). Large objects can be split into one row per top-level
// property so a change to e.g. DMs does not rewrite users. Loaded once at boot; writes are debounced and only changed rows are written.
const fs=require('fs'),path=require('path');
const URL_=process.env.DATABASE_URL||'';
const PG_MS=+process.env.PG_PERSIST_MS||1500;
const TBL=/^[a-z_]{1,40}$/.test(process.env.PG_TABLE||'')?process.env.PG_TABLE:'ls_kv';// PG_TABLE lets tests use a separate table
let pool=null,info='';const data={},files={},split={},lastJson={},dirty=new Set();let timer=null,writing=null;
function pgUrl(u){try{const x=new URL(u);x.searchParams.delete('sslmode');x.searchParams.delete('channel_binding');return x.toString()}catch(e){return u}}
async function init(defs){// defs: {key:{file,def,split}}
 Object.entries(defs).forEach(([k,d])=>{files[k]=d.file;split[k]=!!d.split});
 if(URL_){// PG_DRIVER=neon-ws: Neon serverless driver over WebSocket/443 (for networks that block 5432; dev only)
  const {Pool}=process.env.PG_DRIVER==='neon-ws'?(()=>{const n=require('@neondatabase/serverless');n.neonConfig.webSocketConstructor=require('ws');return n})():require('pg');pool=new Pool({connectionString:pgUrl(URL_),ssl:{rejectUnauthorized:true},max:3,idleTimeoutMillis:30000,connectionTimeoutMillis:20000});
  pool.on('error',e=>console.error('pg pool',e.message));
  let err;for(let i=0;i<6;i++){try{await pool.query(`CREATE TABLE IF NOT EXISTS ${TBL}(k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);err=null;break}catch(e){err=e;console.error('pg connect retry',i+1,e.message);await new Promise(r=>setTimeout(r,2000*(i+1)))}}
  if(err)throw err;
  const {rows}=await pool.query(`SELECT k,v FROM ${TBL}`);const byK=new Map(rows.map(r=>[r.k,r.v]));
  for(const [k,d] of Object.entries(defs)){if(split[k]){const o=Object.assign({},clone(d.def));let any=false;for(const [rk,v] of byK){if(rk.startsWith(k+'.')){o[rk.slice(k.length+1)]=v;any=true;lastJson[rk]=JSON.stringify(v)}}
    data[k]=any?o:clone(d.def)}else{data[k]=byK.has(k)?byK.get(k):clone(d.def);if(byK.has(k))lastJson[k]=JSON.stringify(data[k])}}
  info='postgres, '+rows.length+' rows loaded';
 }else{for(const [k,d] of Object.entries(defs)){try{data[k]=JSON.parse(fs.readFileSync(d.file,'utf8'))}catch(e){data[k]=clone(d.def)}}info='json files'}
 return data}
function clone(x){return x==null?x:JSON.parse(JSON.stringify(x))}
function get(k){return data[k]}
function set(k,v,ms){data[k]=v;dirty.add(k);if(timer)return;timer=setTimeout(()=>{timer=null;write().catch(e=>console.error('store write',e.message))},pool?PG_MS:(ms!=null?ms:300))}
function rowsFor(k){const v=data[k];if(pool&&split[k]&&v&&typeof v==='object'&&!Array.isArray(v))return Object.keys(v).map(p=>[k+'.'+p,v[p]]);return [[k,v]]}
async function write(){if(writing){await writing;if(!dirty.size)return}const ks=[...dirty];dirty.clear();
 writing=(async()=>{for(const k of ks){if(!pool){const f=files[k];try{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(data[k]));fs.renameSync(f+'.tmp',f)}catch(e){console.error('persist',e.message)}continue}
  for(const [rk,v] of rowsFor(k)){const j=JSON.stringify(v===undefined?null:v).replace(/\\u0000/g,'');if(lastJson[rk]===j)continue;
   try{await pool.query(`INSERT INTO ${TBL}(k,v,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v,updated_at=now()`,[rk,j]);lastJson[rk]=j}catch(e){console.error('pg write',rk,e.message);dirty.add(k)}}}})();
 try{await writing}finally{writing=null}if(dirty.size&&!timer)timer=setTimeout(()=>{timer=null;write().catch(()=>{})},5000)}
async function flush(){if(timer){clearTimeout(timer);timer=null}await write();if(pool&&dirty.size)await write()}
async function close(){await flush();if(pool)await pool.end().catch(()=>{})}
module.exports={init,get,set,flush,close,get pg(){return !!pool},get info(){return info}};
