import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { Header } from '../../components/Header';

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const { login } = useAuth();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);

      if (result.success) {
        const requestedPage = location.state?.from;
        navigate(typeof requestedPage === 'string' && requestedPage.startsWith('/') ? requestedPage : '/', { replace: true });
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <main className="container mx-auto px-3 pb-16 pt-[132px] sm:px-4 xl:pt-[90px]">
        <div className="mx-auto max-w-md rounded-lg bg-white p-5 shadow-md sm:p-8">
          <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">
           Login
          </h1>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            

            <div className="mb-4">
              <label className="block text-gray-700 mb-2">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="email"
                required
                placeholder="Enter your email"
              />
            </div>

            <div className="mb-4">
              <label className="block text-gray-700 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
              />
            </div>

            <button type="submit" disabled={loading} className={`w-full py-2 rounded ${
              loading ? "bg-gray-400" : "bg-green-600"} text-white`}>
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>
         <p className="mt-4 text-center text-gray-600">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="text-blue-600 hover:underline">
          Register here
        </Link>
      </p>
        </div>
      </main>
    </>
  );
}
