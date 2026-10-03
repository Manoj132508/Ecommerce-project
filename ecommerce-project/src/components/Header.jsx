import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';

function SearchBox({ className = '' }) {
  return (
    <div className={`flex items-center rounded-[5px] bg-white text-[#212121] ${className}`}>
      <input
        className="h-[38px] min-w-0 flex-1 rounded-l-[5px] border-0 bg-white px-3 text-base text-[#212121] focus:outline-2 focus:outline-[#198754]"
        type="search"
        placeholder="Search products"
        aria-label="Search products"
      />
      <button type="button" aria-label="Search" className="h-10 w-[45px] shrink-0 cursor-pointer rounded-r-[5px] border-0 bg-[#baffbe]">
        <img className="mx-auto h-5" src="/images/icons/search-icon.png" alt="" />
      </button>
    </div>
  );
}

export function Header() {
  const { totalQuantity } = useCart();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = () => {
    closeMenu();
    logout();
    navigate('/login');
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-[#084f2d] text-white shadow-sm">
      <div className="mx-auto flex min-h-[108px] w-full max-w-[1800px] flex-wrap items-center px-3 py-2 xl:h-[60px] xl:min-h-0 xl:flex-nowrap xl:px-[15px] xl:py-0">
        <div className="flex w-full items-center xl:w-[208px] xl:shrink-0">
          <Link to="/" onClick={closeMenu} className="min-w-0 cursor-pointer rounded-[2px] border border-transparent px-2 py-1.5 no-underline hover:border-white">
            <h1 className="truncate text-lg font-bold sm:text-xl">Ecommerce-Project</h1>
          </Link>

          <div className="ml-auto flex items-center gap-2 xl:hidden">
            {user && (
              <Link to="/checkout" onClick={closeMenu} aria-label={`Cart with ${totalQuantity} items`} className="relative rounded p-1 hover:bg-white/10">
                <img className="w-9" src="/images/icons/cart-icon.png" alt="" />
                <span className="absolute left-1/2 top-1 w-6 -translate-x-1/2 text-center text-xs font-bold text-[#084f2d]">
                  {totalQuantity}
                </span>
              </Link>
            )}
            <button
              type="button"
              className="min-h-10 rounded border border-white/70 px-3 py-2 text-sm font-semibold hover:bg-white/10"
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>

        <SearchBox className="order-3 mt-2 w-full xl:order-none xl:mx-[10px] xl:mt-0 xl:max-w-[850px] xl:flex-1" />

        <nav className="ml-auto hidden shrink-0 items-center justify-end gap-1 xl:flex" aria-label="Main navigation">
          {user ? (
            <>
              {user.isAdmin && <Link className="rounded px-3 py-2 font-bold hover:bg-white/10" to="/admin">Admin</Link>}
              <Link className="max-w-36 truncate rounded px-3 py-2 font-bold hover:bg-white/10" to="/profile">{user.name}</Link>
              <Link className="relative flex items-center rounded px-2 py-1.5 font-bold hover:bg-white/10" to="/checkout">
                <img className="w-[38px]" src="/images/icons/cart-icon.png" alt="" />
                <span className="absolute left-[17px] top-[8px] w-[26px] text-center text-sm font-bold text-[#084f2d]">{totalQuantity}</span>
                <span className="ml-1">Cart</span>
              </Link>
              <Link className="rounded px-3 py-2 font-bold hover:bg-white/10" to="/orders">Orders</Link>
              <button type="button" onClick={handleLogout} className="rounded bg-red-600 px-3 py-2 font-semibold hover:bg-red-700">Logout</button>
            </>
          ) : (
            <>
              <Link className="rounded px-3 py-2 font-bold hover:bg-white/10" to="/login">Login</Link>
              <Link className="rounded px-3 py-2 font-bold hover:bg-white/10" to="/register">Register</Link>
            </>
          )}
        </nav>
      </div>

      {menuOpen && (
        <nav id="mobile-navigation" className="absolute inset-x-0 top-full border-t border-white/20 bg-[#084f2d] px-3 py-3 shadow-lg xl:hidden" aria-label="Mobile navigation">
          <div className="mx-auto grid max-w-lg gap-1">
            {user ? (
              <>
                {user.isAdmin && <Link onClick={closeMenu} className="rounded px-3 py-2 font-semibold hover:bg-white/10" to="/admin">Admin</Link>}
                <Link onClick={closeMenu} className="rounded px-3 py-2 font-semibold hover:bg-white/10" to="/profile">Account: {user.name}</Link>
                <Link onClick={closeMenu} className="rounded px-3 py-2 font-semibold hover:bg-white/10" to="/orders">Orders</Link>
                <Link onClick={closeMenu} className="rounded px-3 py-2 font-semibold hover:bg-white/10" to="/checkout">Cart ({totalQuantity})</Link>
                <button type="button" onClick={handleLogout} className="mt-1 rounded bg-red-600 px-3 py-2 text-left font-semibold hover:bg-red-700">Logout</button>
              </>
            ) : (
              <>
                <Link onClick={closeMenu} className="rounded px-3 py-2 font-semibold hover:bg-white/10" to="/login">Login</Link>
                <Link onClick={closeMenu} className="rounded px-3 py-2 font-semibold hover:bg-white/10" to="/register">Register</Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
