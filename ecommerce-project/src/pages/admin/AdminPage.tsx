import { useState } from 'react';
import { Navigate } from 'react-router';
import { Header } from '../../components/Header';
import { useAuthQuery } from '../../queries/useAuthQuery';
import { AdminOrders } from './AdminOrders';
import { AdminProducts } from './AdminProducts';

type AdminTab = 'products' | 'orders';

/**
 * Protects the admin route and composes independently owned feature tabs.
 */
export default function AdminDashboard() {
  const { data: user = null, isPending: authLoading } = useAuthQuery();
  const isAdmin = Boolean(user?.isAdmin);
  const [activeTab, setActiveTab] = useState<AdminTab>('products');

  if (authLoading) {
    return <p className="p-8 text-center">Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <title>Admin Dashboard</title>
      <Header />

      <main className="container mx-auto px-3 pb-12 pt-[132px] sm:px-4 xl:pt-[90px]">
        <h1 className="mb-6 text-2xl font-bold text-gray-800 sm:mb-8 sm:text-3xl">Admin Dashboard</h1>

        <div className="mb-6 flex overflow-x-auto border-b">
          <button type="button" onClick={() => setActiveTab('products')} className={`shrink-0 px-3 py-2 font-semibold sm:px-4 ${activeTab === 'products' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-blue-600'}`}>
            Manage Products
          </button>
          <button type="button" onClick={() => setActiveTab('orders')} className={`shrink-0 px-3 py-2 font-semibold sm:px-4 ${activeTab === 'orders' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-blue-600'}`}>
            Manage Orders
          </button>
        </div>

        {activeTab === 'products' && <AdminProducts />}
        {activeTab === 'orders' && <AdminOrders />}
      </main>
    </>
  );
}
