const blockedYoutube=['youtube.com','youtu.be','youtube-nocookie.com','googlevideo.com'];
const hostIs=(host,domain)=>host===domain||host.endsWith(`.${domain}`);
export function validateSourceLink(value){
  let url;try{url=new URL(String(value||'').trim());}catch{return {error:'Paste a complete HTTPS video link.'};}
  if(url.protocol!=='https:'||url.username||url.password)return {error:'Use a public HTTPS video link without embedded login credentials.'};
  if(blockedYoutube.some(host=>hostIs(url.hostname,host)))return {error:'YouTube page links cannot provide source media through the official API. Upload a source file that you are authorized to use.'};
  if(hostIs(url.hostname,'twitch.tv'))return {error:'Twitch page links do not expose full VOD files to this importer. Download your own VOD in Twitch Video Producer, then upload it. Twitch clip downloads can be added through an authorized account connection.'};
  return {url};
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
