import React from 'react';
import { Disc3 } from 'lucide-react';

const BARS = [
  { delay: '0ms', height: '42%' },
  { delay: '180ms', height: '82%' },
  { delay: '90ms', height: '60%' },
  { delay: '260ms', height: '95%' },
  { delay: '140ms', height: '72%' },
  { delay: '320ms', height: '50%' },
  { delay: '60ms', height: '88%' }
];

export default function AudioWaveVisualizer({ isPlaying, hasTrack }) {
  return (
    <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-gradient-to-br from-sky-500/20 via-indigo-500/20 to-fuchsia-500/20 border border-white/15 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
      {!hasTrack ? (
        <Disc3 className="w-10 h-10 text-slate-500" />
      ) : isPlaying ? (
        <div className="flex items-end justify-center gap-1.5 h-10 px-2">
          {BARS.map((bar, idx) => (
            <span
              key={idx}
              className="w-1.5 rounded-full bg-gradient-to-t from-sky-400 to-fuchsia-400 eq-bar"
              style={{
                height: bar.height,
                animationDelay: bar.delay
              }}
            />
          ))}
        </div>
      ) : (
        <Disc3 className="w-10 h-10 text-sky-400/80" />
      )}
    </div>
  );
}
