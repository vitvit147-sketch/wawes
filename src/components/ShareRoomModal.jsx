import React, { useState } from 'react';
import { X, Copy, Check, QrCode } from 'lucide-react';

export default function ShareRoomModal({ roomCode, onClose }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(shareUrl)}&size=240x240&bgcolor=0f172a&color=38bdf8&qzone=2`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-sm p-6 bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl text-center">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-500/25">
          <QrCode className="w-6 h-6" />
        </div>

        <h3 className="text-xl font-black text-white mb-1">Пригласить в эфир</h3>
        <p className="text-sm text-slate-400 mb-4">
          Отправьте ссылку или покажите QR-код слушателям
        </p>

        <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl inline-block mb-4 shadow-inner">
          <img
            src={qrUrl}
            alt={`QR комнаты ${roomCode}`}
            className="w-48 h-48 mx-auto rounded-xl"
          />
        </div>

        <div className="text-3xl font-black tracking-widest text-sky-400 mb-4 font-mono">
          № {roomCode}
        </div>

        <button
          type="button"
          onClick={copyLink}
          className="w-full py-3.5 px-4 rounded-2xl font-bold flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/30 transition-all active:scale-95"
        >
          {copied ? (
            <>
              <Check className="w-5 h-5 text-emerald-300" />
              <span>Ссылка скопирована!</span>
            </>
          ) : (
            <>
              <Copy className="w-5 h-5" />
              <span>Скопировать ссылку</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
