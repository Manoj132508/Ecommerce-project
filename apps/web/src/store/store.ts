import { configureStore } from "@reduxjs/toolkit";
import uiReducer from "./uiSlice";

// One store per browser tab, created inside AppProviders. Never a module-level
// singleton: on the server that would share state between requests.
export const makeStore = () => configureStore({
  reducer: {
    ui: uiReducer,
  },
});

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
