export function requestedCount(value, durationSeconds) {
  if (value === 'auto') return Math.min(20, Math.max(1, Math.floor(durationSeconds / 150)));
  return Math.min(50, Math.max(1, Number(value) || 5));
}

export function selectMoments(duration, requested, preferred, signals = []) {
  const length = Math.max(10, Math.min(90, Number(preferred) || 35));
  const possible = duration < length ? 0 : 1 + Math.floor((duration - length) / (length * 1.35));
  const count = requestedCount(requested, duration);
  const actual = Math.min(count, possible);
  const clipLength = Math.min(length, duration);
  const margin = Math.max(0, duration - clipLength);
  if(Array.isArray(signals))signals={sceneCuts:signals};
  const sceneCuts=signals.sceneCuts||[], words=signals.words||[], silences=signals.silences||[];
  const energy=signals.audioEnergy||[];
  const hasAudioSignal=Boolean(signals.transcribed||silences.length||energy.length);
  if ((sceneCuts.length||words.length||silences.length||energy.length) && actual) {
    const seconds=Math.ceil(duration)+1;
    const scenePerSecond=new Uint16Array(seconds),wordsPerSecond=new Uint16Array(seconds),keywordPerSecond=new Uint16Array(seconds),silentPerSecond=new Uint8Array(seconds),energyPerSecond=new Float32Array(seconds);
    for(const t of sceneCuts){const s=Math.floor(t);if(s>=0&&s<seconds)scenePerSecond[s]++;}
    const keywords=String(signals.instruction||'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];const keywordSet=new Set(keywords);
    for(const w of words){const s=Math.floor(Number(w.start));if(s>=0&&s<seconds){wordsPerSecond[s]++;if(keywordSet.has(String(w.text).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')))keywordPerSecond[s]++;}}
    for(const span of silences){const from=Math.max(0,Math.floor(span.start)),to=Math.min(seconds,Math.ceil(span.end));for(let s=from;s<to;s++)silentPerSecond[s]=1;}
    if(energy.length){const finite=energy.filter(Number.isFinite),low=finite.length?Math.min(...finite):-60,high=finite.length?Math.max(...finite):-60,range=Math.max(1,high-low);for(let s=0;s<Math.min(seconds,energy.length);s++)energyPerSecond[s]=Math.max(0,Math.min(1,(energy[s]-low)/range));}
    const prefix=(a)=>{const p=new Float64Array(a.length+1);for(let i=0;i<a.length;i++)p[i+1]=p[i]+a[i];return p;};
    const scenePrefix=prefix(scenePerSecond),wordPrefix=prefix(wordsPerSecond),keywordPrefix=prefix(keywordPerSecond),silencePrefix=prefix(silentPerSecond);
    const sum=(p,a,b)=>p[Math.min(p.length-1,b)]-p[Math.max(0,a)];
    const step = Math.max(5, Math.min(15, length / 4));
    const candidates=[];
    for (let start = 0; start <= margin; start += step) {
      const a=Math.floor(start),b=Math.min(seconds,Math.ceil(start+clipLength));
      const sceneCount=sum(scenePrefix,a,b),wordCount=sum(wordPrefix,a,b),keywordMatches=sum(keywordPrefix,a,b),silenceRatio=sum(silencePrefix,a,b)/Math.max(1,b-a),energyMean=energy.length?energyPerSecond.slice(a,b).reduce((x,y)=>x+y,0)/Math.max(1,b-a):0;
      const speechPoints=Math.min(25,wordCount*.5),scenePoints=Math.min(25,sceneCount*2.5),activityPoints=hasAudioSignal?Math.max(0,12-silenceRatio*12):0,energyPoints=energy.length?Math.round(energyMean*12):0,topicPoints=Math.min(20,keywordMatches*3);
      const score=Math.min(100,Math.round((hasAudioSignal||words.length?20:35)+speechPoints+scenePoints+activityPoints+energyPoints+topicPoints));
      candidates.push({start,sceneCount,wordCount,keywordMatches,silenceRatio,energyMean,score});
    }
    const threshold=Number.isFinite(Number(signals.minimumScore))?Number(signals.minimumScore):35;
    candidates.sort((a,b) => b.score-a.score || b.sceneCount-a.sceneCount || a.start-b.start);
    const chosen = [];
    for (const candidate of candidates) {
      if(candidate.score<threshold)continue;
      if (chosen.every(c => Math.abs(c.start - candidate.start) >= clipLength * 1.35)) chosen.push(candidate);
      if (chosen.length === actual) break;
    }
    chosen.sort((a,b) => a.start-b.start);
    return chosen.map(({start,sceneCount,wordCount,keywordMatches,silenceRatio,energyMean,score}) => ({
      start,duration:clipLength,sceneCount,wordCount,keywordMatches,silenceRatio,energyMean,score
    }));
  }
  return Array.from({ length: actual }, (_, index) => {
    const start = actual === 1 ? Math.max(0, margin / 2) : margin * index / (actual - 1);
    const score = 42;
    return { start, duration: clipLength, score, sceneCount: 0 };
  });
}

export function aspectFilter(aspect) {
  const [width, height] = ({ '9:16': [1080,1920], '1:1': [1080,1080], '4:5': [1080,1350], '16:9': [1920,1080] })[aspect] || [1080,1920];
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
}
