import { Link, useNavigate } from 'react-router';
import { useCart } from '../contexts/CartContext';
import { useAuth } from '../contexts/AuthContext';


export function Header() {
  const { totalQuantity } = useCart();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-[60px] items-center justify-between bg-[#084f2d] px-[15px] text-white">
      <div className="w-[208px] max-[800px]:w-auto">
        <Link to="/" className="inline-block cursor-pointer rounded-[2px] border border-transparent px-[9.5px] py-1.5 no-underline hover:border-white">
          <div>
            <h1 className='text-[20px] font-bold'>Ecommerce-Project</h1>
          </div>
        </Link>
      </div>

      <div className="mx-[10px] flex max-w-[850px] flex-1 items-center rounded-[5px] bg-white text-[#212121]">
        <input className="h-[38px] w-0 flex-1 rounded-l-[5px] border-0 bg-white pl-[15px] text-base text-[#212121] focus:outline-2 focus:outline-[#198754]"
          type="text" placeholder="Search" />

        <button className="h-10 w-[45px] shrink-0 cursor-pointer rounded-r-[5px] border-0 bg-[#baffbe]">
          <img className="mx-auto mt-[3px] h-5" src="images/icons/search-icon.png" />
        </button>
      </div>


      <div className="flex  align-items-center  gap-3 justify-end">
        {user ? (
          <>
            {user.isAdmin && (
              <Link className="flex cursor-pointer items-center rounded-[2px] border border-transparent px-[13px] py-1.5 text-white no-underline hover:border-white"
                to="/admin">
                <span className="text-lg font-bold">Admin</span>
              </Link>
            )}
            <Link className="flex cursor-pointer items-center rounded-[2px] border border-transparent px-[13px] py-1.5 text-white no-underline hover:border-white"
              to="/profile">
              <span className="text-lg font-bold">{user.name}</span>
            </Link>
            <Link className="relative flex cursor-pointer items-center rounded-[2px] border border-transparent px-[9.5px] py-1.5 text-white no-underline hover:border-white"
              to="/checkout">
              <img className="w-[38px]" src="images/icons/cart-icon.png" />
              <div className="absolute top-[8.5px] right-[46px] w-[26px] text-center text-sm font-bold text-[#084f2d]">
                {totalQuantity}
              </div>
              <div className="ml-[5px] text-[15px] font-bold">Cart</div>
            </Link>
              <Link className="flex cursor-pointer items-center rounded-[2px] border border-transparent px-[13px] py-1.5 text-white no-underline hover:border-white"
              to="/orders">
              <span className="text-[15px] font-bold">Orders</span>
            </Link>
            <button onClick={handleLogout} className="rounded bg-red-500 px-3 py-1 hover:bg-red-300">
              Logout
            </button>
          </>
        ) : (
          <>
            <Link className="flex cursor-pointer items-center rounded-[2px] border border-transparent px-[13px] py-1.5 text-white no-underline hover:border-white"
              to="/login">
              <span className="text-[15px] font-bold">Login</span>
            </Link>
            <Link className="flex cursor-pointer items-center rounded-[2px] border border-transparent px-[13px] py-1.5 text-white no-underline hover:border-white"
              to="/register">
              <span className="text-[15px] font-bold">Register</span>
            </Link>

          


          </>
        )}
      </div>
    </header>
  );
}
