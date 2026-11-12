import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ArrowLeft, Share2 } from 'lucide-react';
import { getServerNow, calibrateServerClock } from '../utils/firebase';
import { musicRoomClient } from '../utils/musicRoomClient';
import {
  computeExpectedPosition,
  computeDriftAction,
  evaluateSustainedSeek,
  getStartCountdownMs,
  evaluateBarrierReadiness,
  moveTrackAfterCurrent,
  buildPrefetchOrder
} from '../utils/syncEngine';
import { resolveTrackMetadata } from '../utils/mediaUrlResolver';
import {
  loadTrackToBlobUrl,
  setPinnedUrls,
  startQueuePrefetchPipeline,
  subscribeTrackCache,
  isTrackReadyInCache
} from '../utils/trackLoader';
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
  const [countdownMs, setCountdownMs] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem('wavesync_volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.85;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [downloadState, setDownloadState] = useState({
    trackId: null,
    stage: 'idle',
    percent: 0,
    loadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    fromCache: false,
    playableUrl: null,
    mode: 'memory'
  });

  const isSeekingRef = useRef(false);
  const advancingNonceRef = useRef(null);
  const launchedBarrierNonceRef = useRef(null);
  const lastSeekAtRef = useRef(0);
  const lastTransitionAtRef = useRef(Date.now());
  const lastRateChangeAtRef = useRef(0);
  const lastResumeAttemptAtRef = useRef(0);
  const lastUiHalfSecRef = useRef(-1);
  const smoothedDriftRef = useRef(null);
  const consecutiveSeekCountRef = useRef(0);
  const isBufferingRef = useRef(false);
  const lastCacheSyncRef = useRef({ nextReadyId: undefined, cachedCount: -1 });
  const syncStateRef = useRef({});

  const isMobileDevice = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''),
    []
  );

  const [bluetoothSafe, setBluetoothSafe] = useState(() => {
    try {
      const saved = localStorage.getItem('wavesync_bt_safe');
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch {}
    return typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  });

  const handleToggleBluetoothSafe = useCallback(() => {
    setBluetoothSafe((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('wavesync_bt_safe', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  const queue = room?.queue || [];
  const playback = room?.playback || {};
  const settings = room?.settings || { repeatMode: 'all', waitForListeners: true };
  const participants = room?.participants || [];

  const currentTrackIndex = useMemo(
    () => queue.findIndex((t) => t.id === playback.trackId),
    [queue, playback.trackId]
  );
  const currentTrack = currentTrackIndex >= 0 ? queue[currentTrackIndex] : null;
  const nextTrack = useMemo(() => {
    if (queue.length <= 1 || currentTrackIndex < 0) return null;
    return queue[(currentTrackIndex + 1) % queue.length];
  }, [queue, currentTrackIndex]);

  const effectiveDuration = playerDuration || currentTrack?.duration || 0;

  const barrierState = useMemo(
    () => evaluateBarrierReadiness(participants, currentTrack?.id),
    [participants, currentTrack?.id]
  );

  const nextTrackPrefetchInfo = useMemo(() => {
    if (!nextTrack?.id) return null;
    const online = participants.filter((p) => p.isOnline !== false);
    const readyCount = online.filter((p) => p.nextReadyTrackId === nextTrack.id).length;
    return {
      track: nextTrack,
      readyCount,
      onlineCount: online.length,
      allReady: online.length > 0 && readyCount === online.length
    };
  }, [participants, nextTrack]);

  // Подписка на события кэша/фоновой загрузки для мгновенного обновления UI
  useEffect(() => {
    return subscribeTrackCache(() => setCacheVersion((v) => v + 1));
  }, []);

  // Высокоточная NTP-калибровка часов сразу при входе в комнату
  useEffect(() => {
    calibrateServerClock(participantId).catch(() => {});
  }, [participantId, room?.code]);

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

  // Сброс локальной длительности при смене трека
  useEffect(() => {
    setPlayerDuration(0);
    setDisplayTime(playback.anchorPos || 0);
    setDriftMs(0);
  }, [currentTrack?.id]);

  // Плавная потоковая предзагрузка текущего трека в RAM + публикация % готовности в комнату
  useEffect(() => {
    const code = room?.code;
    if (!code || !currentTrack) return;

    let cancelled = false;
    let lastReportAt = 0;

    // SoundCloud / YouTube не скачиваются fetch-потоком — сразу отмечаем готовность
    if (currentTrack.source === 'soundcloud' || currentTrack.source === 'youtube') {
      setDownloadState({
        trackId: currentTrack.id,
        stage: 'ready',
        percent: 100,
        loadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        fromCache: false,
        playableUrl: currentTrack.url,
        mode: 'direct-stream'
      });
      musicRoomClient
        .updateParticipantStatus(code, participantId, {
          status: 'ready',
          readyTrackId: currentTrack.id,
          downloadProgress: 100
        })
        .catch(() => {});
      return;
    }

    setDownloadState({
      trackId: currentTrack.id,
      stage: 'downloading',
      percent: 0,
      loadedBytes: 0,
      totalBytes: currentTrack.sizeBytes || 0,
      speedBps: 0,
      fromCache: false,
      playableUrl: null,
      mode: 'memory'
    });

    musicRoomClient
      .updateParticipantStatus(code, participantId, {
        status: 'downloading',
        readyTrackId: null,
        downloadProgress: 0
      })
      .catch(() => {});

    loadTrackToBlobUrl(currentTrack.url, {
      expectedSizeBytes: currentTrack.sizeBytes || 0,
      onProgress: (p) => {
        if (cancelled) return;
        setDownloadState((prev) => ({
          ...prev,
          trackId: currentTrack.id,
          stage: p.stage,
          percent: p.percent,
          loadedBytes: p.loadedBytes,
          totalBytes: p.totalBytes || prev.totalBytes,
          speedBps: p.speedBps,
          fromCache: p.fromCache
        }));

        const now = Date.now();
        if (p.percent < 100 && now - lastReportAt >= 320) {
          lastReportAt = now;
          musicRoomClient
            .updateParticipantStatus(code, participantId, {
              status: 'downloading',
              readyTrackId: null,
              downloadProgress: p.percent
            })
            .catch(() => {});
        }
      }
    })
      .then((res) => {
        if (cancelled) return;
        const isDirect = res.mode === 'direct-stream';
        setDownloadState({
          trackId: currentTrack.id,
          stage: isDirect ? 'direct-stream' : 'ready',
          percent: 100,
          loadedBytes: res.sizeBytes || currentTrack.sizeBytes || 0,
          totalBytes: res.sizeBytes || currentTrack.sizeBytes || 0,
          speedBps: 0,
          fromCache: Boolean(res.fromCache),
          playableUrl: res.playableUrl,
          mode: res.mode
        });

        musicRoomClient
          .updateParticipantStatus(code, participantId, {
            status: isDirect ? 'direct-stream' : 'ready',
            readyTrackId: currentTrack.id,
            downloadProgress: 100
          })
          .catch(() => {});
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to preload track:', err);
        setDownloadState((prev) => ({
          ...prev,
          trackId: currentTrack.id,
          stage: 'direct-stream',
          percent: 100,
          playableUrl: currentTrack.url,
          mode: 'direct-stream'
        }));
        musicRoomClient
          .updateParticipantStatus(code, participantId, {
            status: 'direct-stream',
            readyTrackId: currentTrack.id,
            downloadProgress: 100
          })
          .catch(() => {});
      });

    return () => {
      cancelled = true;
    };
  }, [room?.code, participantId, currentTrack?.id, currentTrack?.url, currentTrack?.source]);

  const queueSig = useMemo(
    () => queue.map((t) => `${t.id}:${t.url}`).join('|'),
    [queue]
  );

  // Удержание нужных Blob URL в памяти и умный фоновый конвейер предзагрузки всей очереди
  useEffect(() => {
    setPinnedUrls([currentTrack?.url, nextTrack?.url].filter(Boolean));

    if (queue.length === 0) return;

    const isCurrentDone =
      !currentTrack ||
      (downloadState.trackId === currentTrack.id &&
        (downloadState.stage === 'ready' || downloadState.stage === 'direct-stream'));

    if (!isCurrentDone) return;

    const orderedTracks = buildPrefetchOrder(queue, currentTrack?.id);
    if (orderedTracks.length === 0) return;

    let stopPipeline = () => {};
    const lookahead = isMobileDevice ? 2 : 4;
    const startDelayMs = isMobileDevice ? 4000 : 600;
    const stepDelayMs = isMobileDevice ? 850 : 350;
    const timer = setTimeout(() => {
      stopPipeline = startQueuePrefetchPipeline(orderedTracks, lookahead, stepDelayMs);
    }, startDelayMs);

    return () => {
      clearTimeout(timer);
      stopPipeline();
    };
  }, [
    queueSig,
    currentTrack?.id,
    currentTrack?.url,
    nextTrack?.url,
    downloadState.trackId,
    downloadState.stage,
    isMobileDevice
  ]);

  // Отправка в комнату статуса предзагрузки следующего трека и общего числа кэшированных треков
  useEffect(() => {
    const code = room?.code;
    if (!code || !participantId) return;

    let cachedCount = 0;
    for (const t of queue) {
      if (t.source === 'soundcloud' || t.source === 'youtube' || isTrackReadyInCache(t.url)) {
        cachedCount++;
      }
    }

    const isNextReady = Boolean(
      nextTrack &&
        (nextTrack.source === 'soundcloud' ||
          nextTrack.source === 'youtube' ||
          isTrackReadyInCache(nextTrack.url))
    );
    const nextReadyId = isNextReady ? nextTrack.id : null;

    if (
      lastCacheSyncRef.current.nextReadyId !== nextReadyId ||
      lastCacheSyncRef.current.cachedCount !== cachedCount
    ) {
      lastCacheSyncRef.current = { nextReadyId, cachedCount };
      musicRoomClient
        .updateParticipantStatus(code, participantId, {
          nextReadyTrackId: nextReadyId,
          cachedTrackCount: cachedCount
        })
        .catch(() => {});
    }
  }, [room?.code, participantId, queueSig, nextTrack?.id, nextTrack?.url, cacheVersion]);

  // Барьерный триггер хоста: как только ВСЕ онлайн-участники загрузили трек (100%),
  // ставим общую будущую миллисекунду старта (serverNow + 650мс)
  useEffect(() => {
    if (!isHost || !room?.code || !currentTrack) return;
    if (playback.phase !== 'buffering') return;
    if (!barrierState.allReady) return;
    if (launchedBarrierNonceRef.current === playback.actionNonce) return;

    launchedBarrierNonceRef.current = playback.actionNonce;
    const leadMs = barrierState.onlineCount > 1 ? 650 : 120;

    musicRoomClient
      .updatePlayback(room.code, {
        phase: 'playing',
        isPlaying: true,
        anchorPos: playback.anchorPos || 0,
        anchorServerTime: getServerNow() + leadMs,
        playbackRate: 1.0,
        actionNonce: Date.now()
      })
      .catch(() => {});
  }, [
    isHost,
    room?.code,
    currentTrack?.id,
    playback.phase,
    playback.actionNonce,
    playback.anchorPos,
    barrierState.allReady,
    barrierState.onlineCount
  ]);

  // Актуальный срез состояния для стабильного интервала синхронизации (не перезапускается от RTDB-обновлений участников)
  syncStateRef.current = {
    currentTrack,
    playback,
    effectiveDuration,
    autoplayBlocked,
    bluetoothSafe,
    isMobileDevice
  };

  // Сброс окна сглаживания при смене трека / старте / паузе (защита Bluetooth HAL на Android)
  useEffect(() => {
    lastTransitionAtRef.current = Date.now();
    smoothedDriftRef.current = null;
    consecutiveSeekCountRef.current = 0;
    lastUiHalfSecRef.current = -1;
  }, [currentTrack?.id, playback?.actionNonce, playback?.isPlaying, playback?.phase, bluetoothSafe]);

  // Стабильный цикл синхронизации: в BT-защите playbackRate не трогается, а seek только при устойчивом сдвиге > 1.5с
  const hasCurrentTrack = Boolean(currentTrack?.id);
  useEffect(() => {
    if (!hasCurrentTrack) {
      setCountdownMs(0);
      return;
    }

    const syncIntervalMs = isMobileDevice || bluetoothSafe ? 350 : 250;

    const interval = setInterval(() => {
      if (isSeekingRef.current) return;

      const {
        currentTrack: track,
        playback: pb,
        effectiveDuration: dur,
        autoplayBlocked: blocked,
        bluetoothSafe: btSafe
      } = syncStateRef.current;

      if (!track || !pb) return;

      const deadbandSec = btSafe ? 0.25 : 0.10;
      const exitDeadbandSec = btSafe ? 0.12 : 0.04;
      const seekThresholdSec = btSafe ? 1.5 : 0.65;
      const rateDelta = 0.02;
      const seekCooldownMs = btSafe ? 8000 : 2800;
      const rateCooldownMs = 1100;
      const graceMs = btSafe ? 3500 : 1200;
      const requiredSeekChecks = btSafe ? 4 : 2;

      const serverNow = getServerNow();
      const leftMs = getStartCountdownMs(pb, serverNow);
      setCountdownMs((prev) => (prev === leftMs ? prev : leftMs));

      if (pb.phase === 'buffering' || leftMs > 0) {
        const anchor = pb.anchorPos || 0;
        lastUiHalfSecRef.current = Math.floor(anchor * 2);
        setDisplayTime((prev) => (Math.abs(prev - anchor) < 0.05 ? prev : anchor));
        setDriftMs((prev) => (prev === 0 ? prev : 0));
        consecutiveSeekCountRef.current = 0;
        return;
      }

      const expectedPos = computeExpectedPosition(pb, serverNow, dur);
      const halfSec = Math.floor(expectedPos * 2);
      if (halfSec !== lastUiHalfSecRef.current) {
        lastUiHalfSecRef.current = halfSec;
        setDisplayTime(expectedPos);
      }

      const player = playerRef.current;
      if (!player || !player.isTrackLoaded?.(track.id)) return;
      if (player.isSeeking?.() || player.isPlayPending?.()) return;

      const now = Date.now();
      const inGraceWindow =
        now - lastTransitionAtRef.current < graceMs || now - lastSeekAtRef.current < graceMs;

      try {
        const currentLocal = player.getCurrentTime();
        if (typeof currentLocal !== 'number' || isNaN(currentLocal) || currentLocal < 0) return;

        // Если плеер в момент старта не успел запуститься (после завершения окна запуска) — пробуем мягко возобновить
        if (pb.isPlaying && player.isPaused?.() && !blocked) {
          if (!inGraceWindow && now - lastResumeAttemptAtRef.current > 1500) {
            lastResumeAttemptAtRef.current = now;
            player.resumePlayback?.();
          }
          return;
        }

        // Окно прогрева после старта/перемотки: даём MediaCodec и Bluetooth A2DP стабилизироваться
        if (pb.isPlaying && inGraceWindow) {
          if (Math.abs((player.getPlaybackRate?.() || 1.0) - 1.0) > 0.002) {
            player.setPlaybackRate?.(1.0);
          }
          consecutiveSeekCountRef.current = 0;
          return;
        }

        const rawDrift = expectedPos - currentLocal;
        const smoothedDrift =
          smoothedDriftRef.current === null
            ? rawDrift
            : smoothedDriftRef.current * 0.65 + rawDrift * 0.35;
        smoothedDriftRef.current = smoothedDrift;

        const smoothedActualPos = Math.max(0, expectedPos - smoothedDrift);
        const currentRate = player.getPlaybackRate?.() || 1.0;

        const action = computeDriftAction({
          expectedPos,
          actualPos: smoothedActualPos,
          isPlaying: Boolean(pb.isPlaying),
          duration: dur,
          deadbandSec,
          exitDeadbandSec,
          seekThresholdSec,
          rateDelta,
          currentRate,
          disableRateAdjust: btSafe
        });

        setDriftMs((prev) => (Math.abs(prev - action.driftMs) >= 50 ? action.driftMs : prev));

        const sustained = evaluateSustainedSeek({
          actionType: action.type,
          consecutiveCount: consecutiveSeekCountRef.current,
          requiredChecks: requiredSeekChecks
        });
        consecutiveSeekCountRef.current = sustained.nextCount;

        if (sustained.shouldSeek) {
          if (now - lastSeekAtRef.current > seekCooldownMs) {
            lastSeekAtRef.current = now;
            lastTransitionAtRef.current = now;
            smoothedDriftRef.current = 0;
            const compensatedTarget =
              pb.isPlaying && dur > 0
                ? Math.min(Math.max(0, dur - 0.1), action.targetPos + 0.08)
                : action.targetPos;
            player.seekTo(compensatedTarget, 'seconds');
            player.setPlaybackRate?.(1.0);
          }
        } else if (!btSafe && action.type === 'rate') {
          if (
            Math.abs(currentRate - action.rate) > 0.002 &&
            now - lastRateChangeAtRef.current > rateCooldownMs
          ) {
            lastRateChangeAtRef.current = now;
            player.setPlaybackRate?.(action.rate);
          }
        } else if (action.type === 'none') {
          if (
            Math.abs(currentRate - 1.0) > 0.002 &&
            (btSafe || now - lastRateChangeAtRef.current > rateCooldownMs)
          ) {
            lastRateChangeAtRef.current = now;
            player.setPlaybackRate?.(1.0);
          }
        }
      } catch {}
    }, syncIntervalMs);

    return () => clearInterval(interval);
  }, [hasCurrentTrack, bluetoothSafe, isMobileDevice]);

  // Вспомогательная команда хоста: запуск трека (через барьер готовности или сразу)
  const launchTrackAsHost = useCallback(
    async (trackId, startPos = 0) => {
      const r = roomRef.current;
      if (!r?.code || !trackId) return;
      const useBarrier = r.settings?.waitForListeners !== false;

      if (useBarrier) {
        await musicRoomClient.updatePlayback(r.code, {
          trackId,
          phase: 'buffering',
          isPlaying: false,
          anchorPos: startPos,
          anchorServerTime: getServerNow(),
          playbackRate: 1.0,
          actionNonce: Date.now()
        });
      } else {
        await musicRoomClient.updatePlayback(r.code, {
          trackId,
          phase: 'playing',
          isPlaying: true,
          anchorPos: startPos,
          anchorServerTime: getServerNow() + 250,
          playbackRate: 1.0,
          actionNonce: Date.now()
        });
      }
    },
    []
  );

  // Пакетное добавление подборки или альбома (без дубликатов; при playNow = true сразу запускает первый трек)
  const handleAddBatchTracks = useCallback(
    async (presets, playNow = false) => {
      if (!isHost || !room?.code || !Array.isArray(presets) || presets.length === 0) return;
      setIsAddingUrl(true);
      try {
        const currentQueue = roomRef.current?.queue || [];
        const existingByUrl = new Map(currentQueue.map((t) => [t.url, t]));
        const newItems = presets
          .filter((p) => !existingByUrl.has(p.url))
          .map((p, idx) => ({
            ...p,
            id: p.id && !currentQueue.some((t) => t.id === p.id)
              ? p.id
              : 'skz_' + Date.now().toString(36) + '_' + idx
          }));

        if (newItems.length > 0) {
          const newQueue = [...currentQueue, ...newItems];
          await musicRoomClient.updateQueue(room.code, newQueue);
        }

        if (playNow) {
          const firstPreset = presets[0];
          const target =
            existingByUrl.get(firstPreset.url) ||
            newItems.find((x) => x.url === firstPreset.url) ||
            newItems[0];
          if (target?.id) {
            advancingNonceRef.current = Date.now();
            await launchTrackAsHost(target.id, 0);
          }
        } else if (!roomRef.current?.playback?.trackId || currentQueue.length === 0) {
          const firstId = newItems[0]?.id || currentQueue[0]?.id;
          if (firstId) await launchTrackAsHost(firstId, 0);
        }
      } finally {
        setIsAddingUrl(false);
      }
    },
    [isHost, room?.code, launchTrackAsHost]
  );

  // Мгновенный запуск трека из Медиатеки (как в Spotify / Яндекс Музыке)
  const handlePlayPresetNow = useCallback(
    async (preset) => {
      if (!isHost || !room?.code || !preset) return;
      setIsAddingUrl(true);
      try {
        const currentQueue = roomRef.current?.queue || [];
        const existing = currentQueue.find(
          (t) => t.url === preset.url || t.id === preset.id
        );
        if (existing) {
          advancingNonceRef.current = Date.now();
          await launchTrackAsHost(existing.id, 0);
          return;
        }

        const meta = {
          ...preset,
          id:
            preset.id && !currentQueue.some((t) => t.id === preset.id)
              ? preset.id
              : 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
        };
        const currentId = roomRef.current?.playback?.trackId;
        const nextQueue = currentId
          ? moveTrackAfterCurrent([...currentQueue, meta], currentId, meta.id)
          : [...currentQueue, meta];

        await musicRoomClient.updateQueue(room.code, nextQueue);
        advancingNonceRef.current = Date.now();
        await launchTrackAsHost(meta.id, 0);
      } finally {
        setIsAddingUrl(false);
      }
    },
    [isHost, room?.code, launchTrackAsHost]
  );

  // Поставить трек из Медиатеки следующим в очередь
  const handlePlayPresetNext = useCallback(
    async (preset) => {
      if (!isHost || !room?.code || !preset) return;
      setIsAddingUrl(true);
      try {
        const currentQueue = roomRef.current?.queue || [];
        const currentId = roomRef.current?.playback?.trackId;
        const existing = currentQueue.find(
          (t) => t.url === preset.url || t.id === preset.id
        );
        if (existing) {
          if (existing.id !== currentId) {
            const nextQueue = moveTrackAfterCurrent(currentQueue, currentId, existing.id);
            await musicRoomClient.updateQueue(room.code, nextQueue);
          }
          return;
        }

        const meta = {
          ...preset,
          id:
            preset.id && !currentQueue.some((t) => t.id === preset.id)
              ? preset.id
              : 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
        };
        const nextQueue = currentId
          ? moveTrackAfterCurrent([...currentQueue, meta], currentId, meta.id)
          : [...currentQueue, meta];
        await musicRoomClient.updateQueue(room.code, nextQueue);

        if (!currentId || currentQueue.length === 0) {
          await launchTrackAsHost(meta.id, 0);
        }
      } finally {
        setIsAddingUrl(false);
      }
    },
    [isHost, room?.code, launchTrackAsHost]
  );

  // Очистить всю очередь
  const handleClearQueue = useCallback(async () => {
    if (!isHost || !room?.code) return;
    await musicRoomClient.updateQueue(room.code, []);
    await musicRoomClient.updatePlayback(room.code, {
      trackId: null,
      phase: 'idle',
      isPlaying: false,
      anchorPos: 0,
      anchorServerTime: getServerNow(),
      actionNonce: Date.now()
    });
  }, [isHost, room?.code]);

  // Добавление трека по ссылке или пресета
  const handleAddTrackByUrl = useCallback(
    async (url, presetMeta = null) => {
      if (!isHost || !room?.code) return;
      setIsAddingUrl(true);
      try {
        const currentQueue = roomRef.current?.queue || [];
        // Если нажали на уже добавленный пресет — переставляем его «Следующим» для мгновенного прелоада у всех!
        if (presetMeta) {
          const existing = currentQueue.find(
            (t) => t.url === presetMeta.url || t.id === presetMeta.id
          );
          if (existing) {
            if (existing.id !== roomRef.current?.playback?.trackId) {
              const nextQueue = moveTrackAfterCurrent(
                currentQueue,
                roomRef.current?.playback?.trackId,
                existing.id
              );
              await musicRoomClient.updateQueue(room.code, nextQueue);
            }
            return;
          }
        }

        let meta = presetMeta ? { ...presetMeta } : await resolveTrackMetadata(url);
        if (!meta.id || currentQueue.some((t) => t.id === meta.id)) {
          meta.id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        }
        const newQueue = [...currentQueue, meta];
        await musicRoomClient.updateQueue(room.code, newQueue);

        if (!roomRef.current?.playback?.trackId || currentQueue.length === 0) {
          await launchTrackAsHost(meta.id, 0);
        }
      } finally {
        setIsAddingUrl(false);
      }
    },
    [isHost, room?.code, launchTrackAsHost]
  );

  // Поставить выбранный трек в очереди сразу следующим — слушатели тут же начнут его качать заранее
  const handlePlayNextInQueue = useCallback(
    async (trackId) => {
      if (!isHost || !room?.code) return;
      const currentQueue = roomRef.current?.queue || [];
      const currentId = roomRef.current?.playback?.trackId;
      const updated = moveTrackAfterCurrent(currentQueue, currentId, trackId);
      await musicRoomClient.updateQueue(room.code, updated);
    },
    [isHost, room?.code]
  );

  // Включение выбранного трека из очереди
  const handlePlayTrack = useCallback(
    async (trackId) => {
      if (!isHost || !room?.code) return;
      advancingNonceRef.current = Date.now();
      await launchTrackAsHost(trackId, 0);
    },
    [isHost, room?.code, launchTrackAsHost]
  );

  // Принудительный старт без ожидания отстающих устройств
  const handleForceStartNow = useCallback(async () => {
    if (!isHost || !room?.code || !playback.trackId) return;
    launchedBarrierNonceRef.current = playback.actionNonce;
    await musicRoomClient.updatePlayback(room.code, {
      trackId: playback.trackId,
      phase: 'playing',
      isPlaying: true,
      anchorPos: playback.anchorPos || 0,
      anchorServerTime: getServerNow() + 450,
      playbackRate: 1.0,
      actionNonce: Date.now()
    });
  }, [isHost, room?.code, playback.trackId, playback.anchorPos, playback.actionNonce]);

  // Переключение режима барьерной синхронизации
  const handleToggleWaitForListeners = useCallback(async () => {
    if (!isHost || !room?.code) return;
    const current = roomRef.current?.settings?.waitForListeners !== false;
    await musicRoomClient.updateSettings(room.code, {
      waitForListeners: !current
    });
  }, [isHost, room?.code]);

  // Пауза / Возобновление
  const handlePlayOrPause = useCallback(async () => {
    if (!isHost || !room?.code) return;
    const r = roomRef.current;
    if (!r) return;

    const q = r.queue || [];
    if (q.length === 0) return;

    const activeId = r.playback?.trackId || q[0].id;
    const isCurrentlyActive = Boolean(
      r.playback?.isPlaying || r.playback?.phase === 'buffering'
    );
    const serverNow = getServerNow();

    if (isCurrentlyActive) {
      let newAnchorPos = r.playback?.anchorPos || 0;
      if (r.playback?.phase !== 'buffering' && playerRef.current) {
        try {
          const cur = playerRef.current.getCurrentTime();
          if (typeof cur === 'number' && !isNaN(cur) && cur > 0) {
            newAnchorPos = cur;
          }
        } catch {}
      }

      await musicRoomClient.updatePlayback(room.code, {
        trackId: activeId,
        phase: 'paused',
        isPlaying: false,
        anchorPos: newAnchorPos,
        anchorServerTime: serverNow,
        playbackRate: 1.0,
        actionNonce: Date.now()
      });
      return;
    }

    // Возобновление воспроизведения: если уже загружено у всех онлайн — стартуем синхронно!
    const currentPos = r.playback?.anchorPos || displayTime || 0;
    const readyCheck = evaluateBarrierReadiness(r.participants, activeId);
    const useBarrier = r.settings?.waitForListeners !== false;

    if (!useBarrier || readyCheck.allReady) {
      const leadMs = readyCheck.onlineCount > 1 ? 450 : 80;
      await musicRoomClient.updatePlayback(room.code, {
        trackId: activeId,
        phase: 'playing',
        isPlaying: true,
        anchorPos: currentPos,
        anchorServerTime: serverNow + leadMs,
        playbackRate: 1.0,
        actionNonce: Date.now()
      });
    } else {
      await launchTrackAsHost(activeId, currentPos);
    }
  }, [isHost, room?.code, displayTime, launchTrackAsHost]);

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

      const isCurrentlyPlaying = Boolean(playback.isPlaying && playback.phase !== 'buffering');
      const leadMs = isCurrentlyPlaying && barrierState.onlineCount > 1 ? 350 : 0;

      await musicRoomClient.updatePlayback(room.code, {
        trackId: currentTrack?.id || playback.trackId,
        phase: isCurrentlyPlaying ? 'playing' : 'paused',
        isPlaying: isCurrentlyPlaying,
        anchorPos: targetPos,
        anchorServerTime: getServerNow() + leadMs,
        playbackRate: 1.0,
        actionNonce: Date.now()
      });
    },
    [isHost, room?.code, currentTrack?.id, playback, barrierState.onlineCount]
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
          await musicRoomClient.updatePlayback(room.code, {
            phase: 'paused',
            isPlaying: false,
            anchorPos: effectiveDuration,
            anchorServerTime: getServerNow(),
            actionNonce: Date.now()
          });
          return;
        }
        nextIdx = (currentIdx + 1) % q.length;
      }

      const next = q[nextIdx];
      await launchTrackAsHost(next.id, 0);
    },
    [isHost, room?.code, settings.repeatMode, effectiveDuration, launchTrackAsHost]
  );

  // Предыдущий трек
  const handlePrevTrack = useCallback(async () => {
    if (!isHost || !room?.code) return;
    const q = roomRef.current?.queue || [];
    if (q.length === 0) return;

    const currentIdx = q.findIndex((t) => t.id === roomRef.current?.playback?.trackId);
    const prevIdx = currentIdx > 0 ? currentIdx - 1 : q.length - 1;
    await launchTrackAsHost(q[prevIdx].id, 0);
  }, [isHost, room?.code, launchTrackAsHost]);

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

      if (roomRef.current?.playback?.trackId === trackId) {
        if (newQueue.length > 0) {
          await launchTrackAsHost(newQueue[0].id, 0);
        } else {
          await musicRoomClient.updatePlayback(room.code, {
            trackId: null,
            phase: 'idle',
            isPlaying: false,
            anchorPos: 0,
            anchorServerTime: getServerNow(),
            actionNonce: Date.now()
          });
        }
      }
    },
    [isHost, room?.code, launchTrackAsHost]
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

  // Разблокировка автоплея
  const handleUnlockAutoplay = useCallback(() => {
    setAutoplayBlocked(false);
    if (playerRef.current && currentTrack?.id) {
      try {
        const expected = computeExpectedPosition(playback, getServerNow(), effectiveDuration);
        playerRef.current.seekTo(expected, 'seconds');
        lastSeekAtRef.current = Date.now();
        playerRef.current.resumePlayback?.();
      } catch {}
    }
  }, [playback, effectiveDuration, currentTrack?.id]);

  // Коллбеки плеера
  const handlePlayerDuration = useCallback((dur) => {
    if (dur && Number.isFinite(dur) && dur > 0) {
      setPlayerDuration(dur);
    }
  }, []);

  const handlePlayerEnded = useCallback(() => {
    const currentNonce = roomRef.current?.playback?.actionNonce;
    if (
      isHost &&
      roomRef.current?.playback?.phase !== 'buffering' &&
      advancingNonceRef.current !== currentNonce
    ) {
      advancingNonceRef.current = currentNonce;
      handleNextTrack(true);
    }
  }, [isHost, handleNextTrack]);

  const handlePlayerReady = useCallback(() => {
    const {
      currentTrack: track,
      playback: pb,
      effectiveDuration: dur,
      bluetoothSafe: btSafe
    } = syncStateRef.current;

    if (
      playerRef.current &&
      track &&
      pb?.isPlaying &&
      pb?.phase !== 'buffering' &&
      getStartCountdownMs(pb, getServerNow()) === 0
    ) {
      const exp = computeExpectedPosition(pb, getServerNow(), dur);
      const cur = Number(playerRef.current.getCurrentTime?.()) || 0;
      const minJoinGapSec = btSafe ? 1.35 : 0.75;
      const now = Date.now();
      if (Math.abs(exp - cur) > minJoinGapSec && now - lastSeekAtRef.current > 2000) {
        playerRef.current.seekTo(exp, 'seconds');
        lastSeekAtRef.current = now;
        lastTransitionAtRef.current = now;
      }
    }
  }, []);

  const handlePlayerBuffer = useCallback(() => {
    isBufferingRef.current = true;
    setIsBuffering(true);
  }, []);

  const handlePlayerBufferEnd = useCallback(() => {
    isBufferingRef.current = false;
    setIsBuffering(false);
    setAutoplayBlocked(false);
  }, []);

  const handlePlayerError = useCallback(
    (err) => {
      console.warn('Playback error / policy block:', err);
      if (playback.isPlaying && playback.phase !== 'buffering') {
        setAutoplayBlocked(true);
      }
    },
    [playback.isPlaying, playback.phase]
  );

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
          downloadState={downloadState}
          barrierState={barrierState}
          countdownMs={countdownMs}
          nextTrackPrefetchInfo={nextTrackPrefetchInfo}
          bluetoothSafe={bluetoothSafe}
          onToggleBluetoothSafe={handleToggleBluetoothSafe}
          onUnlockAutoplay={handleUnlockAutoplay}
          onPrevTrack={handlePrevTrack}
          onPlayOrPause={handlePlayOrPause}
          onNextTrack={handleNextTrack}
          onCycleRepeat={handleCycleRepeat}
          onToggleWaitForListeners={handleToggleWaitForListeners}
          onForceStartNow={handleForceStartNow}
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
            nextTrackId={nextTrack?.id}
            playback={playback}
            cacheVersion={cacheVersion}
            isAddingUrl={isAddingUrl}
            onAddTrackByUrl={handleAddTrackByUrl}
            onAddBatchTracks={handleAddBatchTracks}
            onPlayPresetNow={handlePlayPresetNow}
            onPlayPresetNext={handlePlayPresetNext}
            onPlayTrack={handlePlayTrack}
            onPlayNextInQueue={handlePlayNextInQueue}
            onMoveTrack={handleMoveTrack}
            onRemoveTrack={handleRemoveTrack}
            onClearQueue={handleClearQueue}
          />

          <LobbyPanel
            participants={participants}
            participantId={participantId}
            currentTrack={currentTrack}
            nextTrack={nextTrack}
            queueLength={queue.length}
            playback={playback}
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
