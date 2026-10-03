import { useState } from 'react';
import { Navigate } from 'react-router';
import { Header } from '../../components/Header';
import { useAuth } from '../../contexts/AuthContext';
import { AdminOrders } from './AdminOrders';
import { ProductForm } from './ProductForm';
import { ProductsTable } from './ProductsTable';
import { useAdminDashboard } from './useAdminDashboard';

/**
 * Composes the admin tabs and delegates data operations to useAdminDashboard.
 * This page intentionally contains only navigation and edit-selection state.
 */
export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const {
    products,
    orders,
    loading,
    saving,
    error,
    success,
    clearMessages,
    createProduct,
    updateProduct,
    deleteProduct
  } = useAdminDashboard(isAdmin);
  const [activeTab, setActiveTab] = useState('products');
  const [editingProduct, setEditingProduct] = useState(null);

  /** Selects a product for editing and moves the viewport back to the form. */
  const handleEditProduct = (product) => {
    clearMessages();
    setEditingProduct(product);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Updates the selected product and leaves edit mode after a successful request. */
  const handleUpdateProduct = async (productId, formData) => {
    await updateProduct(productId, formData);
    setEditingProduct(null);
  };

  /** Cancels editing without changing the stored product. */
  const handleCancelEditing = () => {
    clearMessages();
    setEditingProduct(null);
  };

  /** Confirms deletion before invoking the hook's synchronized delete workflow. */
  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`Delete ${product.name}?`)) return;

    try {
      await deleteProduct(product.id);
      if (editingProduct?.id === product.id) {
        setEditingProduct(null);
      }
    } catch {
      // The dashboard hook exposes the request error above the active tab.
    }
  };

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

        {error && <p className="mb-5 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-700" role="alert">{error}</p>}
        {success && <p className="mb-5 rounded border border-green-300 bg-green-50 px-4 py-3 text-green-700" role="status">{success}</p>}

        {activeTab === 'products' && (
          <div>
            <ProductForm
              editingProduct={editingProduct}
              saving={saving}
              onCreate={createProduct}
              onUpdate={handleUpdateProduct}
              onCancel={handleCancelEditing}
            />
            <ProductsTable
              products={products}
              loading={loading}
              saving={saving}
              onEdit={handleEditProduct}
              onDelete={handleDeleteProduct}
            />
          </div>
        )}

        {activeTab === 'orders' && <AdminOrders orders={orders} loading={loading} />}
      </main>
    </>
  );
}
