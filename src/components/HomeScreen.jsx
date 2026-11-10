import React, { useState, useEffect } from 'react';
import {
  Headphones,
  Radio,
  Sparkles,
  LogIn,
  ShieldCheck,
  Wifi,
  WifiOff,
  AlertTriangle,
  Music2
} from 'lucide-react';
import { getSavedProfile, saveProfile } from '../utils/musicRoomClient';

const AVATAR_OPTIONS = ['🎧', '🎵', '💿', '🎙️', '🦊', '🚀', '⚡', '🌙'];

export default function HomeScreen({
  firebaseStatus,
  errorMessage,
  setErrorMessage,
  onCreateRoom,
  onJoinRoom
}) {
  const saved = getSavedProfile();
  const [name, setName] = useState(saved.name || '');
  const [avatar, setAvatar] = useState(saved.avatar || '🎧');
  const [roomCode, setRoomCode] = useState('');
  const [busyMode, setBusyMode] = useState(null); // 'create' | 'join' | null

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramCode = params.get('room');
    if (paramCode) {
      setRoomCode(paramCode.replace(/\D/g, '').slice(0, 6));
    }
  }, []);

  const handleCreate = async () => {
    setErrorMessage('');
    setBusyMode('create');
    saveProfile({ name, avatar });
    try {
      await onCreateRoom({ name: name.trim() || 'Диджей', avatar });
    } catch (e) {
      setErrorMessage(e.message || 'Не удалось создать комнату');
    } finally {
      setBusyMode(null);
    }
  };

  const handleJoin = async (e) => {
    e?.preventDefault();
    const cleaned = roomCode.trim();
    if (!cleaned) {
      setErrorMessage('Введите код комнаты (например 4821)');
      return;
    }
    setErrorMessage('');
    setBusyMode('join');
    saveProfile({ name, avatar });
    try {
      await onJoinRoom({
        roomCode: cleaned,
        name: name.trim() || 'Слушатель',
        avatar
      });
    } catch (e) {
      setErrorMessage(e.message || 'Не удалось войти в комнату');
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col justify-between px-4 py-6 sm:py-10">
      <main className="w-full max-w-lg mx-auto">
        {/* Заголовок */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-extrabold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Watch2Gether · Синхронный плеер</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white mb-2">
            Wave<span className="text-sky-400">Sync</span>
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-md mx-auto leading-relaxed">
            Слушайте музыку и смотрите клипы вместе с друзьями в идеальном синхроне через YouTube, SoundCloud и прямые аудиоссылки.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-5 p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-sm font-semibold flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Профиль */}
        <section className="rounded-3xl bg-slate-900/80 border border-white/10 p-5 mb-5 shadow-xl backdrop-blur-md">
          <div className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-3">
            Ваш профиль в эфире
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {AVATAR_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setAvatar(emoji)}
                className={`w-10 h-10 rounded-2xl text-xl flex items-center justify-center border transition-all cursor-pointer ${
                  avatar === emoji
                    ? 'bg-sky-500/25 border-sky-400 scale-105 shadow-md shadow-sky-500/20'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="Ваше имя (например, Дима)"
            className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:border-sky-500 outline-none font-medium"
          />
        </section>

        {/* Действие 1: Создать как хост */}
        <section className="rounded-3xl bg-gradient-to-br from-sky-950/70 via-slate-900/90 to-indigo-950/70 border border-sky-500/30 p-5 mb-5 shadow-xl">
          <div className="flex items-start gap-3.5 mb-4">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400 shrink-0">
              <Radio className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white">Создать комнату (Хост)</h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-0.5 leading-relaxed">
                Вы создаёте плейлист и управляете воспроизведением. Друзья подключаются по коду и слушают секунда в секунду.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={busyMode !== null}
            onClick={handleCreate}
            className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50 text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-lg shadow-sky-600/30 active:scale-[0.99] transition-all min-h-[52px] cursor-pointer disabled:cursor-default"
          >
            <Headphones className="w-5 h-5" />
            <span>{busyMode === 'create' ? 'Создаём комнату...' : 'Создать эфир'}</span>
          </button>
        </section>

        {/* Действие 2: Подключиться как слушатель */}
        <section className="rounded-3xl bg-slate-900/80 border border-white/10 p-5 shadow-xl">
          <div className="flex items-start gap-3.5 mb-4">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
              <LogIn className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white">Подключиться к комнате</h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Введите 4-значный номер комнаты от хоста — трек заиграет синхронно.
              </p>
            </div>
          </div>

          <form onSubmit={handleJoin} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              inputMode="numeric"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.replace(/\s+/g, '').slice(0, 6))}
              placeholder="Код (напр. 4821)"
              className="sm:w-44 px-4 py-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-center text-xl font-black tracking-widest font-mono text-sky-300 placeholder-slate-600 focus:border-emerald-500 outline-none"
            />
            <button
              type="submit"
              disabled={busyMode !== null}
              className="flex-1 py-3.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 active:scale-[0.99] transition-all min-h-[52px] cursor-pointer disabled:cursor-default"
            >
              <span>{busyMode === 'join' ? 'Подключение...' : 'Войти и слушать'}</span>
            </button>
          </form>
        </section>
      </main>

      {/* Нижняя строка статуса */}
      <footer className="w-full max-w-lg mx-auto mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 px-1">
        <div className="flex items-center gap-2">
          {firebaseStatus.connected ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
              <Wifi className="w-3.5 h-3.5" />
              Сервер синхронизации онлайн (offset {Math.round(firebaseStatus.serverTimeOffsetMs)} мс)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
              <WifiOff className="w-3.5 h-3.5" />
              Подключение к серверу синхронизации...
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-slate-400">
          <Music2 className="w-3.5 h-3.5 text-sky-400" />
          <span>YouTube · SoundCloud · Audio</span>
        </div>
      </footer>

      <div className="w-full max-w-lg mx-auto mt-2 px-1 text-[11px] text-slate-500 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span>Работает на любых смартфонах и ПК без ограничений провайдеров и NAT.</span>
      </div>
    </div>
  );
}
