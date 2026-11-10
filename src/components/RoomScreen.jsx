import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, Share2, Music2 } from 'lucide-react';
import { getServerNow } from '../utils/firebase';
import { musicRoomClient } from '../utils/musicRoomClient';
import { computeExpectedPosition, computeDriftAction } from '../utils/syncEngine';
import { resolveTrackMetadata } from '../utils/mediaUrlResolver';
import PlayerCard from './PlayerCard';
import QueuePanel from './QueuePanel';
import LobbyPanel from './LobbyPanel';
import ShareRoomModal from './ShareRoomModal';

export default function RoomScreen({
  room,
  participantId,
  isHost,
  firebaseStatus,
  onLeaveRoom
}) {
  const playerRef = useRef(null);
  const roomRef = useRef(room);
  roomRef.current = room;

  const [displayTime, setDisplayTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem('wavesync_volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.85;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const isSeekingRef = useRef(false);
  const advancingNonceRef = useRef(null);
  const lastLoadedTrackIdRef = useRef(null);
  const lastSeekAtRef = useRef(0);
  const trackSwitchGraceUntilRef = useRef(0);
  const isBufferingRef = useRef(false);
  const isReadyRef = useRef(false);

  const queue = room?.queue || [];
  const playback = room?.playback || {};
  const settings = room?.settings || { repeatMode: 'all' };
  const participants = room?.participants || [];

  const currentTrackIndex = useMemo(
    () => queue.findIndex((t) => t.id === playback.trackId),
    [queue, playback.trackId]
  );
  const currentTrack = currentTrackIndex >= 0 ? queue[currentTrackIndex] : null;

  const effectiveDuration = playerDuration || currentTrack?.duration || 0;

  // Сохранение громкости в localStorage
  useEffect(() => {
    localStorage.setItem('wavesync_volume', String(volume));
  }, [volume]);

  // Предотвращение случайного закрытия вкладки хостом при наличии треков
  useEffect(() => {
    if (!isHost || queue.length === 0) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isHost, queue.length]);

  // Смена трека: если сменился trackId, сбрасываем время и ставим защитный интервал
  useEffect(() => {
    if (!currentTrack) return;
    if (lastLoadedTrackIdRef.current !== currentTrack.id) {
      lastLoadedTrackIdRef.current = currentTrack.id;
      isReadyRef.current = false;
      isBufferingRef.current = false;
      setIsBuffering(false);
      // Защитный период 2.5 сек: плеер спокойно скачивает и начинает новый трек без рывков и перемоток
      trackSwitchGraceUntilRef.current = Date.now() + 2500;
      lastSeekAtRef.current = Date.now() + 2500;
      const initialPos = playback.anchorPos || 0;
      setDisplayTime(initialPos);
    }
  }, [currentTrack?.id, playback.anchorPos]);

  // Безопасный цикл синхронизации с умной микро-подгонкой скорости (без заикания)
  useEffect(() => {
    if (!currentTrack) return;

    const interval = setInterval(() => {
      if (isSeekingRef.current) return;

      const serverNow = getServerNow();
      let expectedPos = 0;

      if (playback.isPlaying) {
        expectedPos = computeExpectedPosition(playback, serverNow, effectiveDuration);
      } else {
        expectedPos = playback.anchorPos || 0;
      }

      setDisplayTime(expectedPos);

      // Проверка локального времени в плеере
      if (playerRef.current) {
        try {
          const now = Date.now();

          // Если только что сменился трек — первые 2.5 секунды даем аудиобуферу спокойно заполниться
          if (now < trackSwitchGraceUntilRef.current) {
            playerRef.current.setPlaybackRate?.(1.0);
            return;
          }

          const currentLocal = playerRef.current.getCurrentTime();
          if (typeof currentLocal === 'number' && !isNaN(currentLocal) && currentLocal >= 0) {
            // diffSec = expectedPos - currentLocal: если > 0, локальный плеер отстает
            const diffSec = expectedPos - currentLocal;
            const absDiff = Math.abs(diffSec);
            const drift = Math.round(diffSec * 1000);
            setDriftMs(drift);

            if (!playback.isPlaying) {
              if (absDiff > 0.1) {
                playerRef.current.seekTo(expectedPos, 'seconds');
              }
              playerRef.current.setPlaybackRate?.(1.0);
            } else {
              // Если рассинхрон ощутимый (> 0.85 сек) и плеер уже реально играет (> 0.4с)
              if (absDiff > 0.85 && currentLocal > 0.4 && (now - lastSeekAtRef.current > 1500)) {
                lastSeekAtRef.current = now;
                playerRef.current.seekTo(expectedPos, 'seconds');
                playerRef.current.setPlaybackRate?.(1.0);
              } else if (absDiff > 0.18) {
                // Если рассинхрон 180..850 мс — адаптивное настигание (1.08x или 0.92x)
                // Отставание 300 мс настигается за ~3.5 секунды абсолютно без заикания!
                const rate = diffSec > 0 ? 1.08 : 0.92;
                playerRef.current.setPlaybackRate?.(rate);
              } else if (absDiff > 0.035) {
                // Если рассинхрон 35..180 мс — тонкая микро-подгонка (1.03x или 0.97x)
                const rate = diffSec > 0 ? 1.03 : 0.97;
                playerRef.current.setPlaybackRate?.(rate);
              } else {
                // Идеальный синхрон (до 35 мс) — чистая скорость 1.0x
                playerRef.current.setPlaybackRate?.(1.0);
              }
            }
          }
        } catch {}
      }
    }, 350);

    return () => clearInterval(interval);
  }, [currentTrack?.id, playback, effectiveDuration]);

  // Добавление пачки треков (например, всех 20 треков Stray Kids в 1 клик)
  const handleAddBatchTracks = useCallback(
    async (presets) => {
      if (!isHost || !room?.code) return;
      setIsAddingUrl(true);
      try {
        const currentQueue = roomRef.current?.queue || [];
        const newItems = presets.map((p, idx) => ({
          ...p,
          id: p.id || 'skz_' + Date.now().toString(36) + '_' + idx
        }));
        const newQueue = [...currentQueue, ...newItems];
        await musicRoomClient.updateQueue(room.code, newQueue);

        if (!roomRef.current?.playback?.trackId || currentQueue.length === 0) {
          await musicRoomClient.updatePlayback(room.code, {
            trackId: newItems[0].id,
            isPlaying: true,
            anchorPos: 0,
            anchorServerTime: getServerNow(),
            playbackRate: 1.0,
            actionNonce: Date.now()
          });
        }
      } finally {
        setIsAddingUrl(false);
      }
    },
    [isHost, room?.code]
  );

  // Добавление трека по ссылке
  const handleAddTrackByUrl = useCallback(
    async (url, presetMeta = null) => {
      if (!isHost || !room?.code) return;
      setIsAddingUrl(true);
      try {
        let meta = presetMeta ? { ...presetMeta } : await resolveTrackMetadata(url);
        if (!meta.id) {
          meta.id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        }
        const currentQueue = roomRef.current?.queue || [];
        const newQueue = [...currentQueue, meta];
        await musicRoomClient.updateQueue(room.code, newQueue);

        // Если сейчас ничего не играет — сразу запускаем добавленный трек
        if (!roomRef.current?.playback?.trackId || currentQueue.length === 0) {
          await musicRoomClient.updatePlayback(room.code, {
            trackId: meta.id,
            isPlaying: true,
            anchorPos: 0,
            anchorServerTime: getServerNow(),
            playbackRate: 1.0,
            actionNonce: Date.now()
          });
        }
      } finally {
        setIsAddingUrl(false);
      }
    },
    [isHost, room?.code]
  );

  // Воспроизведение конкретного трека из списка
  const handlePlayTrack = useCallback(
    async (trackId) => {
      if (!isHost || !room?.code) return;
      advancingNonceRef.current = Date.now();
      isReadyRef.current = false;
      await musicRoomClient.updatePlayback(room.code, {
        trackId,
        isPlaying: true,
        anchorPos: 0,
        anchorServerTime: getServerNow(),
        playbackRate: 1.0,
        actionNonce: Date.now()
      });
    },
    [isHost, room?.code]
  );

  // Пауза / Возобновление
  const handlePlayOrPause = useCallback(async () => {
    if (!isHost || !room?.code) return;
    const r = roomRef.current;
    if (!r) return;

    const q = r.queue || [];
    if (q.length === 0) return;

    const activeId = r.playback?.trackId || q[0].id;
    const currentIsPlaying = Boolean(r.playback?.isPlaying);
    const newIsPlaying = !currentIsPlaying;
    const serverNow = getServerNow();

    let newAnchorPos = 0;
    if (playerRef.current) {
      try {
        const cur = playerRef.current.getCurrentTime();
        if (typeof cur === 'number' && !isNaN(cur)) {
          newAnchorPos = cur;
        }
      } catch {}
    }
    if (newAnchorPos === 0) {
      newAnchorPos = displayTime;
    }

    await musicRoomClient.updatePlayback(room.code, {
      trackId: activeId,
      isPlaying: newIsPlaying,
      anchorPos: newAnchorPos,
      anchorServerTime: serverNow,
      playbackRate: 1.0,
      actionNonce: Date.now()
    });
  }, [isHost, room?.code, displayTime]);

  // Перемотка (Seek)
  const handleSeekChange = useCallback((e) => {
    isSeekingRef.current = true;
    setDisplayTime(Number(e.target.value));
  }, []);

  const handleSeekCommit = useCallback(
    async (e) => {
      isSeekingRef.current = false;
      if (!isHost || !room?.code) return;

      const targetPos = Number(e.target.value);
      lastSeekAtRef.current = Date.now();
      if (playerRef.current) {
        playerRef.current.seekTo(targetPos, 'seconds');
      }

      await musicRoomClient.updatePlayback(room.code, {
        trackId: currentTrack?.id || playback.trackId,
        isPlaying: playback.isPlaying,
        anchorPos: targetPos,
        anchorServerTime: getServerNow(),
        playbackRate: 1.0,
        actionNonce: Date.now()
      });
    },
    [isHost, room?.code, currentTrack?.id, playback]
  );

  // Следующий трек
  const handleNextTrack = useCallback(
    async (isAuto = false) => {
      if (!isHost || !room?.code) return;
      const q = roomRef.current?.queue || [];
      if (q.length === 0) return;

      const currentIdx = q.findIndex((t) => t.id === roomRef.current?.playback?.trackId);
      let nextIdx = 0;

      if (isAuto && settings.repeatMode === 'one' && currentIdx >= 0) {
        nextIdx = currentIdx;
      } else if (currentIdx >= 0) {
        if (currentIdx === q.length - 1 && settings.repeatMode === 'off' && isAuto) {
          // Очередь закончилась, режим без повтора
          await musicRoomClient.updatePlayback(room.code, {
            isPlaying: false,
            anchorPos: effectiveDuration,
            anchorServerTime: getServerNow(),
            actionNonce: Date.now()
          });
          return;
        }
        nextIdx = (currentIdx + 1) % q.length;
      }

      const nextTrack = q[nextIdx];
      isReadyRef.current = false;
      lastSeekAtRef.current = Date.now();
      if (playerRef.current) {
        playerRef.current.seekTo(0, 'seconds');
      }

      await musicRoomClient.updatePlayback(room.code, {
        trackId: nextTrack.id,
        isPlaying: true,
        anchorPos: 0,
        anchorServerTime: getServerNow(),
        playbackRate: 1.0,
        actionNonce: Date.now()
      });
    },
    [isHost, room?.code, settings.repeatMode, effectiveDuration]
  );

  // Предыдущий трек
  const handlePrevTrack = useCallback(async () => {
    if (!isHost || !room?.code) return;
    const q = roomRef.current?.queue || [];
    if (q.length === 0) return;

    const currentIdx = q.findIndex((t) => t.id === roomRef.current?.playback?.trackId);
    let prevIdx = 0;
    if (currentIdx > 0) {
      prevIdx = currentIdx - 1;
    } else {
      prevIdx = q.length - 1;
    }

    const prevTrack = q[prevIdx];
    isReadyRef.current = false;
    lastSeekAtRef.current = Date.now();
    if (playerRef.current) {
      playerRef.current.seekTo(0, 'seconds');
    }

    await musicRoomClient.updatePlayback(room.code, {
      trackId: prevTrack.id,
      isPlaying: true,
      anchorPos: 0,
      anchorServerTime: getServerNow(),
      playbackRate: 1.0,
      actionNonce: Date.now()
    });
  }, [isHost, room?.code]);

  // Переключение режима повтора
  const handleCycleRepeat = useCallback(async () => {
    if (!isHost || !room?.code) return;
    const currentMode = settings.repeatMode || 'all';
    const nextMode = currentMode === 'all' ? 'one' : currentMode === 'one' ? 'off' : 'all';
    await musicRoomClient.updateSettings(room.code, { repeatMode: nextMode });
  }, [isHost, room?.code, settings.repeatMode]);

  // Удаление трека из очереди
  const handleRemoveTrack = useCallback(
    async (trackId) => {
      if (!isHost || !room?.code) return;
      const q = roomRef.current?.queue || [];
      const newQueue = q.filter((t) => t.id !== trackId);
      await musicRoomClient.updateQueue(room.code, newQueue);

      // Если удалили играющий трек
      if (roomRef.current?.playback?.trackId === trackId) {
        if (newQueue.length > 0) {
          isReadyRef.current = false;
          await musicRoomClient.updatePlayback(room.code, {
            trackId: newQueue[0].id,
            isPlaying: playback.isPlaying,
            anchorPos: 0,
            anchorServerTime: getServerNow(),
            actionNonce: Date.now()
          });
        } else {
          await musicRoomClient.updatePlayback(room.code, {
            trackId: null,
            isPlaying: false,
            anchorPos: 0,
            anchorServerTime: getServerNow(),
            actionNonce: Date.now()
          });
        }
      }
    },
    [isHost, room?.code, playback.isPlaying]
  );

  // Перемещение трека в очереди
  const handleMoveTrack = useCallback(
    async (index, delta) => {
      if (!isHost || !room?.code) return;
      const q = [...(roomRef.current?.queue || [])];
      const targetIdx = index + delta;
      if (targetIdx < 0 || targetIdx >= q.length) return;

      const [removed] = q.splice(index, 1);
      q.splice(targetIdx, 0, removed);
      await musicRoomClient.updateQueue(room.code, q);
    },
    [isHost, room?.code]
  );

  // Разблокировка автоплея для мобильных устройств
  const handleUnlockAutoplay = useCallback(() => {
    setAutoplayBlocked(false);
    if (playerRef.current) {
      try {
        const expected = computeExpectedPosition(playback, getServerNow(), effectiveDuration);
        playerRef.current.seekTo(expected, 'seconds');
        lastSeekAtRef.current = Date.now();
      } catch {}
    }
  }, [playback, effectiveDuration]);

  // Коллбеки плеера
  const handlePlayerDuration = useCallback((dur) => {
    if (dur && dur > 0) {
      setPlayerDuration(dur);
    }
  }, []);

  const handlePlayerEnded = useCallback(() => {
    const currentNonce = roomRef.current?.playback?.actionNonce;
    if (isHost && advancingNonceRef.current !== currentNonce) {
      advancingNonceRef.current = currentNonce;
      handleNextTrack(true);
    }
  }, [isHost, handleNextTrack]);

  const handlePlayerReady = useCallback(() => {
    isReadyRef.current = true;
    if (playerRef.current && currentTrack) {
      const exp = computeExpectedPosition(playback, getServerNow(), effectiveDuration);
      if (exp > 0.5) {
        playerRef.current.seekTo(exp, 'seconds');
        lastSeekAtRef.current = Date.now();
      }
    }
  }, [currentTrack, playback, effectiveDuration]);

  const handlePlayerBuffer = useCallback(() => {
    isBufferingRef.current = true;
    setIsBuffering(true);
  }, []);

  const handlePlayerBufferEnd = useCallback(() => {
    isBufferingRef.current = false;
    setIsBuffering(false);
  }, []);

  const handlePlayerError = useCallback((err) => {
    console.warn('ReactPlayer playback error:', err);
    if (playback.isPlaying) {
      setAutoplayBlocked(true);
    }
  }, [playback.isPlaying]);

  return (
    <div className="min-h-[100dvh] flex flex-col pb-10">
      {/* Шапка комнаты */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-xl border-b border-white/10 px-4 py-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onLeaveRoom(isHost)}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-slate-900 border border-slate-700/80 hover:border-rose-400/50 text-slate-200 hover:text-rose-300 font-bold text-sm transition-all min-h-[44px] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{isHost ? 'Закрыть комнату' : 'Покинуть'}</span>
        </button>

        <div className="text-center min-w-0">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Комната эфира
          </div>
          <div className="text-lg font-black text-white font-mono tracking-widest">
            № {room?.code}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowShareModal(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm shadow-md shadow-sky-600/25 transition-all min-h-[44px] cursor-pointer"
        >
          <Share2 className="w-4 h-4" />
          <span className="hidden sm:inline">Поделиться</span>
        </button>
      </header>

      {/* Основной контент */}
      <main className="max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6 flex-1">
        <PlayerCard
          playerRef={playerRef}
          room={room}
          isHost={isHost}
          firebaseStatus={firebaseStatus}
          currentTrack={currentTrack}
          playback={playback}
          settings={settings}
          displayTime={displayTime}
          effectiveDuration={effectiveDuration}
          driftMs={driftMs}
          volume={volume}
          isMuted={isMuted}
          queueLength={queue.length}
          autoplayBlocked={autoplayBlocked}
          isBuffering={isBuffering}
          onUnlockAutoplay={handleUnlockAutoplay}
          onPrevTrack={handlePrevTrack}
          onPlayOrPause={handlePlayOrPause}
          onNextTrack={handleNextTrack}
          onCycleRepeat={handleCycleRepeat}
          onSeekChange={handleSeekChange}
          onSeekCommit={handleSeekCommit}
          onToggleMute={() => setIsMuted((v) => !v)}
          onVolumeChange={(newVol) => {
            setVolume(newVol);
            if (isMuted) setIsMuted(false);
          }}
          onPlayerDuration={handlePlayerDuration}
          onPlayerEnded={handlePlayerEnded}
          onPlayerReady={handlePlayerReady}
          onPlayerBuffer={handlePlayerBuffer}
          onPlayerBufferEnd={handlePlayerBufferEnd}
          onPlayerError={handlePlayerError}
        />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <QueuePanel
            queue={queue}
            isHost={isHost}
            currentTrack={currentTrack}
            playback={playback}
            isAddingUrl={isAddingUrl}
            onAddTrackByUrl={handleAddTrackByUrl}
            onAddBatchTracks={handleAddBatchTracks}
            onPlayTrack={handlePlayTrack}
            onMoveTrack={handleMoveTrack}
            onRemoveTrack={handleRemoveTrack}
          />

          <LobbyPanel
            participants={participants}
            participantId={participantId}
            isHost={isHost}
            currentTrack={currentTrack}
            isPlaying={Boolean(playback.isPlaying)}
          />
        </div>
      </main>

      {showShareModal && (
        <ShareRoomModal
          roomCode={room?.code}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}
