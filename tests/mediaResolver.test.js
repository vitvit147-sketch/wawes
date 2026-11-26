import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTracksFromInput, detectMediaType } from '../src/utils/mediaUrlResolver.js';
import { toRuWsUrl } from '../src/utils/ruServerClient.js';

test('detectMediaType classifies Yandex Disk, SoundCloud, YouTube and direct audio URLs', () => {
  assert.equal(detectMediaType('https://disk.yandex.ru/d/AbCdEf123'), 'yandex');
  assert.equal(detectMediaType('https://yadi.sk/d/AbCdEf123'), 'yandex');
  assert.equal(detectMediaType('https://soundcloud.com/artist/track-name'), 'soundcloud');
  assert.equal(detectMediaType('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
  assert.equal(detectMediaType('https://cdn.example.com/song.m4a?v=1'), 'audio');
});

test('resolveTracksFromInput expands Yandex Disk folder into multiple audio tracks cleanly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const str = String(url);
    if (str.includes('resources?public_key=')) {
      return new Response(
        JSON.stringify({
          type: 'dir',
          name: 'Gym Mix',
          _embedded: {
            items: [
              { type: 'file', name: 'Stray Kids - MANIAC.mp3', media_type: 'audio', path: '/a.mp3', size: 3200000, file: 'https://downloader.disk.yandex.ru/a.mp3' },
              { type: 'file', name: 'Cover.jpg', media_type: 'image', path: '/c.jpg', size: 150000 },
              { type: 'file', name: '3RACHA - ZONE.m4a', mime_type: 'audio/mp4', path: '/b.m4a', size: 2100000 }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (str.includes('resources/download')) {
      return new Response(
        JSON.stringify({ href: 'https://downloader.disk.yandex.ru/b.m4a' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 404 });
  };

  try {
    const tracks = await resolveTracksFromInput('https://disk.yandex.ru/d/GymMix123');
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].artist, 'Stray Kids');
    assert.equal(tracks[0].title, 'MANIAC');
    assert.equal(tracks[0].album, 'Gym Mix');
    assert.equal(tracks[0].url, 'https://downloader.disk.yandex.ru/a.mp3');
    assert.equal(tracks[1].artist, '3RACHA');
    assert.equal(tracks[1].title, 'ZONE');
    assert.equal(tracks[1].url, 'https://downloader.disk.yandex.ru/b.m4a');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('toRuWsUrl converts http/https RU server URLs into WebSocket /ws endpoints', () => {
  assert.equal(toRuWsUrl('https://api.wavesync.ru'), 'wss://api.wavesync.ru/ws');
  assert.equal(toRuWsUrl('http://127.0.0.1:3080/'), 'ws://127.0.0.1:3080/ws');
  assert.equal(toRuWsUrl(''), '');
});
