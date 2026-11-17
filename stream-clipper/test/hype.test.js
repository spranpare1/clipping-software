import test from 'node:test';
import assert from 'node:assert/strict';
import { HypeMeter } from '../lib/hype.js';

test('triggers an explainable spike with enough distinct chatters', () => {
  const meter = new HypeMeter({ windowSeconds: 20, minMessages: 5, multiplier: 2.5, cooldownSeconds: 60 });
  let result;
  for (let i = 0; i < 5; i++) result = meter.add({ id: `m${i}`, user: `u${i}`, text: i % 2 ? 'LOL!!!' : 'wow', at: 1000 + i * 100 });
  assert.ok(result);
  assert.match(result.reason, /5 chat messages from 5 people/);
  assert.match(result.reason, /high-energy reactions/);
});

test('ignores duplicate messages and duplicate spikes during cooldown', () => {
  const meter = new HypeMeter({ windowSeconds: 20, minMessages: 3, cooldownSeconds: 60 });
  meter.add({ id: 'same', user: 'a', text: 'hello', at: 1000 });
  meter.add({ id: 'same', user: 'a', text: 'hello again', at: 1100 });
  const second = meter.add({ id: 'm2', user: 'b', text: 'hey', at: 1200 });
  assert.equal(second, null);
  const spike = meter.add({ id: 'm3', user: 'c', text: 'LET GOOO', at: 1300 });
  assert.ok(spike);
  assert.equal(meter.add({ id: 'm4', user: 'd', text: 'YES!!!!', at: 1400 }), null);
});

test('requires a minimum set of unique chatters', () => {
  const meter = new HypeMeter({ windowSeconds: 20, minMessages: 4, cooldownSeconds: 0 });
  let signal;
  for (let i = 0; i < 10; i++) signal = meter.add({ id: `m${i}`, user: i < 2 ? 'same-user' : 'another-user', text: 'lol', at: 1000 + i * 50 });
  assert.equal(signal, null);
});
