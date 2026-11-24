import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * Screen-only state: your layout, your tools. Project data lives in Yjs,
 * never here. The layout is saved in this browser, so each person keeps
 * their own arrangement.
 */
export type WindowId = "rack" | "mixer" | "piano";
export type WindowMode = "floating" | "docked";
/** Snap grid in beats. 0 = off. */
export type Snap = 4 | 1 | 0.5 | 0.25 | 0;
export type BrowserTab = "sounds" | "patterns" | "takes";
/** PAT loops the pattern open in the rack; SONG plays the playlist. Each person picks their own. */
export type PlayMode = "pat" | "song";

interface UiState {
  playMode: PlayMode;
  /** The pattern open in the rack. Yours alone, like the layout. */
  patternId: string;
  /** Playlist clip you clicked (for Delete and the clip tools). Not saved. */
  selectedClip: { trackId: string; clipId: string } | null;
  clickOn: boolean;
  countInBars: 0 | 1 | 2;
  snap: Snap;
  browserOpen: boolean;
  browserTab: BrowserTab;
  /** Which window is showing, and whether it floats over the playlist or sits in the bottom dock. */
  window: WindowId;
  windowOpen: boolean;
  windowMode: WindowMode;
  dockSquashed: boolean;
  dockHeight: number;
  floatPos: { x: number; y: number };
  /** Popovers: not saved. */
  chatOpen: boolean;
  recordOpen: boolean;
  /** This browser is recording a take right now. */
  recording: boolean;
  set: (patch: Partial<Omit<UiState, "set" | "showWindow" | "toggleWindow">>) => void;
  showWindow: (w: WindowId) => void;
  /** FL behaviour: the window's key opens it, or closes it if it's already in front. */
  toggleWindow: (w: WindowId) => void;
}

// localStorage can throw (private mode, blocked site data). The layout just won't stick then.
const safeStorage: StateStorage = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      playMode: "pat",
      patternId: "main",
      selectedClip: null,
      clickOn: true,
      countInBars: 1,
      snap: 1,
      browserOpen: true,
      browserTab: "sounds",
      window: "rack",
      windowOpen: true,
      windowMode: "floating",
      dockSquashed: false,
      dockHeight: 280,
      floatPos: { x: 80, y: 48 },
      chatOpen: false,
      recordOpen: false,
      recording: false,
      set: (patch) => set(patch),
      showWindow: (w) => set({ window: w, windowOpen: true, dockSquashed: false }),
      toggleWindow: (w) => {
        const s = get();
        if (s.windowOpen && s.window === w && !(s.windowMode === "docked" && s.dockSquashed)) set({ windowOpen: false });
        else set({ window: w, windowOpen: true, dockSquashed: false });
      },
    }),
    {
      name: "oasis-layout",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ selectedClip: _sel, chatOpen: _c, recordOpen: _r, recording: _rec, set: _s, showWindow: _w, toggleWindow: _t, ...keep }) => keep,
    },
  ),
);

export const SNAP_OPTIONS: { value: Snap; label: string }[] = [
  { value: 4, label: "Bar" },
  { value: 1, label: "Beat" },
  { value: 0.5, label: "1/2 beat" },
  { value: 0.25, label: "Step" },
  { value: 0, label: "Off" },
];

/** Rounds a beat position to the snap grid. Bar snap uses the song's beats per bar. */
export function snapBeat(beat: number, snap: Snap, beatsPerBar = 4): number {
  if (!snap) return beat;
  const grid = snap === 4 ? beatsPerBar : snap;
  return Math.round(beat / grid) * grid;
}
