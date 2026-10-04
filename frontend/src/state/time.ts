// Playback clock. A vanilla store so the 3D scene can read it every frame without React renders.
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export const SPEEDS = [1, 10, 100, 1000] as const;

export interface TimeState {
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: number) => void;
  seek: (t: number) => void;
  setDuration: (d: number) => void;
  advance: (realDt: number) => void;
}

export const timeStore = createStore<TimeState>((set, get) => ({
  t: 0,
  duration: 0,
  playing: false,
  speed: 100,
  play: () => {
    const { t, duration } = get();
    set({ playing: true, t: t >= duration ? 0 : t });
  },
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  setSpeed: (speed) => set({ speed }),
  seek: (t) => set({ t: Math.min(Math.max(t, 0), get().duration) }),
  setDuration: (duration) => set({ duration, t: Math.min(get().t, duration) }),
  advance: (realDt) => {
    const { playing, t, speed, duration } = get();
    if (!playing) return;
    // cap real dt so a backgrounded tab doesn't jump hours
    const nt = t + Math.min(realDt, 0.1) * speed;
    if (nt >= duration) set({ t: duration, playing: false });
    else set({ t: nt });
  },
}));

/** Throttled React subscription to simulation time (default 10 Hz while playing, immediate on seek). */
export function useSimTime(hz = 10): number {
  const [t, setT] = useState(() => timeStore.getState().t);
  useEffect(() => {
    let last = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsub = timeStore.subscribe((st) => {
      const now = performance.now();
      if (!st.playing || now - last >= 1000 / hz) {
        last = now;
        setT(st.t);
      } else if (!pending) {
        pending = setTimeout(() => {
          pending = null;
          last = performance.now();
          setT(timeStore.getState().t);
        }, 1000 / hz);
      }
    });
    return () => {
      unsub();
      if (pending) clearTimeout(pending);
    };
  }, [hz]);
  return t;
}

/** Subscribe to non-time fields (playing, speed, duration). Do not select `t` here — use useSimTime. */
export function useTimeState<T>(sel: (s: TimeState) => T): T {
  return useStore(timeStore, sel);
}
