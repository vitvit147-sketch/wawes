import React, { useState } from 'react';
import { X, Server, Check, RotateCcw } from 'lucide-react';
import { getCustomTurnConfig, saveCustomTurnConfig } from '../utils/webrtcTransfer';

export default function TurnSettingsModal({ onClose, onSaved }) {
  const existing = getCustomTurnConfig();
  const [urls, setUrls] = useState(existing?.urls || '');
  const [username, setUsername] = useState(existing?.username || '');
  const [credential, setCredential] = useState(existing?.credential || '');

  const handleSave = (e) => {
    e.preventDefault();
    saveCustomTurnConfig({ urls, username, credential });
    onSaved?.();
    onClose();
  };

  const handleClear = () => {
    setUrls('');
    setUsername('');
    setCredential('');
    saveCustomTurnConfig(null);
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md p-6 bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Настройки P2P / TURN</h3>
            <p className="text-xs text-slate-400">Опционально — для жёсткого мобильного NAT</p>
          </div>
        </div>

        <p className="text-xs text-slate-300 bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 leading-relaxed mb-4">
          По умолчанию используются бесплатные STUN-серверы (Google / Cloudflare) — в одной сети Wi-Fi и на большинстве провайдеров файлы передаются напрямую без настроек. Если мобильные операторы блокируют прямое P2P-соединение, можно указать бесплатный TURN-сервер (например, от Metered или Cloudflare).
        </p>

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              TURN URL
            </label>
            <input
              type="text"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="turn:global.relay.metered.ca:80"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 focus:border-sky-500 outline-none text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="опционально"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 focus:border-sky-500 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Credential
              </label>
              <input
                type="password"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                placeholder="опционально"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-600 focus:border-sky-500 outline-none text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Сбросить</span>
            </button>
            <button
              type="submit"
              className="flex-1 py-3 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-600/25 transition-all"
            >
              <Check className="w-4 h-4" />
              <span>Сохранить и применить</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
