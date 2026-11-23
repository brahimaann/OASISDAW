import { create } from "zustand";

/** Screen-only state. Project data lives in Yjs, never here. */
interface UiState {
  clickOn: boolean;
  setClickOn: (on: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  clickOn: true,
  setClickOn: (clickOn) => set({ clickOn }),
}));
