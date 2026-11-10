import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExpectedPosition,
  computeDriftAction,
  getStartCountdownMs,
  evaluateBarrierReadiness,
  moveTrackAfterCurrent,
  buildPrefetchOrder
} from '../src/utils/syncEngine.js';

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

test('computeExpectedPosition and getStartCountdownMs honor scheduled future start and buffering phase', () => {
  const scheduled = {
    trackId: 't1',
    phase: 'playing',
    isPlaying: true,
    anchorPos: 12,
    anchorServerTime: 10650,
    playbackRate: 1
  };
  assert.equal(computeExpectedPosition(scheduled, 10200, 180), 12);
  assert.equal(getStartCountdownMs(scheduled, 10200), 450);
  assert.equal(getStartCountdownMs(scheduled, 10650), 0);
  assert.equal(computeExpectedPosition(scheduled, 11650, 180), 13);

  const buffering = {
    trackId: 't1',
    phase: 'buffering',
    isPlaying: true,
    anchorPos: 5,
    anchorServerTime: 9000
  };
  assert.equal(computeExpectedPosition(buffering, 15000, 180), 5);
  assert.equal(getStartCountdownMs(buffering, 8500), 0);
});

test('evaluateBarrierReadiness tracks online participants waiting and readiness accurately', () => {
  const hostReadyTabletDownloading = [
    { id: 'u1', name: 'Хост', isOnline: true, status: 'ready', readyTrackId: 't1', downloadProgress: 100 },
    { id: 'u2', name: 'Планшет', isOnline: true, status: 'downloading', readyTrackId: null, downloadProgress: 60 },
    { id: 'u3', name: 'Ушёл', isOnline: false, status: 'offline', readyTrackId: null, downloadProgress: 0 }
  ];

  const partial = evaluateBarrierReadiness(hostReadyTabletDownloading, 't1');
  assert.equal(partial.onlineCount, 2);
  assert.equal(partial.readyCount, 1);
  assert.equal(partial.allReady, false);
  assert.equal(partial.avgProgress, 80);
  assert.equal(partial.waitingParticipants.length, 1);
  assert.equal(partial.waitingParticipants[0].name, 'Планшет');

  const bothReady = [
    { id: 'u1', name: 'Хост', isOnline: true, status: 'ready', readyTrackId: 't1', downloadProgress: 100 },
    { id: 'u2', name: 'Планшет', isOnline: true, status: 'direct-stream', readyTrackId: 't1', downloadProgress: 100 }
  ];
  const full = evaluateBarrierReadiness(bothReady, 't1');
  assert.equal(full.allReady, true);
  assert.equal(full.readyCount, 2);
  assert.equal(full.avgProgress, 100);
});

test('moveTrackAfterCurrent moves chosen track immediately after current track regardless of direction', () => {
  const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  // Перемещение трека с конца сразу после первого
  const movedForward = moveTrackAfterCurrent(q, 'a', 'd');
  assert.deepEqual(
    movedForward.map((t) => t.id),
    ['a', 'd', 'b', 'c']
  );

  // Перемещение раннего трека после середины списка
  const movedFromBefore = moveTrackAfterCurrent(q, 'c', 'a');
  assert.deepEqual(
    movedFromBefore.map((t) => t.id),
    ['b', 'c', 'a', 'd']
  );

  // Ничего не играет — ставится первым
  const movedWhenIdle = moveTrackAfterCurrent(q, null, 'c');
  assert.deepEqual(
    movedWhenIdle.map((t) => t.id),
    ['c', 'a', 'b', 'd']
  );
});

test('buildPrefetchOrder prioritizes upcoming tracks wrapping circularly after current', () => {
  const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const order = buildPrefetchOrder(q, 'c');
  assert.deepEqual(
    order.map((t) => t.id),
    ['d', 'a', 'b']
  );
});
