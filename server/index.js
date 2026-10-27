// Ludo Sultan server entry: load persisted data (Postgres via DATABASE_URL, else JSON files), then start the app.
const path=require('path'),store=require('./store.js');
store.init({
 social:{file:process.env.DATA_FILE||path.join(__dirname,'data','social.json'),def:{users:{},dms:{},reports:[],clubs:{}},split:true},
 tours:{file:process.env.TOUR_FILE||path.join(__dirname,'data','tours.json'),def:{pending:{}}},
 leaderboard:{file:process.env.LB_FILE||path.join(__dirname,'data','leaderboard.json'),def:[]}
}).then(()=>require('./app.js')).catch(e=>{console.error('FATAL: could not load data store:',e.message);process.exit(1)});
