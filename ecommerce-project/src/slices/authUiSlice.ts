import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// Client/UI state only: the message shown on the login page when the user is
// sent there (login required, session expired). Never tokens or server data.
interface AuthUiState {
  notice: string | null;
}

const initialState: AuthUiState = {
  notice: null,
};

export const LOGIN_REQUIRED_NOTICE = 'Please log in to continue.';
export const SESSION_EXPIRED_NOTICE = 'Your session has expired. Please log in again.';
export const CART_LOGIN_NOTICE = 'Log in to add items to your cart.';

const authUiSlice = createSlice({
  name: 'authUi',
  initialState,
  reducers: {
    showAuthNotice(state, action: PayloadAction<string>) {
      state.notice = action.payload;
    },
    clearAuthNotice(state) {
      state.notice = null;
    },
  },
});

export const { showAuthNotice, clearAuthNotice } = authUiSlice.actions;
export default authUiSlice.reducer;
