import React from 'react';
import { Users, CheckCircle2, Download, Radio } from 'lucide-react';

const LobbyPanel = React.memo(function LobbyPanel({
  participants = [],
  participantId,
  currentTrack,
  nextTrack,
  queueLength = 0,
  playback
}) {
  const onlineCount = participants.filter((p) => p.isOnline !== false).length;
  const isPlaying = Boolean(playback?.isPlaying && playback?.phase !== 'buffering');
  const isBufferingPhase = playback?.phase === 'buffering';

  return (
    <section className="lg:col-span-2 rounded-3xl bg-slate-900/80 border border-white/10 p-5 shadow-xl flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-extrabold text-white">
              В эфире ({onlineCount})
            </h3>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Синхрон
          </span>
        </div>

        <div className="space-y-2.5">
          {participants.map((p) => {
            const isMe = p.id === participantId;
            const isOnline = p.isOnline !== false;
            const trackId = currentTrack?.id;
            const pct = Math.max(0, Math.min(100, Number(p.downloadProgress) || 0));
            const isReadyForTrack =
              Boolean(trackId) &&
              p.readyTrackId === trackId &&
              (p.status === 'ready' || p.status === 'direct-stream' || p.status === 'playing');

            let statusText = 'В комнате';
            let statusTone = 'text-slate-400';

            if (!isOnline) {
              statusText = 'Отключён';
              statusTone = 'text-slate-500';
            } else if (!trackId) {
              statusText = p.isHost ? 'Ведущий' : 'На связи';
              statusTone = p.isHost ? 'text-sky-400' : 'text-slate-300';
            } else if (p.status === 'downloading' && !isReadyForTrack) {
              statusText = `Загрузка · ${pct}%`;
              statusTone = 'text-sky-300';
            } else if (p.status === 'direct-stream' && isReadyForTrack) {
              statusText = 'Прямой поток';
              statusTone = 'text-amber-300';
            } else if (isReadyForTrack) {
              if (isBufferingPhase) {
                statusText = 'Готов к старту';
                statusTone = 'text-emerald-300';
              } else if (isPlaying) {
                statusText = p.isHost ? 'Ведёт эфир ▶' : 'В эфире ▶';
                statusTone = 'text-emerald-400';
              } else {
                statusText = 'Готов (пауза)';
                statusTone = 'text-sky-300';
              }
            } else {
              statusText = `Подготовка... ${pct}%`;
              statusTone = 'text-amber-300';
            }

            const showProgressBar =
              isOnline && Boolean(trackId) && !isReadyForTrack && pct < 100;
            const isNextReady = Boolean(nextTrack?.id && p.nextReadyTrackId === nextTrack.id);
            const cachedCount = Number(p.cachedTrackCount) || 0;

            return (
              <div
                key={p.id}
                className={`p-3 rounded-2xl border transition-all ${
                  isOnline
                    ? 'bg-slate-950/60 border-white/10'
                    : 'bg-slate-950/30 border-white/5 opacity-55'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-xl shrink-0">
                      {p.avatar || '🎧'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                        <span>{p.name}</span>
                        {isMe && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-extrabold">
                            ВЫ
                          </span>
                        )}
                      </div>
                      <div className={`text-xs font-semibold flex items-center gap-1.5 mt-0.5 ${statusTone}`}>
                        {!isOnline ? null : isReadyForTrack ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : trackId ? (
                          <Download className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                        ) : p.isHost ? (
                          <Radio className="w-3.5 h-3.5 shrink-0" />
                        ) : null}
                        <span className="truncate">{statusText}</span>
                      </div>
                    </div>
                  </div>

                  {p.isHost ? (
                    <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 shrink-0">
                      HOST
                    </span>
                  ) : isOnline && trackId ? (
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg shrink-0 ${
                        isReadyForTrack
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-sky-500/15 text-sky-300'
                      }`}
                    >
                      {isReadyForTrack ? '100%' : `${pct}%`}
                    </span>
                  ) : null}
                </div>

                {showProgressBar && (
                  <div className="mt-2.5 w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400 transition-all duration-200"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                )}

                {isOnline && (nextTrack?.id || queueLength > 0) && (
                  <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between gap-2 text-[10px]">
                    {nextTrack?.id ? (
                      isNextReady ? (
                        <span className="text-emerald-300 font-bold">
                          ⏭️ След. трек готов
                        </span>
                      ) : (
                        <span className="text-sky-300/80 font-medium">
                          ⬇️ Предзагрузка...
                        </span>
                      )
                    ) : (
                      <span />
                    )}

                    {queueLength > 0 && (
                      <span className="text-slate-400 font-mono shrink-0">
                        Кэш: {Math.min(cachedCount, queueLength)}/{queueLength}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});

export default LobbyPanel;
