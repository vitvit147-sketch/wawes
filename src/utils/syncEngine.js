// Чистая математика синхронизации позиции воспроизведения

/**
 * Вычисляет ожидаемую позицию трека (в секундах) на момент серверного времени `serverNowMs`.
 */
export function computeExpectedPosition(playback, serverNowMs, durationSeconds = 0) {
  if (!playback || !playback.trackId) return 0;

  const anchorPos = Number(playback.anchorPos) || 0;
  const rate = Number(playback.playbackRate) || 1;
  const anchorTime = Number(playback.anchorServerTime) || serverNowMs;

  let pos = anchorPos;
  if (playback.isPlaying) {
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
 * Определяет действие коррекции рассинхрона между ожидаемой и локальной позициями плеера.
 * - до 50 мс: не вмешиваемся (незаметно и без щелчков)
 * - 50..350 мс: плавно подкручиваем playbackRate (0.97 / 1.03)
 * - > 350 мс: мгновенный seek к точной позиции
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

  if (absDrift > 0.8) {
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
