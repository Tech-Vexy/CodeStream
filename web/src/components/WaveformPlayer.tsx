import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';

const BAR_COUNT = 64;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

function fmt(total: number): string {
  if (!Number.isFinite(total) || total < 0) return '--:--';
  const s = Math.floor(total % 60);
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Deterministic per-source bar heights so the shape is stable across renders/reloads. */
function barHeights(count: number, seed: number): number[] {
  let s = seed || 1;
  const rand = () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const wobble = 0.5 + 0.5 * Math.sin(i * 0.55 + seed % 7);
    const h = 0.18 + 0.82 * (0.45 * rand() + 0.55 * wobble);
    out.push(Math.min(1, Math.max(0.1, h)));
  }
  return out;
}

function seedFrom(src: string): number {
  let h = 9;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 387_420_489);
  return Math.abs(h);
}

/**
 * Custom audio player: an animated waveform that scrubs with click/drag and
 * keyboard, driven by a hidden native <audio> element. No external libraries.
 */
export function WaveformPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState<number>(1);

  const bars = useMemo(() => barHeights(BAR_COUNT, seedFrom(src)), [src]);
  const progress = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
  const playedBars = Math.ceil(progress * BAR_COUNT);

  // New source -> reset.
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, src]);

  const seekFraction = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(0, fraction), 1) * audio.duration;
  }, []);

  const fractionFromClientX = useCallback((clientX: number): number | null => {
    const el = waveRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return (clientX - rect.left) / rect.width;
  }, []);

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + delta), audio.duration || Number.MAX_SAFE_INTEGER);
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        // playback blocked (rare for user-initiated clicks)
      }
    } else {
      audio.pause();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      skip(-5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      skip(5);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekFraction(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seekFraction(1);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      void toggle();
    }
  };

  return (
    <div className="wv">
      {/* Hidden native element does the actual playback. */}
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onLoadedMetadata={(e) => {
          const value = e.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onTimeUpdate={(e) => {
          if (!draggingRef.current) setCurrent(e.currentTarget.currentTime);
        }}
      />

      <div className={`wv-row${playing ? ' playing' : ''}`}>
        <button
          type="button"
          className="wv-btn"
          onClick={() => void toggle()}
          aria-label={playing ? 'Pause briefing' : 'Play briefing'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>

        <div
          ref={waveRef}
          className="wv-wave"
          role="slider"
          tabIndex={0}
          aria-label="Seek audio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          onPointerDown={(e) => {
            draggingRef.current = true;
            waveRef.current?.setPointerCapture(e.pointerId);
            const fraction = fractionFromClientX(e.clientX);
            if (fraction !== null) {
              seekFraction(fraction);
              setCurrent(fraction * duration);
            }
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return;
            const fraction = fractionFromClientX(e.clientX);
            if (fraction !== null) {
              seekFraction(fraction);
              setCurrent(fraction * duration);
            }
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          onKeyDown={onKeyDown}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={`wv-bar${i < playedBars ? ' played' : ''}`}
              style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${(i % 8) * 0.11}s` }}
            />
          ))}
        </div>

        <span className="wv-time">
          {fmt(current)} <span className="wv-sep">/</span> {duration > 0 ? fmt(duration) : '--:--'}
        </span>
      </div>

      <div className="audio-controls-bar">
        <div className="skip-group">
          <button type="button" className="skip-btn" title="Rewind 10 seconds" onClick={() => skip(-10)}>
            <Icon name="skip-back" size={12} /> 10s
          </button>
          <button type="button" className="skip-btn" title="Forward 10 seconds" onClick={() => skip(10)}>
            10s <Icon name="skip-forward" size={12} />
          </button>
        </div>
        <div className="speed-group" role="group" aria-label="Playback speed">
          <span className="speed-label">Speed</span>
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={`speed-btn${rate === s ? ' active' : ''}`} onClick={() => setRate(s)}>
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
