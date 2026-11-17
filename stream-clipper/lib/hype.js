export class HypeMeter {
  constructor({ windowSeconds = 20, minMessages = 8, multiplier = 2.5, cooldownSeconds = 90 } = {}) {
    this.windowMs = windowSeconds * 1000;
    this.minMessages = minMessages;
    this.multiplier = multiplier;
    this.cooldownMs = cooldownSeconds * 1000;
    this.events = [];
    this.lastTrigger = 0;
    this.seen = new Set();
  }

  add({ id, user, text, at = Date.now() }) {
    if (id && this.seen.has(id)) return null;
    if (id) { this.seen.add(id); if (this.seen.size > 5000) this.seen.clear(); }
    this.events.push({ user, text: String(text || ''), at });
    this.events = this.events.filter((event) => event.at > at - this.windowMs * 6);
    const current = this.events.filter((event) => event.at > at - this.windowMs);
    if (current.length < this.minMessages || (this.lastTrigger && at - this.lastTrigger < this.cooldownMs)) return null;
    const baselineWindow = this.events.filter((event) => event.at <= at - this.windowMs && event.at > at - this.windowMs * 6);
    const baseline = baselineWindow.length / 5;
    const unique = new Set(current.map((event) => event.user).filter(Boolean)).size;
    const hype = current.filter((event) => /([A-Z]{3,}|!{2,}|\?{2,}|[😂🤣😭🔥💀👏]|\blol\b|\blmao\b)/u.test(event.text)).length;
    const rate = current.length / (this.windowMs / 1000);
    if (baseline >= 1 && current.length < baseline * this.multiplier) return null;
    if (unique < Math.max(3, Math.floor(this.minMessages * 0.4))) return null;
    this.lastTrigger = at;
    return {
      reason: `${current.length} chat messages from ${unique} people in ${Math.round(this.windowMs / 1000)}s${baseline >= 1 ? ` (${(current.length / baseline).toFixed(1)}× recent baseline)` : ''}; ${hype} high-energy reactions.`,
      count: current.length,
      unique,
      ratePerSecond: Number(rate.toFixed(2))
    };
  }
}
