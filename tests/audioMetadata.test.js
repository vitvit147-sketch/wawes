import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrackFilename,
  detectFormatLabel,
  formatBytes,
  formatDuration,
  estimateBitrateKbps
} from '../src/utils/audioMetadata.js';

test('parseTrackFilename splits Artist - Title cleanly', () => {
  assert.deepEqual(parseTrackFilename('M83 - Midnight_City.flac'), {
    artist: 'M83',
    title: 'Midnight City'
  });
  assert.deepEqual(parseTrackFilename('Track_01.wav'), {
    artist: 'Локальный файл',
    title: 'Track 01'
  });
});

test('detectFormatLabel detects lossless and lossy audio formats', () => {
  assert.equal(detectFormatLabel('song.flac', ''), 'FLAC');
  assert.equal(detectFormatLabel('master.WAV', ''), 'WAV');
  assert.equal(detectFormatLabel('unknown', 'audio/mpeg'), 'MP3');
  assert.equal(detectFormatLabel('voice.m4a', 'audio/mp4'), 'M4A');
});

test('formatBytes and formatDuration produce readable strings', () => {
  assert.equal(formatBytes(512), '512 Б');
  assert.equal(formatBytes(2048), '2 КБ');
  assert.equal(formatBytes(31457280), '30.0 МБ');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3665), '1:01:05');
});

test('estimateBitrateKbps computes expected kbps', () => {
  // 4 MB over 100s = 4 * 1024 * 1024 * 8 / 100 / 1000 ~= 336 kbps
  const kbps = estimateBitrateKbps(4 * 1024 * 1024, 100);
  assert.equal(kbps, 336);
  assert.equal(estimateBitrateKbps(1000, 0), null);
});
