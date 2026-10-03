import { Routes, Route } from 'react-router';
import { HomePage } from './pages/home/HomePage';
import { CheckoutPage } from './pages/checkout/CheckoutPage';
import { OrdersPage } from './pages/orders/OrdersPage';
import { TrackingPage } from './pages/tracking/TrackingPage';
import { LoginPage } from './pages/login/LoginPage';
import { RegisterPage } from './pages/login/RegisterPage';
import AdminDashboard from './pages/admin/AdminPage';
import { OrderConfirmationPage } from './pages/order-confirmation/OrderConfirmationPage';
import { ProductUnavailablePage } from './pages/product-unavailable/ProductUnavailablePage';

function App() {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="register" element={<RegisterPage />} />
      <Route path="admin" element={<AdminDashboard />} />
      <Route path="checkout" element={<CheckoutPage />} />
      <Route path="order-confirmation" element={<OrderConfirmationPage />} />
      <Route path="product-unavailable" element={<ProductUnavailablePage />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="tracking" element={<TrackingPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  )
}

export default App
