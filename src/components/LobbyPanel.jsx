import React from 'react';
import { Users, Radio, Sparkles } from 'lucide-react';

export default function LobbyPanel({
  participants = [],
  participantId,
  isHost,
  currentTrack,
  isPlaying
}) {
  const onlineCount = participants.filter((p) => p.isOnline).length;

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
            Live Sync
          </span>
        </div>

        <div className="space-y-2.5">
          {participants.map((p) => {
            const isMe = p.id === participantId;

            let statusText = 'В комнате';
            let statusTone = 'text-slate-400';

            if (!p.isOnline) {
              statusText = 'Отключён';
              statusTone = 'text-slate-500';
            } else if (p.isHost) {
              statusText = isPlaying ? 'Ведёт эфир ▶' : 'Ведущий эфира (пауза)';
              statusTone = 'text-sky-400';
            } else if (isPlaying && currentTrack) {
              statusText = 'Слушает синхронно';
              statusTone = 'text-emerald-400';
            } else {
              statusText = 'На связи';
              statusTone = 'text-slate-300';
            }

            return (
              <div
                key={p.id}
                className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                  p.isOnline
                    ? 'bg-slate-950/60 border-white/10'
                    : 'bg-slate-950/30 border-white/5 opacity-55'
                }`}
              >
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
                    <div className={`text-xs font-semibold ${statusTone}`}>{statusText}</div>
                  </div>
                </div>

                {p.isHost && (
                  <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 shrink-0">
                    HOST
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-white/10 text-[11px] text-slate-400 leading-relaxed flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
        <span>Потоки транслируются напрямую, а время сверяется через Firebase Realtime WebSocket без задержек.</span>
      </div>
    </section>
  );
}
