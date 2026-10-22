import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Header } from '../../components/Header';
import { useRegisterMutation } from '../../queries/useAuthQuery';
import { getErrorMessage } from '../../services/api';
import { clearAuthNotice } from '../../slices/authUiSlice';
import { useAppDispatch } from '../../store/hooks';
import { safeReturnPath } from '../../utils/returnPath';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const registerMutation = useRegisterMutation();
  const requestedPage = typeof location.state === 'object' && location.state !== null && 'from' in location.state
    ? location.state.from
    : undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');

    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters');
      return;
    }

    try {
      await registerMutation.mutateAsync({ name, email, password });
      dispatch(clearAuthNotice());
      navigate(safeReturnPath(requestedPage), { replace: true });
    } catch {
      // TanStack Query keeps the request error on registerMutation.error.
    }
  };

  const requestError = registerMutation.isError
    ? getErrorMessage(registerMutation.error, 'Unable to register. Please try again.')
    : '';
  const error = validationError || requestError;

  return (
    <>
      <Header />
      <main className="container mx-auto px-3 pb-16 pt-[132px] sm:px-4 xl:pt-[90px]">
        <div className="mx-auto max-w-md rounded-lg bg-white p-5 shadow-md sm:p-8">
          <h1 className="mb-6 text-center text-2xl font-bold text-gray-800">Create Account</h1>
          {error && <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-2 text-red-700">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="mb-2 block text-gray-700">Full Name</label>
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" required placeholder="Enter your name" />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-gray-700">Email Address</label>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" required placeholder="Enter your email" />
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-gray-700">Password</label>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" minLength={8} required placeholder="Create a password" />
            </div>
            <div className="mb-6">
              <label className="mb-2 block text-gray-700">Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" required placeholder="Confirm your password" />
            </div>
            <button type="submit" disabled={registerMutation.isPending} className={`w-full rounded py-2 ${registerMutation.isPending ? 'bg-gray-400' : 'bg-green-600'} text-white`}>
              {registerMutation.isPending ? 'Creating account...' : 'Register'}
            </button>
          </form>
          <p className="mt-4 text-center text-gray-600">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 hover:underline">Login here</Link>
          </p>
        </div>
      </main>
    </>
  );
}
