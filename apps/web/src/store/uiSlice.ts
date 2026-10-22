import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// Client/UI state only. Products, cart, orders and the signed-in user are
// server data and live in the TanStack Query cache, never here.
export interface UiState {
  /** A one-off message shown on the sign-in page (for example "Your session expired"). */
  notice: string | null;
}

const initialState: UiState = { notice: null };

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    noticeShown: (state, action: PayloadAction<string>) => {
      state.notice = action.payload;
    },
    noticeDismissed: (state) => {
      state.notice = null;
    },
  },
});

export const { noticeShown, noticeDismissed } = uiSlice.actions;
export default uiSlice.reducer;
