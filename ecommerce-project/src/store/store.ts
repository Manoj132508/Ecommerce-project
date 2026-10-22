import { configureStore } from '@reduxjs/toolkit';
import authUiReducer from '../slices/authUiSlice';
import homeReducer from '../slices/homeSlice';

// Redux holds client/UI state only. Server data (products, cart, orders,
// the signed-in user) lives in TanStack Query.
export const makeStore = () => configureStore({
  reducer: {
    home: homeReducer,
    authUi: authUiReducer,
  },
});

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
