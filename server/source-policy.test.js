import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, validateSourceLink } from './source-policy.js';

test('direct HTTPS media links are accepted, while page links get accurate provider guidance', () => {
  assert.equal(validateSourceLink('https://media.example.com/source.mp4').error, undefined);
  assert.match(validateSourceLink('https://youtube.com/watch?v=abc').error, /official API/);
  assert.match(validateSourceLink('https://www.twitch.tv/videos/123').error, /Video Producer/);
  assert.match(validateSourceLink('http://media.example.com/source.mp4').error, /HTTPS/);
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
