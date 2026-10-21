// Pluggable "Make Your Own Emojis" generator (3.5.8).
// TODO(go-live): implement generate() against a real image-generation backend (e.g. an
// img2img / face-consistent sticker model). Configure with env EMOJI_GEN_URL + EMOJI_GEN_KEY.
// Contract: generate({photos:[Buffer jpeg], styles:[string]}) -> Promise<[Buffer png 512x512 transparent]>
// Until configured, configured() is false and the server answers status:'unconfigured'
// (the client then shows "Coming soon" and charges nothing).
const STYLES=['laugh','point','cool','angry','cry','thumbs-up','kiss','sultan'];
module.exports={
 STYLES,
 configured(){return !!(process.env.EMOJI_GEN_MOCK||(process.env.EMOJI_GEN_URL&&process.env.EMOJI_GEN_KEY))},
 async generate(job){
  if(process.env.EMOJI_GEN_MOCK){// test-only: echo the first photo once per style
   return STYLES.map(()=>job.photos[0]);}
  // TODO(go-live): POST job.photos to process.env.EMOJI_GEN_URL with Authorization: Bearer EMOJI_GEN_KEY,
  // one image per STYLES entry, remove background, return PNG buffers.
  throw new Error('emoji generator not implemented');
 }};
