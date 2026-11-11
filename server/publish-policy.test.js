import test from 'node:test';
import assert from 'node:assert/strict';
import { publishingIdempotencyKey, tiktokChunkPlan } from './publish-policy.js';

test('TikTok chunk plan combines trailing bytes in the last chunk',()=>{
  const plan=tiktokChunkPlan(50_000_123);
  assert.equal(plan.chunkSize,10_000_000);
  assert.equal(plan.total,5);
  assert.deepEqual(Array.from({length:plan.total},(_,index)=>plan.lengthAt(index*plan.chunkSize)),[10_000_000,10_000_000,10_000_000,10_000_000,10_000_123]);
});

test('small TikTok media uploads as one whole chunk and invalid sizes fail',()=>{
  const plan=tiktokChunkPlan(4_000_000);
  assert.equal(plan.total,1);
  assert.equal(plan.chunkSize,4_000_000);
  assert.equal(plan.lengthAt(0),4_000_000);
  assert.throws(()=>tiktokChunkPlan(0),/positive safe integer/);
});

test('publishing idempotency is stable and destination/schedule-specific',()=>{
  const key=publishingIdempotencyKey('clip-a','account-a','immediate');
  assert.equal(key,publishingIdempotencyKey('clip-a','account-a','immediate'));
  assert.notEqual(key,publishingIdempotencyKey('clip-a','account-b','immediate'));
  assert.notEqual(key,publishingIdempotencyKey('clip-a','account-a','tomorrow'));
});
