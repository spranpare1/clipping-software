import test from 'node:test';
import assert from 'node:assert/strict';
import { aspectFilter, requestedCount, selectMoments } from './engine.js';

test('clip count presets and custom values are bounded', () => {
  assert.equal(requestedCount('3', 1200), 3);
  assert.equal(requestedCount('auto', 3000), 20);
  assert.equal(requestedCount('999', 1200), 50);
});

test('selector returns fewer clips than requested when source capacity is low', () => {
  assert.equal(selectMoments(60, '5', 35).length, 1);
  assert.equal(selectMoments(20, '5', 35).length, 0);
  assert.equal(selectMoments(600, '5', 35).length, 5);
});

test('clip candidates are spaced, in-bounds, deterministic and source timestamp based', () => {
  const clips = selectMoments(240, '5', 30);
  assert.deepEqual(clips, selectMoments(240, '5', 30));
  assert.equal(clips.length, 5);
  for (const clip of clips) {
    assert.ok(clip.start >= 0);
    assert.ok(clip.start + clip.duration <= 240);
  }
  assert.ok(clips.slice(1).every((clip, i) => clip.start >= clips[i].start + clips[i].duration));
});

test('scene-dense source intervals rank ahead of fallback intervals', () => {
  const clips = selectMoments(600, '3', 35, [100,105,115,120,125,400,410,420]);
  assert.equal(clips.length, 3);
  const dense = clips.find(c => c.sceneCount >= 5);
  assert.ok(dense);
  assert.ok(dense.start >= 80 && dense.start <= 130);
  assert.ok(dense.score > Math.max(...clips.filter(c => c !== dense).map(c => c.score)));
});

test('all supported aspect ratios render inside a correctly sized padded canvas', () => {
  assert.match(aspectFilter('9:16'), /pad=1080:1920/);
  assert.match(aspectFilter('1:1'), /pad=1080:1080/);
  assert.match(aspectFilter('4:5'), /pad=1080:1350/);
  assert.match(aspectFilter('16:9'), /pad=1920:1080/);
  assert.match(aspectFilter('unknown'), /pad=1080:1920/);
});
