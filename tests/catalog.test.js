import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_PRESETS } from '../src/utils/mediaUrlResolver.js';

const MUSIC_DIR = path.resolve('public/music');
const ALLOWED_CATEGORIES = new Set(['hits', 'albums', 'solo', '3racha']);

test('catalog contains complete Stray Kids discography with valid categories and local audio assets', () => {
  assert.ok(DEMO_PRESETS.length >= 100, `Expected >=100 tracks, got ${DEMO_PRESETS.length}`);

  const ids = new Set();
  const urls = new Set();

  for (const track of DEMO_PRESETS) {
    assert.ok(track.id && !ids.has(track.id), `Duplicate or missing id: ${track.id}`);
    ids.add(track.id);

    assert.ok(track.url && !urls.has(track.url), `Duplicate or missing url: ${track.url}`);
    urls.add(track.url);

    assert.ok(track.title && track.title.trim().length > 0, `Empty title on ${track.id}`);
    assert.ok(track.album && track.album.trim().length > 0, `Empty album on ${track.id}`);
    assert.ok(ALLOWED_CATEGORIES.has(track.category), `Invalid category "${track.category}" on ${track.id}`);
    assert.ok(track.duration > 0, `Invalid duration on ${track.id}`);
    assert.ok(track.sizeBytes > 30000, `Suspiciously small sizeBytes on ${track.id}`);

    const fileName = track.url.replace(/^\.\/music\//, '');
    const fullPath = path.join(MUSIC_DIR, fileName);
    assert.ok(fs.existsSync(fullPath), `Missing audio file on disk: ${fullPath}`);
    assert.ok(fs.statSync(fullPath).size === track.sizeBytes, `Size mismatch on ${fileName}`);
  }
});
