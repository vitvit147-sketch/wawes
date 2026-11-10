import React, { useState, useMemo } from 'react';
import {
  Music2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Loader2,
  Sparkles,
  ListStart,
  Check,
  Search,
  Flame,
  Disc,
  Mic2,
  X,
  Play,
  ListMusic,
  Library
} from 'lucide-react';
import { formatDuration, formatBytes } from '../utils/audioMetadata';
import { DEMO_PRESETS } from '../utils/mediaUrlResolver';
import { getTrackCacheStatus } from '../utils/trackLoader';

const ALBUM_META = {
  KARMA: { year: '2025', gradient: 'from-rose-600/80 via-red-900/80 to-amber-700/60' },
  'DO IT': { year: '2025', gradient: 'from-amber-500/80 via-orange-800/80 to-slate-900' },
  '合 (HOP)': { year: '2024', gradient: 'from-cyan-500/75 via-sky-800/80 to-indigo-950' },
  ATE: { year: '2024', gradient: 'from-amber-500/75 via-stone-800 to-zinc-950' },
  '5-STAR': { year: '2023', gradient: 'from-emerald-500/75 via-teal-900/80 to-slate-950' },
  'ROCK-STAR': { year: '2023', gradient: 'from-red-600/80 via-pink-900/80 to-zinc-950' },
  MAXIDENT: { year: '2022', gradient: 'from-pink-500/80 via-rose-700/80 to-fuchsia-950' },
  CIRCUS: { year: '2022', gradient: 'from-red-500/75 via-amber-700/70 to-indigo-950' },
  ODDINARY: { year: '2022', gradient: 'from-lime-500/75 via-emerald-900/80 to-zinc-950' },
  NOEASY: { year: '2021', gradient: 'from-red-600/80 via-blue-900/80 to-slate-950' },
  'ALL IN': { year: '2020', gradient: 'from-orange-500/80 via-red-800/80 to-slate-950' },
  'IN生 (IN LIFE)': { year: '2020', gradient: 'from-fuchsia-600/80 via-amber-600/65 to-slate-950' },
  'GO生 (GO LIVE)': { year: '2020', gradient: 'from-orange-600/80 via-red-900/80 to-zinc-950' },
  'Clé : LEVANTER': { year: '2019', gradient: 'from-sky-400/75 via-indigo-800/80 to-slate-950' },
  'Yellow Wood': { year: '2019', gradient: 'from-yellow-500/75 via-amber-800/80 to-stone-950' },
  'Clé 1 : MIROH': { year: '2019', gradient: 'from-sky-500/80 via-slate-800 to-emerald-950' },
  'I am YOU': { year: '2018', gradient: 'from-blue-500/75 via-indigo-800/80 to-slate-950' },
  'I am WHO': { year: '2018', gradient: 'from-cyan-600/75 via-teal-900/80 to-slate-950' },
  'I am NOT': { year: '2018', gradient: 'from-violet-600/75 via-slate-800 to-zinc-950' },
  Mixtape: { year: '2018', gradient: 'from-indigo-500/75 via-purple-900/80 to-slate-950' },
  'SKZ-REPLAY': { year: 'Solo', gradient: 'from-teal-500/75 via-emerald-900/80 to-slate-950' },
  'SKZ-RECORD': { year: 'Record', gradient: 'from-emerald-500/75 via-cyan-900/80 to-slate-950' },
  'SKZ-PLAYER': { year: 'Player', gradient: 'from-sky-500/75 via-purple-900/80 to-slate-950' },
  '3RACHA': { year: '2017', gradient: 'from-fuchsia-600/80 via-purple-900/80 to-zinc-950' }
};

function getAlbumStyle(album) {
  return ALBUM_META[album] || { year: '', gradient: 'from-sky-600/70 via-slate-800 to-slate-950' };
}

const QueuePanel = React.memo(function QueuePanel({
  queue = [],
  isHost,
  currentTrack,
  nextTrackId,
  playback,
  cacheVersion,
  isAddingUrl,
  onAddTrackByUrl,
  onAddBatchTracks,
  onPlayPresetNow,
  onPlayPresetNext,
  onPlayTrack,
  onPlayNextInQueue,
  onMoveTrack,
  onRemoveTrack,
  onClearQueue
}) {
  const [viewMode, setViewMode] = useState(() => (queue.length === 0 ? 'library' : 'library'));
  const [inputUrl, setInputUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedTab, setSelectedTab] = useState('hits');
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllCatalog, setShowAllCatalog] = useState(false);

  const activeView = isHost ? viewMode : 'queue';
  const queueUrlSet = useMemo(() => new Set(queue.map((t) => t.url)), [queue]);

  const cachedCount = queue.reduce((acc, t) => {
    if (t.source === 'soundcloud' || t.source === 'youtube') return acc + 1;
    return acc + (getTrackCacheStatus(t.url).isReady ? 1 : 0);
  }, 0);
  const cachePct = queue.length > 0 ? Math.round((cachedCount / queue.length) * 100) : 0;

  const albumCards = useMemo(() => {
    const order = Object.keys(ALBUM_META);
    const map = new Map();
    for (const p of DEMO_PRESETS) {
      if (!p.album || p.album === '3RACHA') continue;
      if (!map.has(p.album)) {
        map.set(p.album, { name: p.album, tracks: [], thumbnail: p.thumbnail || null });
      }
      const entry = map.get(p.album);
      entry.tracks.push(p);
      if (!entry.thumbnail && p.thumbnail) entry.thumbnail = p.thumbnail;
    }
    return [...map.values()].sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, []);

  const filteredPresets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return DEMO_PRESETS.filter((p) => {
      if (q) {
        return (
          p.title.toLowerCase().includes(q) ||
          (p.album && p.album.toLowerCase().includes(q)) ||
          p.artist.toLowerCase().includes(q)
        );
      }
      if (selectedTab === 'albums') {
        return selectedAlbum ? p.album === selectedAlbum : false;
      }
      if (selectedTab === 'all') return true;
      return p.category === selectedTab;
    });
  }, [selectedTab, selectedAlbum, searchQuery]);

  const tabCounts = useMemo(
    () => ({
      all: DEMO_PRESETS.length,
      hits: DEMO_PRESETS.filter((p) => p.category === 'hits').length,
      albums: albumCards.length,
      solo: DEMO_PRESETS.filter((p) => p.category === 'solo').length,
      racha: DEMO_PRESETS.filter((p) => p.category === '3racha').length
    }),
    [albumCards.length]
  );

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

  const showAlbumGrid = selectedTab === 'albums' && !selectedAlbum && !searchQuery.trim();
  const visibleTracks =
    searchQuery.trim() || showAllCatalog || selectedAlbum
      ? filteredPresets
      : filteredPresets.slice(0, 45);

  const activeAlbumInfo = selectedAlbum
    ? albumCards.find((a) => a.name === selectedAlbum)
    : null;

  return (
    <section className="lg:col-span-3 rounded-3xl bg-slate-900/85 border border-white/10 p-4 sm:p-5 shadow-xl flex flex-col">
      {/* Верхний переключатель как в Spotify / Яндекс Музыке */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {isHost ? (
          <div className="inline-flex p-1 rounded-2xl bg-slate-950/90 border border-white/10">
            <button
              type="button"
              onClick={() => setViewMode('library')}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeView === 'library'
                  ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Library className="w-4 h-4" />
              <span>Медиатека</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('queue')}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeView === 'queue'
                  ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ListMusic className="w-4 h-4" />
              <span>Очередь ({queue.length})</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ListMusic className="w-5 h-5 text-sky-400" />
            <h3 className="text-base font-extrabold text-white">
              Очередь ({queue.length})
            </h3>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs">
          {queue.length > 0 && (
            <span
              className={`px-2.5 py-1 rounded-xl font-bold border ${
                cachedCount === queue.length
                  ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                  : 'bg-sky-500/15 border-sky-400/30 text-sky-300'
              }`}
            >
              ⚡ Кэш: {cachedCount}/{queue.length}
            </span>
          )}
        </div>
      </div>

      {queue.length > 0 && cachedCount < queue.length && (
        <div className="mb-3.5 w-full h-1 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-300"
            style={{ width: `${Math.max(4, cachePct)}%` }}
          />
        </div>
      )}

      {/* ==================== РЕЖИМ 1: МЕДИАТЕКА (Spotify / Yandex style) ==================== */}
      {isHost && activeView === 'library' && (
        <div className="flex flex-col">
          {/* Поиск по всей медиатеке */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Найти трек, альбом или 3RACHA..."
              className="w-full pl-10 pr-9 py-2.5 rounded-full bg-slate-950 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Пилюли разделов */}
          {!searchQuery.trim() && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 mb-3 scrollbar-none">
              <button
                type="button"
                onClick={() => {
                  setSelectedTab('hits');
                  setSelectedAlbum(null);
                  setShowAllCatalog(false);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'hits'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Flame className="w-3.5 h-3.5 text-amber-500" />
                <span>Популярное ({tabCounts.hits})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedTab('albums');
                  setSelectedAlbum(null);
                  setShowAllCatalog(false);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'albums'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Disc className="w-3.5 h-3.5 text-indigo-400" />
                <span>Альбомы ({tabCounts.albums})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedTab('solo');
                  setSelectedAlbum(null);
                  setShowAllCatalog(false);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'solo'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Mic2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Соло ({tabCounts.solo})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedTab('3racha');
                  setSelectedAlbum(null);
                  setShowAllCatalog(false);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === '3racha'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
                <span>3RACHA ({tabCounts.racha})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedTab('all');
                  setSelectedAlbum(null);
                  setShowAllCatalog(false);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedTab === 'all'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Все ({tabCounts.all})
              </button>
            </div>
          )}

          {/* Плитки альбомов (когда выбрана вкладка Альбомы) */}
          {showAlbumGrid ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[470px] overflow-y-auto pr-1">
              {albumCards.map((alb) => {
                const style = getAlbumStyle(alb.name);
                return (
                  <div
                    key={alb.name}
                    onClick={() => setSelectedAlbum(alb.name)}
                    className="group rounded-2xl bg-slate-950/70 hover:bg-slate-800/75 border border-white/5 hover:border-white/15 p-2.5 transition-all cursor-pointer flex flex-col"
                  >
                    <div
                      className={`relative aspect-square w-full rounded-xl overflow-hidden bg-gradient-to-br ${style.gradient} mb-2.5 flex items-center justify-center shadow-lg`}
                    >
                      {alb.thumbnail ? (
                        <img
                          src={alb.thumbnail}
                          alt={alb.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <Disc className="w-10 h-10 text-white/40 group-hover:scale-110 transition-transform duration-300" />
                      )}

                      {style.year && (
                        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-bold text-slate-200">
                          {style.year}
                        </span>
                      )}

                      <button
                        type="button"
                        disabled={isAddingUrl}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddBatchTracks?.(alb.tracks, true);
                        }}
                        className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center shadow-lg shadow-black/40 transition-all active:scale-95 cursor-pointer"
                        aria-label={`Слушать ${alb.name}`}
                      >
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </button>
                    </div>

                    <div className="text-xs sm:text-sm font-bold text-white truncate">
                      {alb.name}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {alb.tracks.length} треков
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Шапка открытого альбома ИЛИ шапка активного раздела */}
              {activeAlbumInfo && !searchQuery.trim() ? (
                <div className="rounded-2xl bg-slate-950/75 border border-white/10 p-3.5 mb-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedAlbum(null)}
                      className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 cursor-pointer shrink-0"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getAlbumStyle(activeAlbumInfo.name).gradient} flex items-center justify-center overflow-hidden shrink-0`}
                    >
                      {activeAlbumInfo.thumbnail ? (
                        <img
                          src={activeAlbumInfo.thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Disc className="w-6 h-6 text-white/60" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm sm:text-base font-black text-white truncate">
                        {activeAlbumInfo.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        {getAlbumStyle(activeAlbumInfo.name).year} · {activeAlbumInfo.tracks.length} треков
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isAddingUrl}
                      onClick={() => onAddBatchTracks?.(filteredPresets, true)}
                      className="px-3.5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all active:scale-95"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Слушать</span>
                    </button>
                    <button
                      type="button"
                      disabled={isAddingUrl}
                      onClick={() => onAddBatchTracks?.(filteredPresets, false)}
                      className="px-3 py-2 rounded-full bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1 border border-white/10 cursor-pointer transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>В очередь</span>
                    </button>
                  </div>
                </div>
              ) : (
                filteredPresets.length > 0 && (
                  <div className="flex items-center justify-between gap-2 mb-2.5 px-1">
                    <span className="text-xs font-bold text-slate-400">
                      {searchQuery.trim()
                        ? `Найдено: ${filteredPresets.length}`
                        : `Треков: ${filteredPresets.length}`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isAddingUrl}
                        onClick={() => onAddBatchTracks?.(filteredPresets, true)}
                        className="px-3 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs flex items-center gap-1 cursor-pointer transition-all active:scale-95"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Играть все</span>
                      </button>
                      <button
                        type="button"
                        disabled={isAddingUrl}
                        onClick={() => onAddBatchTracks?.(filteredPresets, false)}
                        className="px-2.5 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 font-bold text-xs flex items-center gap-1 cursor-pointer transition-all"
                      >
                        <Plus className="w-3 h-3" />
                        <span>В очередь ({filteredPresets.length})</span>
                      </button>
                    </div>
                  </div>
                )
              )}

              {/* Вертикальный список треков в стиле Spotify / Яндекс Музыки */}
              <div className="space-y-1 max-h-[430px] overflow-y-auto pr-1">
                {filteredPresets.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    Ничего не найдено по запросу «{searchQuery}»
                  </div>
                ) : (
                  <>
                    {visibleTracks.map((preset, idx) => {
                      const isPlayingThis = currentTrack?.url === preset.url;
                      const isQueued = queueUrlSet.has(preset.url);
                      const isUpNext = nextTrackId === preset.id;
                      const albumStyle = getAlbumStyle(preset.album);

                      return (
                        <div
                          key={preset.id}
                          onClick={() => !isAddingUrl && onPlayPresetNow?.(preset)}
                          className={`group rounded-2xl px-2.5 py-2 flex items-center justify-between gap-3 transition-all cursor-pointer ${
                            isPlayingThis
                              ? 'bg-emerald-500/15 border border-emerald-400/30'
                              : 'hover:bg-white/[0.06] border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Обложка / Индекс */}
                            <div
                              className={`relative w-11 h-11 rounded-xl overflow-hidden bg-gradient-to-br ${albumStyle.gradient} flex items-center justify-center shrink-0 shadow`}
                            >
                              {preset.thumbnail ? (
                                <img
                                  src={preset.thumbnail}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <span className="text-xs font-black text-white/75">
                                  {idx + 1}
                                </span>
                              )}

                              <div
                                className={`absolute inset-0 bg-black/55 flex items-center justify-center transition-opacity ${
                                  isPlayingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                <Play
                                  className={`w-4 h-4 fill-current ${
                                    isPlayingThis ? 'text-emerald-400' : 'text-white'
                                  }`}
                                />
                              </div>
                            </div>

                            {/* Название и альбом */}
                            <div className="min-w-0 flex-1">
                              <div
                                className={`text-sm font-bold truncate ${
                                  isPlayingThis ? 'text-emerald-300' : 'text-white'
                                }`}
                              >
                                {preset.title}
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 truncate">
                                <span className="truncate">{preset.artist}</span>
                                {!selectedAlbum && preset.album && (
                                  <>
                                    <span>·</span>
                                    <span className="truncate text-slate-300/80">{preset.album}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Длительность и действия справа */}
                          <div
                            className="flex items-center gap-2 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {preset.duration > 0 && (
                              <span className="text-xs font-mono text-slate-500 hidden sm:inline">
                                {formatDuration(preset.duration)}
                              </span>
                            )}

                            {!isPlayingThis && (
                              <button
                                type="button"
                                disabled={isAddingUrl}
                                onClick={() => onPlayPresetNext?.(preset)}
                                className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                  isUpNext
                                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                                    : 'bg-slate-800/70 hover:bg-slate-700 border-white/10 text-slate-300'
                                }`}
                                aria-label="Поставить следующим"
                              >
                                <ListStart className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={isAddingUrl || isQueued}
                              onClick={() => onAddTrackByUrl?.(preset.url, preset)}
                              className={`p-2 rounded-xl border transition-all cursor-pointer disabled:cursor-default ${
                                isQueued
                                  ? 'bg-sky-500/15 border-sky-400/30 text-sky-300'
                                  : 'bg-slate-800/70 hover:bg-sky-500/25 border-white/10 hover:border-sky-400/40 text-slate-300 hover:text-white'
                              }`}
                              aria-label={isQueued ? 'В очереди' : 'Добавить в очередь'}
                            >
                              {isQueued ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {!searchQuery.trim() && !showAllCatalog && !selectedAlbum && filteredPresets.length > 45 && (
                      <button
                        type="button"
                        onClick={() => setShowAllCatalog(true)}
                        className="w-full mt-2 py-2.5 rounded-2xl border border-white/10 bg-slate-950/70 hover:bg-slate-800 text-sky-300 text-xs font-bold cursor-pointer transition-all"
                      >
                        Показать все треки ({filteredPresets.length})
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ==================== РЕЖИМ 2: ОЧЕРЕДЬ И ПРЯМЫЕ ССЫЛКИ ==================== */}
      {activeView === 'queue' && (
        <div className="flex flex-col">
          {isHost && (
            <div className="mb-3.5">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => {
                    setInputUrl(e.target.value);
                    if (errorMsg) setErrorMsg('');
                  }}
                  placeholder="Ссылка SoundCloud, Яндекс Диск или MP3/M4A..."
                  disabled={isAddingUrl}
                  className="flex-1 rounded-2xl bg-slate-950/80 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={isAddingUrl || !inputUrl.trim()}
                  className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-40 text-white font-bold text-sm flex items-center gap-1.5 shadow-md transition-all cursor-pointer disabled:cursor-default shrink-0"
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
            </div>
          )}

          {isHost && queue.length > 0 && onClearQueue && (
            <div className="flex items-center justify-between gap-2 mb-2.5 px-1">
              <span className="text-xs font-semibold text-slate-400">
                Сейчас в очереди: {queue.length}
              </span>
              <button
                type="button"
                onClick={onClearQueue}
                className="text-xs font-bold text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                Очистить очередь
              </button>
            </div>
          )}

          {queue.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500 rounded-2xl bg-slate-950/30 border border-dashed border-white/5">
              {isHost ? 'Очередь пуста' : 'Ожидание музыки от ведущего'}
            </div>
          ) : (
            <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
              {queue.map((track, index) => {
                const isActive = track.id === currentTrack?.id;
                const isUpNext = !isActive && track.id === nextTrackId;
                const cacheStatus = getTrackCacheStatus(track.url);
                const albumStyle = getAlbumStyle(track.album);

                return (
                  <div
                    key={track.id || index}
                    className={`rounded-2xl p-2.5 border transition-all flex items-center justify-between gap-3 ${
                      isActive
                        ? 'bg-emerald-500/15 border-emerald-400/40 shadow-md shadow-emerald-500/10'
                        : isUpNext
                        ? 'bg-sky-500/10 border-sky-400/35'
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
                      <div
                        className={`relative w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-br ${albumStyle.gradient} flex items-center justify-center shrink-0`}
                      >
                        {track.thumbnail ? (
                          <img
                            src={track.thumbnail}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-xs font-black text-white/80">
                            {isActive && playback?.isPlaying ? '▶' : index + 1}
                          </span>
                        )}
                        {isActive && track.thumbnail && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center font-bold text-emerald-300 text-xs">
                            {playback?.isPlaying ? '▶' : '⏸'}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-sm font-bold truncate ${
                            isActive ? 'text-emerald-300' : 'text-white'
                          }`}
                        >
                          {track.title}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                          <span className="truncate max-w-[140px]">{track.artist}</span>
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
                              ⚡ RAM
                            </span>
                          ) : cacheStatus.inDiskCache ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold text-[10px]">
                              💾 Кэш
                            </span>
                          ) : cacheStatus.isDownloading ? (
                            <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono font-bold text-[10px]">
                              ⬇️ {cacheStatus.progress}%
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>

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
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={index === queue.length - 1}
                          onClick={() => onMoveTrack(index, 1)}
                          className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 disabled:opacity-20 text-slate-300 transition-all cursor-pointer disabled:cursor-default"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveTrack(track.id)}
                          className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-rose-500/20 hover:text-rose-300 text-slate-400 transition-all cursor-pointer"
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
        </div>
      )}
    </section>
  );
});

export default QueuePanel;
