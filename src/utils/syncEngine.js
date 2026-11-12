// Чистая математика синхронизации воспроизведения и барьерного старта

/**
 * Вычисляет ожидаемую позицию трека (в секундах) на момент серверного времени `serverNowMs`.
 * Поддерживает запланированный будущий старт (`anchorServerTime > serverNowMs`): до наступления
 * целевой миллисекунды позиция удерживается на `anchorPos`.
 */
export function computeExpectedPosition(playback, serverNowMs, durationSeconds = 0) {
  if (!playback || !playback.trackId) return 0;

  const anchorPos = Number(playback.anchorPos) || 0;
  const rate = Number(playback.playbackRate) || 1;
  const anchorTime = Number(playback.anchorServerTime) || serverNowMs;

  let pos = anchorPos;
  if (playback.isPlaying && playback.phase !== 'buffering') {
    const elapsedSec = Math.max(0, (serverNowMs - anchorTime) / 1000);
    pos = anchorPos + elapsedSec * rate;
  }

  if (pos < 0) pos = 0;
  if (durationSeconds > 0 && pos > durationSeconds) {
    pos = durationSeconds;
  }
  return pos;
}

/**
 * Возвращает оставшееся время (в мс) до запланированного одновременного старта трека.
 */
export function getStartCountdownMs(playback, serverNowMs) {
  if (!playback || !playback.isPlaying || playback.phase === 'buffering') return 0;
  const anchorTime = Number(playback.anchorServerTime) || 0;
  if (anchorTime <= serverNowMs) return 0;
  return Math.max(0, Math.round(anchorTime - serverNowMs));
}

/**
 * Оценивает готовность всех онлайн-участников комнаты к синхронному запуску трека `trackId`.
 */
export function evaluateBarrierReadiness(participants = [], trackId) {
  if (!trackId) {
    return {
      onlineCount: 0,
      readyCount: 0,
      allReady: false,
      waitingParticipants: [],
      avgProgress: 0
    };
  }

  const online = (participants || []).filter((p) => p && p.isOnline !== false);
  if (online.length === 0) {
    return {
      onlineCount: 0,
      readyCount: 0,
      allReady: false,
      waitingParticipants: [],
      avgProgress: 0
    };
  }

  let readyCount = 0;
  let progressSum = 0;
  const waitingParticipants = [];

  for (const p of online) {
    const isTrackReady =
      p.readyTrackId === trackId &&
      (p.status === 'ready' || p.status === 'direct-stream' || p.status === 'playing');

    const pct = isTrackReady ? 100 : Math.max(0, Math.min(99, Number(p.downloadProgress) || 0));
    progressSum += pct;

    if (isTrackReady) {
      readyCount++;
    } else {
      waitingParticipants.push({
        id: p.id,
        name: p.name || 'Слушатель',
        progress: pct,
        status: p.status || 'downloading'
      });
    }
  }

  return {
    onlineCount: online.length,
    readyCount,
    allReady: waitingParticipants.length === 0,
    waitingParticipants,
    avgProgress: Math.round(progressSum / online.length)
  };
}

/**
 * Определяет действие коррекции рассинхрона между ожидаемой и локальной позициями плеера.
 * Поддерживает настраиваемые пороги, гистерезис и плавный rate-шаг (для стабильной работы с Bluetooth/Android).
 */
export function computeDriftAction({
  expectedPos,
  actualPos,
  isPlaying,
  duration = 0,
  deadbandSec = 0.05,
  exitDeadbandSec = 0.035,
  seekThresholdSec = 0.35,
  rateDelta = 0.03,
  currentRate = 1.0,
  disableRateAdjust = false
}) {
  const safeExpected = Math.max(0, Number(expectedPos) || 0);
  const safeActual = Math.max(0, Number(actualPos) || 0);
  const drift = safeExpected - safeActual;
  const absDrift = Math.abs(drift);
  const driftMs = Math.round(drift * 1000);

  if (!isPlaying) {
    if (absDrift > 0.15) {
      return { type: 'seek', targetPos: safeExpected, rate: 1.0, driftMs };
    }
    return { type: 'none', rate: 1.0, driftMs };
  }

  if (duration > 0 && safeExpected >= Math.max(0, duration - 0.08)) {
    return { type: 'ended', rate: 1.0, driftMs };
  }

  if (absDrift > seekThresholdSec) {
    return {
      type: 'seek',
      targetPos: duration > 0 ? Math.min(safeExpected, Math.max(0, duration - 0.05)) : safeExpected,
      rate: 1.0,
      driftMs
    };
  }

  // В режиме защиты Bluetooth / мобильного звука никогда не меняем playbackRate,
  // чтобы не ломать аппаратный аудиопоток и A2DP-буфер наушников.
  if (disableRateAdjust) {
    return { type: 'none', rate: 1.0, driftMs };
  }

  const isAlreadyAdjusting = Math.abs((Number(currentRate) || 1) - 1) > 0.002;
  const triggerLimit = isAlreadyAdjusting ? Math.min(deadbandSec, exitDeadbandSec) : deadbandSec;

  if (absDrift > triggerLimit) {
    const safeDelta = Math.max(0.005, Math.min(0.08, Number(rateDelta) || 0.03));
    return {
      type: 'rate',
      rate: Number((drift > 0 ? 1 + safeDelta : 1 - safeDelta).toFixed(3)),
      driftMs
    };
  }

  return { type: 'none', rate: 1.0, driftMs };
}

/**
 * Счётчик устойчивого рассинхрона: защищает от ложных seek-перемоток при единичных
 * скачках таймера в фоне или кратковременных задержках Bluetooth A2DP.
 */
export function evaluateSustainedSeek({
  actionType,
  consecutiveCount = 0,
  requiredChecks = 3
}) {
  if (actionType !== 'seek') {
    return { shouldSeek: false, nextCount: 0 };
  }
  const nextCount = Math.max(0, Number(consecutiveCount) || 0) + 1;
  const threshold = Math.max(1, Number(requiredChecks) || 1);
  if (nextCount >= threshold) {
    return { shouldSeek: true, nextCount: 0 };
  }
  return { shouldSeek: false, nextCount };
}

/**
 * Переставляет трек `targetTrackId` сразу после текущего трека `currentTrackId` («Играть следующим»).
 */
export function moveTrackAfterCurrent(queue = [], currentTrackId, targetTrackId) {
  const list = [...(queue || [])];
  const fromIdx = list.findIndex((t) => t?.id === targetTrackId);
  if (fromIdx < 0 || targetTrackId === currentTrackId) return list;

  const [picked] = list.splice(fromIdx, 1);
  const currentIdx = currentTrackId ? list.findIndex((t) => t?.id === currentTrackId) : -1;
  const insertIdx = currentIdx >= 0 ? currentIdx + 1 : 0;
  list.splice(insertIdx, 0, picked);
  return list;
}

/**
 * Формирует приоритетный порядок фоновой предзагрузки очереди:
 * сначала ближайшие треки после текущего по кругу, затем остальные.
 */
export function buildPrefetchOrder(queue = [], currentTrackId) {
  if (!Array.isArray(queue) || queue.length === 0) return [];
  const curIdx = currentTrackId ? queue.findIndex((t) => t?.id === currentTrackId) : -1;
  if (curIdx < 0) return [...queue];

  const ordered = [];
  for (let offset = 1; offset < queue.length; offset++) {
    ordered.push(queue[(curIdx + offset) % queue.length]);
  }
  return ordered;
}
