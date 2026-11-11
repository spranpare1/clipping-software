const blockedYoutube=['youtube.com','youtu.be','youtube-nocookie.com','googlevideo.com'];
const hostIs=(host,domain)=>host===domain||host.endsWith(`.${domain}`);
function youtubeVideoId(url){if(hostIs(url.hostname,'youtu.be')){const id=url.pathname.split('/').filter(Boolean)[0]||'';return /^[\w-]{11}$/.test(id)?id:null;}if(!hostIs(url.hostname,'youtube.com'))return null;const id=url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1]||'';return /^[\w-]{11}$/.test(id)?id:null;}
export function validateSourceLink(value){
  let url;try{url=new URL(String(value||'').trim());}catch{return {error:'Paste a complete HTTPS video link.'};}
  if(url.protocol!=='https:'||url.username||url.password)return {error:'Use a public HTTPS video link without embedded login credentials.'};
  if(blockedYoutube.some(host=>hostIs(url.hostname,host))){const videoId=youtubeVideoId(url);if(videoId)return {url,provider:'youtube_portability',videoId};return {error:'Paste a YouTube video link with a valid video ID. Import is available only for videos owned by the connected Google account using Google Data Portability API.'};}
  if(hostIs(url.hostname,'twitch.tv')||hostIs(url.hostname,'clips.twitch.tv')){
    const clipSlug=hostIs(url.hostname,'clips.twitch.tv')?url.pathname.split('/').filter(Boolean)[0]:url.pathname.match(/^\/[^/]+\/clip\/([^/]+)/i)?.[1];
    if(clipSlug&&/^[\w-]{3,100}$/.test(clipSlug))return {url,provider:'twitch_clip',clipSlug};
    const vodId=url.pathname.match(/^\/videos\/(\d+)/i)?.[1];if(vodId)return {url,provider:'twitch_vod',videoId:vodId};
    return {error:'Use a Twitch Clip link or a Twitch VOD URL in the form twitch.tv/videos/VIDEO_ID. VOD links can create an authorized 5–60 second segment at a time; full VOD file import is not available through Twitch APIs.'};
  }
  if(hostIs(url.hostname,'drive.google.com')||hostIs(url.hostname,'docs.google.com')){
    const id=url.pathname.match(/\/file\/d\/([^/]+)/)?.[1]||url.searchParams.get('id');
    if(!id)return {error:'Use a Google Drive file link in the form drive.google.com/file/d/FILE_ID/view and grant this account link access.'};
    url=new URL('https://drive.google.com/uc');url.searchParams.set('export','download');url.searchParams.set('id',id);
  }else if(hostIs(url.hostname,'dropbox.com')){
    url.searchParams.set('dl','1');
  }
  return {url,provider:hostIs(url.hostname,'drive.google.com')?'google_drive':hostIs(url.hostname,'dropbox.com')?'dropbox':'direct'};
}

export function isPublicAddress(address) {
  if (address.includes(':')) {
    const v=address.toLowerCase();
    if (v==='::' || v==='::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('2001:db8:')) return false;
    const mapped=v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); if(mapped)return isPublicAddress(mapped[1]);
    if(v.startsWith('::ffff:')){const hex=v.split(':').slice(-2).map(x=>parseInt(x||'0',16));if(hex.length===2)return isPublicAddress(`${hex[0]>>8}.${hex[0]&255}.${hex[1]>>8}.${hex[1]&255}`);}
    return /^[23][0-9a-f]{3}:/.test(v);
  }
  const p=address.split('.').map(Number); if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127));
}
