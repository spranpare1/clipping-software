import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPeakDetector, MomentScorer } from '../lib/moments.js';

test('a single qualified moment is explainable and overlap raises its score', () => {
  const scorer = new MomentScorer();
  const chat = scorer.add({ type: 'chat_activity', source: 'chat', reason: 'Chat messages spiked', at: 1000 });
  assert.equal(chat.qualifies, true);
  const overlap = scorer.add({ type: 'audio_peak', source: 'audio', reason: 'Streamer audio peaked', at: 1100 });
  assert.equal(overlap.qualifies, true);
  assert.ok(overlap.score > chat.score);
  assert.match(overlap.reason, /independent signal sources overlap/);
});

test('audio peak detector requires a sustained burst and reports its threshold', () => {
  const detector = new AudioPeakDetector({ thresholdDb: -8, sampleCount: 4, cooldownMs: 10000 });
  for (let i = 0; i < 3; i++) assert.equal(detector.add({ inputName: 'Mic', multiplier: 0.5, at: 1000 + i * 100 }), null);
  const signal = detector.add({ inputName: 'Mic', multiplier: 0.5, at: 1300 });
  assert.match(signal.reason, /Mic/);
  assert.match(signal.reason, /-6 dBFS/);
  assert.equal(detector.add({ inputName: 'Mic', multiplier: 0.5, at: 1400 }), null);
});
