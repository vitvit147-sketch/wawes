import React, { useRef, useEffect } from 'react';
import ReactPlayer from 'react-player';
import { getServerNow } from '../utils/firebase';
import { computeExpectedPosition } from '../utils/syncEngine';
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
  ExternalLink
} from 'lucide-react';
import { formatDuration } from '../utils/audioMetadata';
import AudioWaveVisualizer from './AudioWaveVisualizer';

function YouTubeIcon({ className = "w-3 h-3 text-red-400" }) {
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
  onUnlockAutoplay,
  onPrevTrack,
  onPlayOrPause,
  onNextTrack,
  onCycleRepeat,
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
  const trackUrl = currentTrack?.url || null;

  const audioElRef = useRef(null);
  const soundcloudPlayerRef = useRef(null);

  // Единый адаптер для управления воспроизведением через playerRef
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
            audioElRef.current.currentTime = sec;
          }
        },
        setPlaybackRate: (rate) => {
          if (!isSoundCloud && audioElRef.current) {
            audioElRef.current.playbackRate = rate;
          }
        }
      };
    }
  });

  // Управление воспроизведением нативного HTML5 <audio>
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || isSoundCloud) return;

    audio.volume = isMuted ? 0 : volume;

    if (playback?.isPlaying) {
      const serverNow = getServerNow();
      const expected = computeExpectedPosition(playback, serverNow, effectiveDuration);

      // Корректируем начальное время только если мы подключились в середину трека (expected > 1.2s)
      // и плеер уже загрузил метаданные (readyState >= 1)
      if (typeof expected === 'number' && expected > 1.2 && audio.readyState >= 1) {
        if (Math.abs(audio.currentTime - expected) > 0.6) {
          try {
            audio.currentTime = expected;
          } catch {}
        }
      }

      const playPromise = audio.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch((err) => {
          console.warn('Audio play was prevented by browser policy:', err);
          onPlayerError && onPlayerError(err);
        });
      }
    } else {
      audio.pause();
    }
  }, [playback?.isPlaying, playback?.trackId, playback?.actionNonce, volume, isMuted, isSoundCloud, trackUrl, effectiveDuration]);

  return (
    <section className="rounded-3xl bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-indigo-950/60 border border-white/12 p-5 sm:p-6 shadow-2xl relative overflow-hidden">
      {/* Виджет для SoundCloud (требует видимый контейнер > 0x0 для вывода звука) */}
      {isSoundCloud && trackUrl && (
        <div className="mb-5 w-full rounded-2xl overflow-hidden shadow-lg border border-white/10 bg-black/70">
          <ReactPlayer
            ref={soundcloudPlayerRef}
            url={trackUrl}
            playing={Boolean(playback?.isPlaying)}
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

      {/* Нативный HTML5 аудиоплеер для прямых потоков (Яндекс Диск, MP3, Catbox и т.д.) */}
      {!isSoundCloud && trackUrl && (
        <audio
          ref={audioElRef}
          src={trackUrl}
          preload="auto"
          playsInline
          onCanPlay={() => onPlayerReady && onPlayerReady()}
          onWaiting={() => onPlayerBuffer && onPlayerBuffer()}
          onPlaying={() => onPlayerBufferEnd && onPlayerBufferEnd()}
          onDurationChange={(e) => onPlayerDuration && onPlayerDuration(e.target.duration)}
          onEnded={() => onPlayerEnded && onPlayerEnded()}
          onError={(e) => {
            console.warn('Native audio error:', e);
            onPlayerError && onPlayerError(e);
          }}
        />
      )}

      {/* Верхний статус-бар */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-slate-300">
          {isHost ? (
            <>
              <Radio className="w-3.5 h-3.5 text-sky-400" />
              <span>Вы Хост (управляете эфиром)</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Слушатель · ведущий: {room?.hostName || 'Хост'}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${
              firebaseStatus.connected
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
                : 'bg-amber-500/10 text-amber-300 border border-amber-500/25'
            }`}
          >
            <Wifi className="w-3 h-3" />
            {currentTrack
              ? isBuffering
                ? 'Буферизация сети...'
                : Math.abs(driftMs) <= 35
                ? 'Синхрон идеальный'
                : `Синхрон ${driftMs > 0 ? '+' : ''}${driftMs} мс`
              : firebaseStatus.connected
                ? 'Онлайн'
                : 'Подключение...'}
          </span>
        </div>
      </div>

      {/* Мобильная / браузерная разблокировка автоплея */}
      {autoplayBlocked && (
        <div className="mb-5 p-4 rounded-2xl bg-amber-500/20 border border-amber-400/40 text-amber-100 flex items-center justify-between gap-3 animate-pulse">
          <div className="text-xs sm:text-sm font-bold flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-amber-400 shrink-0" />
            <span>Браузер требует подтвердить воспроизведение звука.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (audioElRef.current) {
                audioElRef.current.play().catch(() => {});
              }
              onUnlockAutoplay && onUnlockAutoplay();
            }}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 shrink-0 cursor-pointer"
          >
            Включить звук
          </button>
        </div>
      )}

      {/* Информация о текущем треке (показывается для прямых аудиофайлов) */}
      {!isSoundCloud && (
        <div className="flex items-center gap-4 sm:gap-6 mb-6">
          {currentTrack?.thumbnail ? (
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-slate-800 border border-white/15 shrink-0 shadow-xl">
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {playback?.isPlaying && (
                <div className="absolute inset-0 bg-sky-500/20 backdrop-blur-[1px] flex items-center justify-center">
                  <span className="w-3 h-3 rounded-full bg-sky-400 animate-ping" />
                </div>
              )}
            </div>
          ) : (
            <AudioWaveVisualizer isPlaying={Boolean(playback?.isPlaying)} hasTrack={Boolean(currentTrack)} />
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
                        <span>YouTube Audio</span>
                      </>
                    ) : (
                      <>
                        <Music className="w-3.5 h-3.5 text-sky-400" />
                        <span>Аудиопоток</span>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {formatDuration(effectiveDuration)}
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
                    ? 'Вставьте ссылку SoundCloud, Яндекс Диска или прямой MP3 файл.'
                    : 'Когда хост включит трек, он мгновенно заиграет у всех в комнате синхронно.'}
                </p>
              </>
            )}
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
              {playback?.isPlaying ? (
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
                playback?.isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span>{playback?.isPlaying ? 'В эфире' : 'Пауза у хоста'}</span>
          </div>
        )}

        {/* Локальная громкость слушателя / хоста */}
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
