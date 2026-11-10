export function requestedCount(value, durationSeconds) {
  if (value === 'auto') return Math.min(20, Math.max(1, Math.floor(durationSeconds / 150)));
  return Math.min(50, Math.max(1, Number(value) || 5));
}

export function selectMoments(duration, requested, preferred, sceneCuts = []) {
  const length = Math.max(10, Math.min(90, Number(preferred) || 35));
  const possible = duration < length ? 0 : 1 + Math.floor((duration - length) / (length * 1.35));
  const count = requestedCount(requested, duration);
  const actual = Math.min(count, possible);
  const clipLength = Math.min(length, duration);
  const margin = Math.max(0, duration - clipLength);
  const hasSceneSignal = sceneCuts.length > 0;
  let candidates;
  if (hasSceneSignal && actual) {
    const step = Math.max(5, Math.min(15, length / 4));
    candidates = [];
    for (let start = 0; start <= margin; start += step) {
      const sceneCount = sceneCuts.filter(t => t >= start && t < start + clipLength).length;
      candidates.push({ start, sceneCount });
    }
    candidates.sort((a,b) => b.sceneCount - a.sceneCount || a.start - b.start);
    const chosen = [];
    for (const candidate of candidates) {
      if (chosen.every(c => Math.abs(c.start - candidate.start) >= clipLength * 1.35)) chosen.push(candidate);
      if (chosen.length === actual) break;
    }
    if (chosen.length < actual) {
      for (let i = 0; i < actual && chosen.length < actual; i++) {
        const start = actual === 1 ? margin / 2 : margin * i / (actual - 1);
        if (chosen.every(c => Math.abs(c.start - start) >= clipLength * 1.35)) chosen.push({ start, sceneCount: 0 });
      }
    }
    chosen.sort((a,b) => a.start-b.start);
    return chosen.map(({start,sceneCount},index) => ({
      start, duration: clipLength, sceneCount,
      score: Math.max(54, Math.min(92, 63 + sceneCount * 2 + Math.round(2 * Math.sin((start / Math.max(duration,1)) * Math.PI)) - (index % 3)))
    }));
  }
  return Array.from({ length: actual }, (_, index) => {
    const start = actual === 1 ? Math.max(0, margin / 2) : margin * index / (actual - 1);
    const score = Math.max(54, Math.min(76, 67 + Math.round(2 * Math.sin((start / Math.max(duration, 1)) * Math.PI)) - (index % 3)));
    return { start, duration: clipLength, score, sceneCount: 0 };
  });
}

export function aspectFilter(aspect) {
  const [width, height] = ({ '9:16': [1080,1920], '1:1': [1080,1080], '4:5': [1080,1350], '16:9': [1920,1080] })[aspect] || [1080,1920];
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
}
