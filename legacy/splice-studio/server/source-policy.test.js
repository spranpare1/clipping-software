import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, validateSourceLink } from './source-policy.js';

test('direct HTTPS media links are accepted, while page links get accurate provider guidance', () => {
  assert.equal(validateSourceLink('https://media.example.com/source.mp4').error, undefined);
  assert.equal(validateSourceLink('https://youtube.com/watch?v=abcdefghijk').provider,'youtube_portability');
  assert.equal(validateSourceLink('https://www.twitch.tv/videos/123').provider,'twitch_vod');
  assert.match(validateSourceLink('http://media.example.com/source.mp4').error, /HTTPS/);
});

test('YouTube video ids are extracted only from supported video URL forms',()=>{
  assert.equal(validateSourceLink('https://youtu.be/abcdefghijk?t=90').videoId,'abcdefghijk');
  assert.equal(validateSourceLink('https://www.youtube.com/shorts/abcdefghijk').videoId,'abcdefghijk');
  assert.ok(validateSourceLink('https://youtube.com/channel/abc').error);
});

test('Twitch clip and VOD URLs are classified while channel pages are rejected',()=>{
  const embedded=validateSourceLink('https://clips.twitch.tv/FastHelpfulClipSlug');
  assert.equal(embedded.provider,'twitch_clip');assert.equal(embedded.clipSlug,'FastHelpfulClipSlug');
  const channel=validateSourceLink('https://www.twitch.tv/somecreator/clip/FastHelpfulClipSlug?filter=clips&range=7d');
  assert.equal(channel.provider,'twitch_clip');assert.equal(channel.clipSlug,'FastHelpfulClipSlug');
  assert.match(validateSourceLink('https://www.twitch.tv/somecreator').error,/Use a Twitch Clip link/);
  assert.equal(validateSourceLink('https://www.twitch.tv/videos/123').videoId,'123');
});

test('Google Drive and Dropbox shared file URLs are normalized to download responses',()=>{
  const drive=validateSourceLink('https://drive.google.com/file/d/drive-file-123/view?usp=sharing');
  assert.equal(drive.provider,'google_drive');
  assert.equal(drive.url.hostname,'drive.google.com');
  assert.equal(drive.url.pathname,'/uc');
  assert.equal(drive.url.searchParams.get('id'),'drive-file-123');
  const dropbox=validateSourceLink('https://www.dropbox.com/scl/fi/abc/video.mp4?rlkey=secret&dl=0');
  assert.equal(dropbox.provider,'dropbox');
  assert.equal(dropbox.url.searchParams.get('dl'),'1');
});

test('URL credentials and malformed URLs are rejected', () => {
  assert.ok(validateSourceLink('bad-url').error);
  assert.match(validateSourceLink('https://user:secret@media.example.com/a.mp4').error, /credentials/);
});

test('private, loopback, link-local, multicast and documentation IPs are rejected', () => {
  for (const ip of ['127.0.0.1','10.0.0.5','172.20.1.1','192.168.1.2','169.254.2.3','100.64.0.1','224.0.0.1','::1','fd00::1','fe80::1','2001:db8::1','::ffff:192.168.0.1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
