import React, { useState, useMemo } from 'react';
import {
  Music2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  Sparkles,
  ListStart,
  Check,
  Search,
  Flame,
  Disc,
  Mic2,
  X
} from 'lucide-react';

function YouTubeIcon({ className = "w-3 h-3 text-red-400" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
import { formatDuration, formatBytes } from '../utils/audioMetadata';
import { DEMO_PRESETS } from '../utils/mediaUrlResolver';
import { getTrackCacheStatus } from '../utils/trackLoader';

export default function QueuePanel({
  queue = [],
  isHost,
  currentTrack,
  nextTrackId,
  playback,
  cacheVersion,
  isAddingUrl,
  onAddTrackByUrl,
  onAddBatchTracks,
  onPlayTrack,
  onPlayNextInQueue,
  onMoveTrack,
  onRemoveTrack
}) {
  const [inputUrl, setInputUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedTab, setSelectedTab] = useState('hits');
  const [selectedAlbum, setSelectedAlbum] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const queueUrlSet = new Set(queue.map((t) => t.url));
  const cachedCount = queue.reduce((acc, t) => {
    if (t.source === 'soundcloud' || t.source === 'youtube') return acc + 1;
    return acc + (getTrackCacheStatus(t.url).isReady ? 1 : 0);
  }, 0);
  const cachePct = queue.length > 0 ? Math.round((cachedCount / queue.length) * 100) : 0;

  const albumList = useMemo(() => {
    const order = [
      'KARMA', 'DO IT', '合 (HOP)', 'ATE', '5-STAR', 'ROCK-STAR',
      'MAXIDENT', 'CIRCUS', 'ODDINARY', 'NOEASY', 'ALL IN',
      'IN生 (IN LIFE)', 'GO生 (GO LIVE)', 'Clé : LEVANTER',
      'Yellow Wood', 'Clé 1 : MIROH', 'I am YOU', 'I am WHO', 'I am NOT', 'Mixtape'
    ];
    const counts = new Map();
    for (const p of DEMO_PRESETS) {
      if (!p.album || p.album === '3RACHA') continue;
      counts.set(p.album, (counts.get(p.album) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
      .map(([name, count]) => ({ name, count }));
  }, []);

  const filteredPresets = useMemo(() => {
    return DEMO_PRESETS.filter((p) => {
      if (selectedTab === 'albums') {
        if (selectedAlbum !== 'all') {
          if (p.album !== selectedAlbum) return false;
        } else if (p.category === '3racha') {
          return false;
        }
      } else if (selectedTab !== 'all' && p.category !== selectedTab) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        p.title.toLowerCase().includes(q) ||
        (p.album && p.album.toLowerCase().includes(q)) ||
        p.artist.toLowerCase().includes(q)
      );
    });
  }, [selectedTab, selectedAlbum, searchQuery]);

  const tabCounts = useMemo(() => ({
    all: DEMO_PRESETS.length,
    hits: DEMO_PRESETS.filter((p) => p.category === 'hits').length,
    albums: DEMO_PRESETS.filter((p) => p.category !== '3racha').length,
    solo: DEMO_PRESETS.filter((p) => p.category === 'solo').length,
    racha: DEMO_PRESETS.filter((p) => p.category === '3racha').length
  }), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputUrl.trim() || isAddingUrl) return;
    setErrorMsg('');
    try {
      await onAddTrackByUrl(inputUrl.trim());
      setInputUrl('');
    } catch (err) {
      setErrorMsg(err.message || 'Не удалось распознать ссылку');
    }
  };

  const handleAddPreset = async (preset) => {
    if (isAddingUrl) return;
    setErrorMsg('');
    try {
      await onAddTrackByUrl(preset.url, preset);
    } catch (err) {
      setErrorMsg(err.message || 'Не удалось добавить демо-трек');
    }
  };

  return (
    <section className="lg:col-span-3 rounded-3xl bg-slate-900/80 border border-white/10 p-5 shadow-xl">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Music2 className="w-5 h-5 text-sky-400" />
          <h3 className="text-base font-extrabold text-white">
            Очередь треков ({queue.length})
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {queue.length > 0 && (
            <span
              className={`px-2 py-0.5 rounded-lg font-bold border ${
                cachedCount === queue.length
                  ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                  : 'bg-sky-500/15 border-sky-400/30 text-sky-300'
              }`}
            >
              ⚡ Кэш: {cachedCount}/{queue.length}
            </span>
          )}
          <span className="text-slate-400 font-semibold hidden sm:inline">
            {isHost ? 'Ведущий' : 'Синхронизировано'}
          </span>
        </div>
      </div>

      {queue.length > 0 && cachedCount < queue.length && (
        <div className="mb-4 w-full h-1 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-300"
            style={{ width: `${Math.max(4, cachePct)}%` }}
          />
        </div>
      )}

      {/* Форма добавления по ссылке (доступна хосту) */}
      {isHost && (
        <div className="mb-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => {
                setInputUrl(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="Ссылка SoundCloud или прямой MP3/M4A/WAV..."
              disabled={isAddingUrl}
              className="flex-1 rounded-2xl bg-slate-950/80 border border-white/10 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
            />
            <button
              type="submit"
              disabled={isAddingUrl || !inputUrl.trim()}
              className="px-4 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-sm flex items-center gap-1.5 shadow-md shadow-sky-600/25 transition-all cursor-pointer disabled:cursor-default shrink-0"
            >
              {isAddingUrl ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>Добавить</span>
            </button>
          </form>

          {errorMsg && (
            <p className="text-xs text-rose-400 mt-2 px-1 font-semibold">{errorMsg}</p>
          )}

          {/* Каталог Stray Kids с вкладками и мгновенным поиском */}
          <div className="mt-3.5 pt-3.5 border-t border-white/5">
            {/* Вкладки категорий */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-2.5 scrollbar-none">
              <button
                type="button"
                onClick={() => { setSelectedTab('hits'); setSelectedAlbum('all'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'hits'
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                    : 'bg-slate-950/70 text-slate-400 hover:text-white hover:bg-slate-800 border border-white/5'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Хиты ({tabCounts.hits})</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('albums')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'albums'
                    ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                    : 'bg-slate-950/70 text-slate-400 hover:text-white hover:bg-slate-800 border border-white/5'
                }`}
              >
                <Disc className="w-3.5 h-3.5" />
                <span>Альбомы ({tabCounts.albums})</span>
              </button>
              <button
                type="button"
                onClick={() => { setSelectedTab('solo'); setSelectedAlbum('all'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'solo'
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                    : 'bg-slate-950/70 text-slate-400 hover:text-white hover:bg-slate-800 border border-white/5'
                }`}
              >
                <Mic2 className="w-3.5 h-3.5" />
                <span>Соло ({tabCounts.solo})</span>
              </button>
              <button
                type="button"
                onClick={() => { setSelectedTab('3racha'); setSelectedAlbum('all'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === '3racha'
                    ? 'bg-fuchsia-500 text-white shadow-md shadow-fuchsia-500/20'
                    : 'bg-slate-950/70 text-slate-400 hover:text-white hover:bg-slate-800 border border-white/5'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>3RACHA ({tabCounts.racha})</span>
              </button>
              <button
                type="button"
                onClick={() => { setSelectedTab('all'); setSelectedAlbum('all'); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'all'
                    ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                    : 'bg-slate-950/70 text-slate-400 hover:text-white hover:bg-slate-800 border border-white/5'
                }`}
              >
                Все ({tabCounts.all})
              </button>
            </div>

            {/* Фильтр по конкретному альбому */}
            {selectedTab === 'albums' && albumList.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 mb-2 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedAlbum('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    selectedAlbum === 'all'
                      ? 'bg-indigo-400/25 text-indigo-200 border border-indigo-400/50'
                      : 'bg-slate-950/60 text-slate-400 hover:text-white border border-white/5'
                  }`}
                >
                  Все альбомы
                </button>
                {albumList.map((alb) => (
                  <button
                    key={alb.name}
                    type="button"
                    onClick={() => setSelectedAlbum(alb.name)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      selectedAlbum === alb.name
                        ? 'bg-indigo-400/25 text-indigo-200 border border-indigo-400/50'
                        : 'bg-slate-950/60 text-slate-400 hover:text-white border border-white/5'
                    }`}
                  >
                    {alb.name} ({alb.count})
                  </button>
                ))}
              </div>
            )}

            {/* Строка поиска и кнопка пакетного добавления */}
            <div className="flex items-center gap-2 mb-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск трека или альбома..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950/90 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {onAddBatchTracks && filteredPresets.length > 0 && (
                <button
                  type="button"
                  disabled={isAddingUrl}
                  onClick={async () => {
                    await onAddBatchTracks(filteredPresets);
                  }}
                  className="px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-400/30 text-xs font-bold cursor-pointer transition-all active:scale-95 whitespace-nowrap shrink-0"
                >
                  ⚡ Добавить ({filteredPresets.length})
                </button>
              )}
            </div>

            {/* Сетка карточек треков каталога */}
            <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-1">
              {filteredPresets.length === 0 ? (
                <div className="w-full py-4 text-center text-xs text-slate-500">
                  Ничего не найдено по запросу «{searchQuery}»
                </div>
              ) : (
                filteredPresets.map((preset) => {
                  const isAdded = queueUrlSet.has(preset.url);
                  const isUpNext = nextTrackId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={isAddingUrl}
                      onClick={() => handleAddPreset(preset)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all flex items-center gap-2 cursor-pointer disabled:cursor-default ${
                        isUpNext
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                          : isAdded
                          ? 'bg-slate-900/90 border-sky-400/30 text-sky-200 hover:bg-sky-500/20'
                          : 'bg-slate-950/70 hover:bg-slate-800/80 border-white/10 hover:border-sky-400/40 text-slate-300'
                      }`}
                    >
                      {preset.thumbnail ? (
                        <img
                          src={preset.thumbnail}
                          alt=""
                          className="w-4 h-4 rounded-md object-cover shrink-0"
                          loading="lazy"
                        />
                      ) : isAdded ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Music2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      )}
                      <span className="truncate max-w-[130px] font-semibold">{preset.title}</span>
                      {preset.album && (
                        <span className="text-[10px] text-slate-500 px-1 py-0.2 rounded bg-white/5 shrink-0 hidden sm:inline">
                          {preset.album}
                        </span>
                      )}
                      {isAdded && (
                        <span className="text-[10px] text-emerald-400 font-bold shrink-0">
                          {isUpNext ? '⏭️' : '✓'}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Список треков */}
      {queue.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 rounded-2xl bg-slate-950/30 border border-dashed border-white/5">
          {isHost ? 'В очереди пока нет треков' : 'Ожидание музыки от ведущего'}
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
          {queue.map((track, index) => {
            const isActive = track.id === currentTrack?.id;
            const isUpNext = !isActive && track.id === nextTrackId;
            const isYouTube = track.source === 'youtube';
            const isSoundCloud = track.source === 'soundcloud';
            const cacheStatus = getTrackCacheStatus(track.url);

            return (
              <div
                key={track.id || index}
                className={`rounded-2xl p-3 border transition-all flex items-center justify-between gap-3 ${
                  isActive
                    ? 'bg-sky-500/15 border-sky-400/50 shadow-md shadow-sky-500/10'
                    : isUpNext
                    ? 'bg-emerald-500/10 border-emerald-400/35'
                    : 'bg-slate-950/60 border-white/5 hover:border-white/15'
                }`}
              >
                <button
                  type="button"
                  disabled={!isHost}
                  onClick={() => isHost && onPlayTrack(track.id)}
                  className={`flex items-center gap-3 min-w-0 flex-1 text-left ${
                    isHost ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {/* Номер / Превью */}
                  {track.thumbnail ? (
                    <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-slate-800 shrink-0 border border-white/10">
                      <img
                        src={track.thumbnail}
                        alt={track.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {isActive && (
                        <div className="absolute inset-0 bg-sky-900/60 flex items-center justify-center font-bold text-sky-200 text-xs">
                          {playback?.isPlaying ? '▶' : '⏸'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-black ${
                        isActive ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {isActive && playback?.isPlaying ? '▶' : index + 1}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-white truncate">{track.title}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                      <span className="truncate max-w-[150px]">{track.artist}</span>
                      <span>·</span>
                      <span className="font-semibold text-sky-300">
                        {isYouTube ? 'YouTube' : isSoundCloud ? 'SoundCloud' : 'AAC/Audio'}
                      </span>
                      {track.duration > 0 && (
                        <>
                          <span>·</span>
                          <span>{formatDuration(track.duration)}</span>
                        </>
                      )}
                      {track.sizeBytes > 0 && (
                        <>
                          <span>·</span>
                          <span>{formatBytes(track.sizeBytes)}</span>
                        </>
                      )}
                      {isUpNext && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-extrabold text-[10px]">
                          ⏭️ След.
                        </span>
                      )}
                      {cacheStatus.inMemory ? (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold text-[10px]">
                          ⚡ В RAM
                        </span>
                      ) : cacheStatus.inDiskCache ? (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold text-[10px]">
                          💾 В кэше
                        </span>
                      ) : cacheStatus.isDownloading ? (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono font-bold text-[10px]">
                          ⬇️ {cacheStatus.progress}%
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>

                {/* Действия для хоста */}
                {isHost && (
                  <div className="flex items-center gap-1 shrink-0">
                    {!isActive && !isUpNext && onPlayNextInQueue && (
                      <button
                        type="button"
                        onClick={() => onPlayNextInQueue(track.id)}
                        className="px-2 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/30 border border-sky-400/25 text-sky-300 text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <ListStart className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">След.</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => onMoveTrack(index, -1)}
                      className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-20 text-slate-300 transition-all cursor-pointer disabled:cursor-default"
                      title="Выше"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === queue.length - 1}
                      onClick={() => onMoveTrack(index, 1)}
                      className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-20 text-slate-300 transition-all cursor-pointer disabled:cursor-default"
                      title="Ниже"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveTrack(track.id)}
                      className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-rose-500/20 hover:text-rose-300 text-slate-400 transition-all cursor-pointer"
                      title="Удалить из очереди"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
