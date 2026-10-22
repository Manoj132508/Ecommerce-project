import { describe, expect, test } from 'vitest';
import { makeStore } from '../store/store';
import { clearAuthNotice, SESSION_EXPIRED_NOTICE, showAuthNotice } from './authUiSlice';

describe('authUi slice (UI state only)', () => {
  test('starts empty, shows a notice and clears it', () => {
    const store = makeStore();
    expect(store.getState().authUi.notice).toBeNull();
    store.dispatch(showAuthNotice(SESSION_EXPIRED_NOTICE));
    expect(store.getState().authUi.notice).toBe(SESSION_EXPIRED_NOTICE);
    store.dispatch(clearAuthNotice());
    expect(store.getState().authUi.notice).toBeNull();
  });

  test('Redux holds no server data or tokens', () => {
    expect(Object.keys(makeStore().getState()).sort()).toEqual(['authUi', 'home']);
    expect(JSON.stringify(makeStore().getState())).not.toMatch(/token/i);
  });
});
