import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { LOGIN_REQUIRED_NOTICE, showAuthNotice } from '../slices/authUiSlice';
import { useAppDispatch } from '../store/hooks';

/** Sends the user to the login page with a message, returning here afterwards. */
export function useRequireLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  return useCallback((notice: string = LOGIN_REQUIRED_NOTICE) => {
    dispatch(showAuthNotice(notice));
    navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
  }, [dispatch, location.pathname, location.search, navigate]);
}
