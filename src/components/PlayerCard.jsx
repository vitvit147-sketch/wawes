import React, { useRef, useEffect, useState } from 'react';
import ReactPlayer from 'react-player';
import { getServerNow } from '../utils/firebase';
import { computeExpectedPosition, getStartCountdownMs } from '../utils/syncEngine';
import { formatDuration, formatBytes } from '../utils/audioMetadata';
import AudioWaveVisualizer from './AudioWaveVisualizer';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Wifi,
  Radio,
  Sparkles,
  Music,
  Download,
  CheckCircle2,
  Clock,
  Zap,
  ShieldCheck
} from 'lucide-react';

function YouTubeIcon({ className = 'w-3 h-3 text-red-400' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

export default function PlayerCard({
  playerRef,
  room,
  isHost,
  firebaseStatus,
  currentTrack,
  playback,
  settings,
  displayTime,
  effectiveDuration,
  driftMs,
  volume,
  isMuted,
  queueLength,
  autoplayBlocked,
  isBuffering,
  downloadState,
  barrierState,
  countdownMs,
  nextTrackPrefetchInfo,
  onUnlockAutoplay,
  onPrevTrack,
  onPlayOrPause,
  onNextTrack,
  onCycleRepeat,
  onToggleWaitForListeners,
  onForceStartNow,
  onSeekChange,
  onSeekCommit,
  onToggleMute,
  onVolumeChange,
  onPlayerProgress,
  onPlayerDuration,
  onPlayerEnded,
  onPlayerReady,
  onPlayerBuffer,
  onPlayerBufferEnd,
  onPlayerError
}) {
  const isYouTube = currentTrack?.source === 'youtube';
  const isSoundCloud = currentTrack?.source === 'soundcloud';

  // Для прямого аудио берем предзагруженный Blob URL из RAM, как только он готов
  const isAudioForCurrentTrack =
    !isSoundCloud &&
    currentTrack?.id &&
    downloadState?.trackId === currentTrack.id &&
    Boolean(downloadState?.playableUrl);

  const playableAudioSrc = isAudioForCurrentTrack ? downloadState.playableUrl : '';

  const audioElRef = useRef(null);
  const soundcloudPlayerRef = useRef(null);
  const loadedTrackIdRef = useRef(null);
  const launchTimerRef = useRef(null);
  const rafLaunchRef = useRef(null);
  const pendingSeekRef = useRef(null);

  const [audioPausedState, setAudioPausedState] = useState(true);

  const clearScheduledLaunch = () => {
    if (launchTimerRef.current) {
      clearTimeout(launchTimerRef.current);
      launchTimerRef.current = null;
    }
    if (rafLaunchRef.current) {
      cancelAnimationFrame(rafLaunchRef.current);
      rafLaunchRef.current = null;
    }
  };

  // Единый адаптер для цикла синхронизации в RoomScreen
  useEffect(() => {
    if (playerRef) {
      playerRef.current = {
        getCurrentTime: () => {
          if (isSoundCloud) {
            return soundcloudPlayerRef.current?.getCurrentTime() || 0;
          }
          return audioElRef.current?.currentTime || 0;
        },
        seekTo: (sec) => {
          if (isSoundCloud) {
            soundcloudPlayerRef.current?.seekTo(sec, 'seconds');
          } else if (audioElRef.current) {
            if (audioElRef.current.readyState >= 1) {
              try {
                audioElRef.current.currentTime = Math.max(0, sec);
              } catch {}
            } else {
              pendingSeekRef.current = Math.max(0, sec);
            }
          }
        },
        setPlaybackRate: (rate) => {
          if (!isSoundCloud && audioElRef.current) {
            audioElRef.current.playbackRate = rate;
          }
        },
        isPaused: () => {
          if (isSoundCloud) return !playback?.isPlaying;
          return audioElRef.current ? audioElRef.current.paused : true;
        },
        isTrackLoaded: (trackId) => {
          if (isSoundCloud) return Boolean(currentTrack?.id === trackId);
          return Boolean(
            audioElRef.current &&
              audioElRef.current.readyState >= 1 &&
              loadedTrackIdRef.current === trackId
          );
        },
        resumePlayback: () => {
          if (!isSoundCloud && audioElRef.current && playableAudioSrc) {
            audioElRef.current.play().catch((err) => onPlayerError?.(err));
          }
        }
      };
    }
  });

  // Отдельный эффект только для громкости — не сбрасывает воспроизведение и seek!
  useEffect(() => {
    if (audioElRef.current) {
      audioElRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Смена src у постоянного <audio> DOM-элемента (не размонтируем элемент для сохранения autoplay на планшетах)
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;

    if (isSoundCloud || !playableAudioSrc) {
      loadedTrackIdRef.current = null;
      pendingSeekRef.current = null;
      if (audio.getAttribute('src')) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      return;
    }

    if (audio.src !== playableAudioSrc) {
      loadedTrackIdRef.current = null;
      audio.pause();
      audio.src = playableAudioSrc;
      audio.load();
    }
  }, [playableAudioSrc, isSoundCloud]);

  // Управление барьерным запуском (будущий anchorServerTime), паузой и входом в середину трека
  useEffect(() => {
    const audio = audioElRef.current;
    clearScheduledLaunch();

    if (!audio || isSoundCloud) return;

    if (!playableAudioSrc || !currentTrack?.id) {
      audio.pause();
      return;
    }

    const isBarrierBuffering = playback?.phase === 'buffering';
    if (isBarrierBuffering || !playback?.isPlaying) {
      audio.pause();
      const targetPos = Number(playback?.anchorPos) || 0;
      if (audio.readyState >= 1) {
        if (Math.abs(audio.currentTime - targetPos) > 0.05) {
          try {
            audio.currentTime = targetPos;
          } catch {}
        }
      } else {
        pendingSeekRef.current = targetPos;
      }
      return;
    }

    // Точный запуск воспроизведения (по расписанию или сразу в текущую точку)
    const startPlaybackSynced = () => {
      const serverNow = getServerNow();
      const expected = computeExpectedPosition(playback, serverNow, effectiveDuration);

      if (audio.readyState >= 1) {
        if (Math.abs(audio.currentTime - expected) > 0.08) {
          try {
            audio.currentTime = expected;
          } catch {}
        }
      } else {
        pendingSeekRef.current = expected;
      }

      const playPromise = audio.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch((err) => {
          console.warn('Audio play prevented by browser policy:', err);
          onPlayerError?.(err);
        });
      }
    };

    const delayMs = getStartCountdownMs(playback, getServerNow());
    if (delayMs > 25) {
      // Готовим позицию заранее и ждём точной миллисекунды синхро-старта
      const prePos = Number(playback?.anchorPos) || 0;
      audio.pause();
      if (audio.readyState >= 1 && Math.abs(audio.currentTime - prePos) > 0.05) {
        try {
          audio.currentTime = prePos;
        } catch {}
      } else if (audio.readyState < 1) {
        pendingSeekRef.current = prePos;
      }

      const wakeDelay = Math.max(0, delayMs - 20);
      launchTimerRef.current = setTimeout(() => {
        const waitFrame = () => {
          const left = getStartCountdownMs(playback, getServerNow());
          if (left <= 6) {
            startPlaybackSynced();
          } else {
            rafLaunchRef.current = requestAnimationFrame(waitFrame);
          }
        };
        waitFrame();
      }, wakeDelay);
    } else {
      startPlaybackSynced();
    }

    return () => clearScheduledLaunch();
  }, [
    playableAudioSrc,
    currentTrack?.id,
    playback?.phase,
    playback?.isPlaying,
    playback?.trackId,
    playback?.actionNonce,
    playback?.anchorServerTime,
    playback?.anchorPos,
    isSoundCloud
  ]);

  const showDownloadBar =
    currentTrack &&
    !isSoundCloud &&
    (downloadState?.stage === 'downloading' ||
      playback?.phase === 'buffering' ||
      countdownMs > 0);

  const downloadPct = downloadState?.trackId === currentTrack?.id ? downloadState.percent || 0 : 0;
  const isMemoryCached =
    downloadState?.trackId === currentTrack?.id && downloadState?.stage === 'ready';

  return (
    <section className="rounded-3xl bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-indigo-950/60 border border-white/12 p-5 sm:p-6 shadow-2xl relative overflow-hidden">
      {/* Постоянно смонтированный <audio> элемент — гарантирует стабильный автоплей на планшетах и мобильных */}
      <audio
        ref={audioElRef}
        preload="auto"
        playsInline
        className="hidden"
        onLoadedMetadata={(e) => {
          loadedTrackIdRef.current = currentTrack?.id || null;
          onPlayerDuration?.(e.target.duration);
          if (pendingSeekRef.current !== null) {
            try {
              e.target.currentTime = pendingSeekRef.current;
            } catch {}
            pendingSeekRef.current = null;
          }
        }}
        onCanPlay={(e) => {
          loadedTrackIdRef.current = currentTrack?.id || null;
          if (pendingSeekRef.current !== null) {
            try {
              e.target.currentTime = pendingSeekRef.current;
            } catch {}
            pendingSeekRef.current = null;
          }
          onPlayerReady?.();
        }}
        onWaiting={() => onPlayerBuffer?.()}
        onPlaying={() => {
          setAudioPausedState(false);
          onPlayerBufferEnd?.();
        }}
        onPause={() => setAudioPausedState(true)}
        onDurationChange={(e) => onPlayerDuration?.(e.target.duration)}
        onEnded={() => onPlayerEnded?.()}
        onError={(e) => {
          if (playableAudioSrc) {
            console.warn('Native audio error:', e);
            onPlayerError?.(e);
          }
        }}
      />

      {/* Виджет для SoundCloud */}
      {isSoundCloud && currentTrack?.url && (
        <div className="mb-5 w-full rounded-2xl overflow-hidden shadow-lg border border-white/10 bg-black/70">
          <ReactPlayer
            ref={soundcloudPlayerRef}
            url={currentTrack.url}
            playing={Boolean(playback?.isPlaying && playback?.phase !== 'buffering')}
            volume={isMuted ? 0 : volume}
            muted={isMuted}
            playbackRate={playback?.playbackRate || 1.0}
            width="100%"
            height="160px"
            playsinline
            progressInterval={400}
            onProgress={onPlayerProgress}
            onDuration={onPlayerDuration}
            onEnded={onPlayerEnded}
            onReady={onPlayerReady}
            onBuffer={onPlayerBuffer}
            onBufferEnd={onPlayerBufferEnd}
            onError={onPlayerError}
            config={{
              soundcloud: {
                options: {
                  auto_play: false,
                  show_artwork: true,
                  visual: true,
                  color: '#0284c7'
                }
              }
            }}
          />
        </div>
      )}

      {/* Верхний статус-бар */}
      <div className="flex items-center justify-between gap-2.5 mb-5 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-slate-300">
            {isHost ? (
              <>
                <Radio className="w-3.5 h-3.5 text-sky-400" />
                <span>Вы Хост</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Слушатель · {room?.hostName || 'Хост'}</span>
              </>
            )}
          </div>

          {isHost && (
            <button
              type="button"
              onClick={onToggleWaitForListeners}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer ${
                settings?.waitForListeners !== false
                  ? 'bg-sky-500/15 text-sky-300 border-sky-400/35 hover:bg-sky-500/25'
                  : 'bg-slate-800/80 text-slate-400 border-white/10 hover:text-slate-200'
              }`}
              title="Если включено — трек стартует одновременно только после полной загрузки на всех устройствах"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                {settings?.waitForListeners !== false
                  ? 'Синхро-барьер: ВКЛ'
                  : 'Синхро-барьер: ВЫКЛ'}
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs flex-wrap">
          {firebaseStatus?.clockCalibrated && firebaseStatus?.clockRttMs !== null && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-950/60 border border-white/10 text-[11px] font-mono text-slate-400">
              NTP ±{Math.max(5, Math.round(firebaseStatus.clockRttMs / 2))} мс
            </span>
          )}

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${
              firebaseStatus.connected
                ? Math.abs(driftMs) <= 50 && playback?.isPlaying
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  : 'bg-sky-500/10 text-sky-300 border border-sky-500/25'
                : 'bg-amber-500/10 text-amber-300 border border-amber-500/25'
            }`}
          >
            <Wifi className="w-3 h-3" />
            {currentTrack
              ? downloadState?.stage === 'downloading'
                ? `Загрузка ${downloadPct}%`
                : playback?.phase === 'buffering'
                ? 'Ждём всех участников...'
                : countdownMs > 0
                ? `Старт через ${(countdownMs / 1000).toFixed(1)}с`
                : isBuffering
                ? 'Буферизация...'
                : !playback?.isPlaying
                ? 'На паузе'
                : Math.abs(driftMs) <= 50
                ? `Идеальный синк (${driftMs >= 0 ? '+' : ''}${driftMs} мс)`
                : `Подстройка ${driftMs > 0 ? '+' : ''}${driftMs} мс`
              : firebaseStatus.connected
                ? 'Онлайн'
                : 'Подключение...'}
          </span>
        </div>
      </div>

      {/* Разблокировка автоплея на мобильных / планшетах */}
      {autoplayBlocked && (
        <div className="mb-5 p-4 rounded-2xl bg-amber-500/20 border border-amber-400/40 text-amber-100 flex items-center justify-between gap-3 animate-pulse">
          <div className="text-xs sm:text-sm font-bold flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-amber-400 shrink-0" />
            <span>Нажмите, чтобы разрешить вывод звука на этом устройстве.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (audioElRef.current && playableAudioSrc) {
                audioElRef.current.play().catch(() => {});
              }
              onUnlockAutoplay?.();
            }}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 shrink-0 cursor-pointer"
          >
            Включить звук
          </button>
        </div>
      )}

      {/* Информация о текущем треке */}
      {!isSoundCloud && (
        <div className="flex items-center gap-4 sm:gap-6 mb-5">
          {currentTrack?.thumbnail ? (
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-slate-800 border border-white/15 shrink-0 shadow-xl">
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {playback?.isPlaying && playback?.phase !== 'buffering' && !audioPausedState && (
                <div className="absolute inset-0 bg-sky-500/20 backdrop-blur-[1px] flex items-center justify-center">
                  <span className="w-3 h-3 rounded-full bg-sky-400 animate-ping" />
                </div>
              )}
            </div>
          ) : (
            <AudioWaveVisualizer
              isPlaying={Boolean(playback?.isPlaying && playback?.phase !== 'buffering')}
              hasTrack={Boolean(currentTrack)}
            />
          )}

          <div className="min-w-0 flex-1">
            {currentTrack ? (
              <>
                <h2 className="text-xl sm:text-2xl font-black text-white truncate">
                  {currentTrack.title}
                </h2>
                <p className="text-sm sm:text-base text-slate-300 font-semibold truncate mt-0.5">
                  {currentTrack.artist}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  <span className="px-2.5 py-0.5 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 text-xs font-black tracking-wide inline-flex items-center gap-1.5">
                    {isYouTube ? (
                      <>
                        <YouTubeIcon className="w-3.5 h-3.5 text-red-400" />
                        <span>YouTube</span>
                      </>
                    ) : isMemoryCached ? (
                      <>
                        <Zap className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300">
                          В памяти (0 мс){downloadState.fromCache ? ' · Кэш' : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <Music className="w-3.5 h-3.5 text-sky-400" />
                        <span>Аудиопоток</span>
                      </>
                    )}
                  </span>

                  {(downloadState?.totalBytes > 0 || currentTrack.sizeBytes > 0) && (
                    <span className="text-xs text-slate-400 font-mono">
                      {formatBytes(downloadState?.totalBytes || currentTrack.sizeBytes)}
                    </span>
                  )}

                  <span className="text-xs text-slate-400 font-medium">
                    · {formatDuration(effectiveDuration)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-300">
                  {isHost ? 'Добавьте музыку в очередь' : 'Ожидаем музыку от хоста'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  {isHost
                    ? 'Нажмите «Добавить все 20» или вставьте ссылку на MP3/M4A/SoundCloud.'
                    : 'Когда хост включит трек, оба устройства сначала скачают его в память, затем стартуют секунда в секунду.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Компактная плашка готовности следующего трека на всех устройствах */}
      {currentTrack && nextTrackPrefetchInfo?.track && (
        <div className="mb-4 px-3.5 py-2 rounded-2xl bg-slate-950/60 border border-white/10 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0 text-slate-300">
            <span className="text-slate-500 font-bold shrink-0">Далее:</span>
            <span className="font-bold text-white truncate">
              {nextTrackPrefetchInfo.track.title}
            </span>
          </div>
          {nextTrackPrefetchInfo.allReady ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 font-bold shrink-0">
              <Zap className="w-3 h-3" />
              <span>
                Предзагружен у всех ({nextTrackPrefetchInfo.readyCount}/{nextTrackPrefetchInfo.onlineCount})
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 font-semibold shrink-0">
              <Download className="w-3 h-3 animate-pulse" />
              <span>
                Фон-загрузка ({nextTrackPrefetchInfo.readyCount}/{nextTrackPrefetchInfo.onlineCount})
              </span>
            </span>
          )}
        </div>
      )}

      {/* Шкала загрузки трека и синхро-барьера */}
      {showDownloadBar && (
        <div className="mb-5 p-3.5 rounded-2xl bg-slate-950/80 border border-sky-500/30 shadow-inner">
          <div className="flex items-center justify-between gap-2 mb-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-slate-200 min-w-0">
              {countdownMs > 0 ? (
                <>
                  <Clock className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
                  <span className="text-emerald-300 truncate">
                    Все готовы! Одновременный старт через {(countdownMs / 1000).toFixed(1)}с...
                  </span>
                </>
              ) : downloadState?.stage === 'downloading' ? (
                <>
                  <Download className="w-4 h-4 text-sky-400 animate-bounce shrink-0" />
                  <span className="truncate">
                    Предзагрузка в память: {downloadPct}%
                    {downloadState.totalBytes > 0 &&
                      ` (${formatBytes(downloadState.loadedBytes)} / ${formatBytes(downloadState.totalBytes)})`}
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300 truncate">
                    У вас 100% · Ждём{' '}
                    {barrierState?.waitingParticipants?.length > 0
                      ? barrierState.waitingParticipants
                          .map((w) => `${w.name} (${w.progress}%)`)
                          .join(', ')
                      : 'старт комнаты...'}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {downloadState?.speedBps > 0 && downloadState?.stage === 'downloading' && (
                <span className="text-[11px] font-mono text-sky-300">
                  {formatBytes(downloadState.speedBps)}/с
                </span>
              )}

              {isHost &&
                playback?.phase === 'buffering' &&
                isMemoryCached &&
                barrierState?.waitingParticipants?.length > 0 && (
                  <button
                    type="button"
                    onClick={onForceStartNow}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-[11px] font-extrabold cursor-pointer transition-all"
                  >
                    ⚡ Запустить сейчас
                  </button>
                )}
            </div>
          </div>

          {/* Градиентная полоса общего прогресса */}
          <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-200 ${
                countdownMs > 0
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-400'
                  : isMemoryCached
                  ? 'bg-gradient-to-r from-sky-400 to-emerald-400'
                  : 'bg-gradient-to-r from-sky-500 to-indigo-500'
              }`}
              style={{
                width: `${Math.max(
                  5,
                  countdownMs > 0
                    ? 100
                    : downloadState?.stage === 'downloading'
                    ? downloadPct
                    : barrierState?.avgProgress ?? downloadPct
                )}%`
              }}
            />
          </div>
        </div>
      )}

      {/* Прогресс-бар воспроизведения */}
      <div className="mb-5">
        <input
          type="range"
          min={0}
          max={Math.max(1, effectiveDuration)}
          step={0.1}
          value={Math.min(displayTime, Math.max(1, effectiveDuration))}
          disabled={!isHost || !currentTrack}
          onChange={onSeekChange}
          onMouseUp={onSeekCommit}
          onTouchEnd={onSeekCommit}
          className="w-full wave-range disabled:cursor-default"
        />
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mt-1.5">
          <span>{formatDuration(displayTime)}</span>
          <span>{formatDuration(effectiveDuration)}</span>
        </div>
      </div>

      {/* Панель кнопок управления */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {isHost ? (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={queueLength === 0}
              onClick={onPrevTrack}
              className="p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-700 disabled:opacity-40 text-white transition-all active:scale-95 min-h-[48px] min-w-[48px] flex items-center justify-center cursor-pointer disabled:cursor-default"
              title="Предыдущий трек"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              type="button"
              disabled={queueLength === 0}
              onClick={onPlayOrPause}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-40 text-white font-black flex items-center justify-center gap-2 shadow-lg shadow-sky-600/30 transition-all active:scale-95 min-h-[48px] cursor-pointer disabled:cursor-default"
            >
              {playback?.isPlaying || playback?.phase === 'buffering' ? (
                <>
                  <Pause className="w-5 h-5 fill-current" />
                  <span>Пауза</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>Играть</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={queueLength === 0}
              onClick={() => onNextTrack(false)}
              className="p-3 rounded-2xl bg-slate-800/80 hover:bg-slate-700 disabled:opacity-40 text-white transition-all active:scale-95 min-h-[48px] min-w-[48px] flex items-center justify-center cursor-pointer disabled:cursor-default"
              title="Следующий трек"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={onCycleRepeat}
              className={`p-3 rounded-2xl border text-xs font-bold transition-all min-h-[48px] flex items-center gap-1.5 cursor-pointer ${
                settings?.repeatMode === 'off'
                  ? 'bg-slate-900 border-slate-800 text-slate-500'
                  : 'bg-sky-500/15 border-sky-400/30 text-sky-300'
              }`}
              title="Режим повтора"
            >
              {settings?.repeatMode === 'one' ? (
                <Repeat1 className="w-5 h-5" />
              ) : (
                <Repeat className="w-5 h-5" />
              )}
              <span className="hidden sm:inline">
                {settings?.repeatMode === 'all'
                  ? 'Повтор всех'
                  : settings?.repeatMode === 'one'
                    ? 'Повтор 1'
                    : 'Без повтора'}
              </span>
            </button>
          </div>
        ) : (
          <div className="text-xs sm:text-sm text-slate-400 font-semibold flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                playback?.isPlaying ? 'bg-emerald-400 animate-pulse' : playback?.phase === 'buffering' ? 'bg-sky-400 animate-ping' : 'bg-slate-500'
              }`}
            />
            <span>
              {playback?.phase === 'buffering'
                ? 'Синхронная предзагрузка...'
                : playback?.isPlaying
                ? 'В эфире (управляет хост)'
                : 'Пауза у хоста'}
            </span>
          </div>
        )}

        {/* Локальная громкость */}
        <div className="flex items-center gap-2.5 bg-slate-950/70 border border-white/10 rounded-2xl px-3 py-2">
          <button
            type="button"
            onClick={onToggleMute}
            className="text-slate-300 hover:text-white p-1 cursor-pointer"
            title={isMuted ? 'Включить звук' : 'Заглушить у себя'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-sky-400" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={isMuted ? 0 : volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="w-24 sm:w-28 wave-range"
            title="Громкость у вас"
          />
        </div>
      </div>
    </section>
  );
}
