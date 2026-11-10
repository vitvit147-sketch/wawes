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
 * - до 50 мс: идеальный синхрон (не вмешиваемся)
 * - 50..350 мс: плавно подкручиваем playbackRate (0.97 / 1.03) без рывков
 * - > 350 мс: мгновенный seek в RAM (0 мс задержка для Blob URL)
 */
export function computeDriftAction({ expectedPos, actualPos, isPlaying, duration = 0 }) {
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

  if (absDrift > 0.35) {
    return {
      type: 'seek',
      targetPos: duration > 0 ? Math.min(safeExpected, Math.max(0, duration - 0.05)) : safeExpected,
      rate: 1.0,
      driftMs
    };
  }

  if (absDrift > 0.05) {
    return {
      type: 'rate',
      rate: drift > 0 ? 1.03 : 0.97,
      driftMs
    };
  }

  return { type: 'none', rate: 1.0, driftMs };
}
