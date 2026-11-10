import test from 'node:test';
import assert from 'node:assert/strict';
import { computeExpectedPosition, computeDriftAction } from '../src/utils/syncEngine.js';

test('computeExpectedPosition returns 0 when no trackId', () => {
  assert.equal(computeExpectedPosition(null, 10000, 120), 0);
  assert.equal(computeExpectedPosition({ trackId: null, isPlaying: true }, 10000, 120), 0);
});

test('computeExpectedPosition holds anchorPos while paused', () => {
  const pos = computeExpectedPosition(
    { trackId: 't1', isPlaying: false, anchorPos: 42.5, anchorServerTime: 1000 },
    99000,
    180
  );
  assert.equal(pos, 42.5);
});

test('computeExpectedPosition advances accurately while playing and clamps to duration', () => {
  const pos = computeExpectedPosition(
    { trackId: 't1', isPlaying: true, anchorPos: 10, anchorServerTime: 10000, playbackRate: 1 },
    15500,
    180
  );
  assert.equal(pos, 15.5);

  const clamped = computeExpectedPosition(
    { trackId: 't1', isPlaying: true, anchorPos: 170, anchorServerTime: 10000, playbackRate: 1 },
    25000,
    180
  );
  assert.equal(clamped, 180);
});

test('computeDriftAction stays neutral inside 50ms deadband', () => {
  const action = computeDriftAction({
    expectedPos: 30.04,
    actualPos: 30.0,
    isPlaying: true,
    duration: 200
  });
  assert.equal(action.type, 'none');
  assert.equal(action.rate, 1.0);
});

test('computeDriftAction adjusts playbackRate gently for 50..350ms drift', () => {
  const behind = computeDriftAction({
    expectedPos: 30.2,
    actualPos: 30.0,
    isPlaying: true,
    duration: 200
  });
  assert.equal(behind.type, 'rate');
  assert.equal(behind.rate, 1.03);

  const ahead = computeDriftAction({
    expectedPos: 30.0,
    actualPos: 30.2,
    isPlaying: true,
    duration: 200
  });
  assert.equal(ahead.type, 'rate');
  assert.equal(ahead.rate, 0.97);
});

test('computeDriftAction performs hard seek when drift > 350ms', () => {
  const action = computeDriftAction({
    expectedPos: 45.0,
    actualPos: 44.1,
    isPlaying: true,
    duration: 200
  });
  assert.equal(action.type, 'seek');
  assert.equal(action.targetPos, 45.0);
});

test('computeDriftAction signals ended near track end only while playing', () => {
  const playingEnd = computeDriftAction({
    expectedPos: 199.95,
    actualPos: 199.9,
    isPlaying: true,
    duration: 200
  });
  assert.equal(playingEnd.type, 'ended');

  const pausedEnd = computeDriftAction({
    expectedPos: 199.95,
    actualPos: 199.95,
    isPlaying: false,
    duration: 200
  });
  assert.equal(pausedEnd.type, 'none');
});
