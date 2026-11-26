// Беззвучная разблокировка единого HTML5 <audio> элемента внутри пользовательского жеста
// (критично для iOS Safari / iPadOS и строгих мобильных браузеров при входе по ссылке).

// Минимальный валидный WAV с 1 сэмплом тишины (~68 байт)
const SILENT_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export function unlockAudioElement(audio) {
  if (!audio || typeof audio.play !== 'function') return;

  // Если уже загружен настоящий трек — не трогаем src
  const currentSrc = audio.getAttribute('src') || '';
  if (currentSrc && !currentSrc.startsWith('data:audio/wav')) {
    return;
  }

  const prevMuted = audio.muted;
  try {
    audio.muted = true;
    if (!currentSrc) {
      audio.src = SILENT_WAV_DATA_URL;
    }
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        // Не сбрасываем src, если за время промиса уже подставили реальный трек
        if ((audio.getAttribute('src') || '').startsWith('data:audio/wav')) {
          audio.pause();
        }
        audio.muted = prevMuted;
      }).catch(() => {
        audio.muted = prevMuted;
      });
    } else {
      audio.pause();
      audio.muted = prevMuted;
    }
  } catch {
    audio.muted = prevMuted;
  }
}
