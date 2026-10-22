import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// Client/UI state only. Products, cart, orders and the signed-in user are
// server data and live in the TanStack Query cache, never here.
export interface UiState {
  /** A one-off message shown on the sign-in page (for example "Your session expired"). */
  notice: string | null;
  cartDrawerOpen: boolean;
  menuOpen: boolean;
  checkoutStep: "details" | "review";
}

const initialState: UiState = {
  notice: null,
  cartDrawerOpen: false,
  menuOpen: false,
  checkoutStep: "details",
};

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
    cartDrawerOpened: (state) => {
      state.cartDrawerOpen = true;
    },
    cartDrawerClosed: (state) => {
      state.cartDrawerOpen = false;
    },
    menuToggled: (state) => {
      state.menuOpen = !state.menuOpen;
    },
    menuClosed: (state) => {
      state.menuOpen = false;
    },
    checkoutStepChanged: (state, action: PayloadAction<UiState["checkoutStep"]>) => {
      state.checkoutStep = action.payload;
    },
  },
});

export const {
  cartDrawerClosed,
  cartDrawerOpened,
  checkoutStepChanged,
  menuClosed,
  menuToggled,
  noticeDismissed,
  noticeShown,
} = uiSlice.actions;
export default uiSlice.reducer;
