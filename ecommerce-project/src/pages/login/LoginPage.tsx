import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Header } from '../../components/Header';
import { useLoginMutation } from '../../queries/useAuthQuery';
import { getErrorMessage } from '../../services/api';
import { clearAuthNotice } from '../../slices/authUiSlice';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { safeReturnPath } from '../../utils/returnPath';

interface LoginLocationState {
  from?: unknown;
}

const returnState = (state: unknown): LoginLocationState | null => (
  typeof state === 'object' && state !== null && 'from' in state ? { from: state.from } : null
);

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const notice = useAppSelector((state) => state.authUi.notice);
  const loginMutation = useLoginMutation();
  const requestedPage = returnState(location.state)?.from;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await loginMutation.mutateAsync({ email, password });
      dispatch(clearAuthNotice());
      navigate(safeReturnPath(requestedPage), { replace: true });
    } catch {
      // TanStack Query keeps the request error on loginMutation.error.
    }
  };

  const error = loginMutation.isError
    ? getErrorMessage(loginMutation.error, 'Unable to log in. Please try again.')
    : '';

  return (
    <>
      <Header />
      <main className="container mx-auto px-3 pb-16 pt-[132px] sm:px-4 xl:pt-[90px]">
        <div className="mx-auto max-w-md rounded-lg bg-white p-5 shadow-md sm:p-8">
          <h1 className="mb-6 text-center text-2xl font-bold text-gray-800">Login</h1>
          {notice && !error && <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-amber-900" role="status">{notice}</div>}
          {error && <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-2 text-red-700" role="alert">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="mb-2 block text-gray-700" htmlFor="login-email">Email Address</label>
              <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" autoComplete="email" required placeholder="Enter your email" />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-gray-700" htmlFor="login-password">Password</label>
              <input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" autoComplete="current-password" required placeholder="Enter your password" />
            </div>
            <button type="submit" disabled={loginMutation.isPending} className={`w-full rounded py-2 ${loginMutation.isPending ? 'bg-gray-400' : 'bg-green-600'} text-white`}>
              {loginMutation.isPending ? 'Logging in...' : 'Login'}
            </button>
          </form>
          <p className="mt-4 text-center text-gray-600">
            Don&apos;t have an account?{' '}
            <Link to="/register" state={{ from: safeReturnPath(requestedPage) }} className="text-blue-600 hover:underline">Register here</Link>
          </p>
        </div>
      </main>
    </>
  );
}
