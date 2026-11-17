import crypto from 'node:crypto';

export function tiktokChunkPlan(size,targetChunkSize=10_000_000){
  if(!Number.isSafeInteger(size)||size<=0)throw new Error('Video size must be a positive safe integer.');
  const chunkSize=Math.min(targetChunkSize,size),total=Math.max(1,Math.floor(size/chunkSize));
  return {chunkSize,total,lengthAt(offset){if(!Number.isSafeInteger(offset)||offset<0||offset>=size)return 0;const index=Math.floor(offset/chunkSize);return index>=total-1?size-offset:chunkSize;}};
}

export function publishingIdempotencyKey(clipId,accountId,deliveryKey){
  return crypto.createHash('sha256').update(`${clipId}|${accountId}|${deliveryKey}`).digest('hex');
}
