const WEIGHTS = {
  chat_activity: 0.64,
  chat_repetition: 0.67,
  chat_emote_spam: 0.66,
  audio_peak: 0.76,
  streamer_clip_request: 0.95,
  poll_interaction: 0.8,
  emotional_reaction: 0.88,
  speech_reaction: 0.45
};

export class MomentScorer {
  constructor({ windowSeconds = 45, threshold = 0.62 } = {}) {
    this.windowMs = windowSeconds * 1000;
    this.threshold = threshold;
    this.events = [];
  }

  add({ type, source, reason, at = Date.now() }) {
    const strength = WEIGHTS[type] || 0.5;
    this.events = this.events.filter((event) => at - event.at <= this.windowMs);
    this.events.push({ type, source, reason, strength, at });
    const byType = new Map();
    for (const event of this.events) {
      const previous = byType.get(event.type);
      if (!previous || event.at > previous.at) byType.set(event.type, event);
    }
    const active = [...byType.values()];
    const independentSources = new Set(active.map((event) => event.source)).size;
    const combined = 1 - active.reduce((remaining, event) => remaining * (1 - event.strength), 1);
    const overlapBonus = Math.max(0, independentSources - 1) * 0.09 + Math.max(0, active.length - independentSources) * 0.025;
    const score = Math.min(1, combined + overlapBonus);
    return {
      score: Math.round(score * 100),
      qualifies: score >= this.threshold,
      events: active.map(({ type: eventType, source: eventSource, reason: eventReason }) => ({ type: eventType, source: eventSource, reason: eventReason })),
      reason: `${active.map((event) => event.reason).join(' + ')}${independentSources > 1 ? ` · ${independentSources} independent signal sources overlap` : ''}`
    };
  }
}

export class AudioPeakDetector {
  constructor({ thresholdDb = -8, sampleCount = 6, windowMs = 1400, cooldownMs = 75000 } = {}) {
    this.thresholdDb = thresholdDb;
    this.sampleCount = sampleCount;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.peaks = [];
    this.lastTrigger = 0;
  }

  add({ inputName, multiplier, at = Date.now() }) {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
    const db = 20 * Math.log10(multiplier);
    this.peaks = this.peaks.filter((peak) => peak.at > at - this.windowMs);
    if (db >= this.thresholdDb) this.peaks.push({ at, db });
    if (this.peaks.length < this.sampleCount || (this.lastTrigger && at - this.lastTrigger < this.cooldownMs)) return null;
    this.lastTrigger = at;
    const peakDb = Math.max(...this.peaks.map((peak) => peak.db));
    return { type: 'audio_peak', source: 'audio', reason: `Loud audio burst on “${inputName}” peaked at ${peakDb.toFixed(0)} dBFS.` };
  }
}
