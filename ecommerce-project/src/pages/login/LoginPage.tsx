import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Header } from '../../components/Header';
import { useLoginMutation } from '../../queries/useAuthQuery';
import { getErrorMessage } from '../../services/api';

interface LoginLocationState {
  from?: unknown;
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const loginMutation = useLoginMutation();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await loginMutation.mutateAsync({ email, password });
      const requestedPage = (location.state as LoginLocationState | null)?.from;
      navigate(
        typeof requestedPage === 'string' && requestedPage.startsWith('/') ? requestedPage : '/',
        { replace: true },
      );
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
          {error && <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-2 text-red-700">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="mb-2 block text-gray-700">Email Address</label>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" autoComplete="email" required placeholder="Enter your email" />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-gray-700">Password</label>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" autoComplete="current-password" required placeholder="Enter your password" />
            </div>
            <button type="submit" disabled={loginMutation.isPending} className={`w-full rounded py-2 ${loginMutation.isPending ? 'bg-gray-400' : 'bg-green-600'} text-white`}>
              {loginMutation.isPending ? 'Logging in...' : 'Login'}
            </button>
          </form>
          <p className="mt-4 text-center text-gray-600">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-blue-600 hover:underline">Register here</Link>
          </p>
        </div>
      </main>
    </>
  );
}
