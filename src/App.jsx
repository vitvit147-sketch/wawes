import React, { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeFirebaseStatus } from './utils/firebase';
import {
  musicRoomClient,
  getOrCreateParticipantId,
  generateConnInstanceId
} from './utils/musicRoomClient';
import { unlockAudioElement } from './utils/audioUnlock';
import HomeScreen from './components/HomeScreen';
import RoomScreen from './components/RoomScreen';

const STORAGE_ROOM_KEY = 'wavesync_active_room';

export default function App() {
  const [firebaseStatus, setFirebaseStatus] = useState({
    connected: false,
    serverTimeOffsetMs: 0
  });
  const [activeRoomCode, setActiveRoomCode] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(() =>
    Boolean(sessionStorage.getItem(STORAGE_ROOM_KEY))
  );

  const participantId = getOrCreateParticipantId();
  const sharedAudioRef = useRef(null);

  useEffect(() => {
    return subscribeFirebaseStatus(setFirebaseStatus);
  }, []);

  // Авто-переподключение в комнату при обновлении вкладки (если в URL не передана другая комната)
  useEffect(() => {
    const savedCode = sessionStorage.getItem(STORAGE_ROOM_KEY);
    const urlRoomCode = new URLSearchParams(window.location.search).get('room')?.replace(/\D/g, '');
    if (!savedCode || (urlRoomCode && urlRoomCode !== savedCode)) {
      if (urlRoomCode && savedCode && urlRoomCode !== savedCode) {
        sessionStorage.removeItem(STORAGE_ROOM_KEY);
      }
      setIsReconnecting(false);
      return;
    }

    let cancelled = false;
    musicRoomClient
      .reconnectRoom({ roomCode: savedCode, connInstanceId: generateConnInstanceId() })
      .then((res) => {
        if (cancelled) return;
        if (res?.roomCode) {
          setActiveRoomCode(res.roomCode);
        } else {
          sessionStorage.removeItem(STORAGE_ROOM_KEY);
        }
      })
      .catch(() => {
        if (!cancelled) sessionStorage.removeItem(STORAGE_ROOM_KEY);
      })
      .finally(() => {
        if (!cancelled) setIsReconnecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Подписка на обновления активной комнаты
  useEffect(() => {
    if (!activeRoomCode) {
      setRoomData(null);
      return;
    }

    const unsub = musicRoomClient.subscribeRoom(
      activeRoomCode,
      (normalized) => {
        setRoomData(normalized);
      },
      () => {
        sessionStorage.removeItem(STORAGE_ROOM_KEY);
        setActiveRoomCode(null);
        setRoomData(null);
        setErrorMessage('Хост закрыл комнату.');
      }
    );

    return () => unsub();
  }, [activeRoomCode]);

  const handleCreateRoom = useCallback(async ({ name, avatar }) => {
    unlockAudioElement(sharedAudioRef.current);
    const connInstanceId = generateConnInstanceId();
    const { roomCode, initialRoom } = await musicRoomClient.createRoom({
      name,
      avatar,
      connInstanceId
    });
    sessionStorage.setItem(STORAGE_ROOM_KEY, roomCode);
    setRoomData(initialRoom);
    setActiveRoomCode(roomCode);
  }, []);

  const handleJoinRoom = useCallback(async ({ roomCode, name, avatar }) => {
    unlockAudioElement(sharedAudioRef.current);
    const connInstanceId = generateConnInstanceId();
    const res = await musicRoomClient.joinRoom({
      roomCode,
      name,
      avatar,
      connInstanceId
    });
    sessionStorage.setItem(STORAGE_ROOM_KEY, res.roomCode);
    setActiveRoomCode(res.roomCode);
  }, []);

  const handleLeaveRoom = useCallback(
    async (isHost) => {
      const code = activeRoomCode;
      sessionStorage.removeItem(STORAGE_ROOM_KEY);
      setActiveRoomCode(null);
      setRoomData(null);
      if (window.location.search) {
        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch {}
      }
      if (code) {
        await musicRoomClient.leaveRoom({ roomCode: code, isHost });
      }
    },
    [activeRoomCode]
  );

  let screen = null;
  if (isReconnecting) {
    screen = (
      <div className="min-h-[100dvh] flex items-center justify-center text-slate-400 text-sm font-semibold">
        Подключаемся к комнате...
      </div>
    );
  } else if (activeRoomCode && roomData) {
    const isHost = roomData.hostId === participantId;
    screen = (
      <RoomScreen
        room={roomData}
        participantId={participantId}
        isHost={isHost}
        firebaseStatus={firebaseStatus}
        sharedAudioRef={sharedAudioRef}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  } else {
    screen = (
      <HomeScreen
        firebaseStatus={firebaseStatus}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
      />
    );
  }

  return (
    <>
      {screen}
      {/* Единый постоянно смонтированный <audio> для сохранения разрешения автоплея на iOS Safari / Android при входе */}
      <audio ref={sharedAudioRef} preload="auto" playsInline className="sr-only" />
    </>
  );
}
