import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TelegramProvider } from "@/contexts/TelegramContext";
import { TonConnectProvider } from "@/contexts/TonConnectContext";
import { MiniAppLayout } from "@/components/miniapp/MiniAppLayout";
import NotFound from "./pages/NotFound";

// Admin Pages
import AdminLogin from "./pages/admin/Login";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminAnalytics from "./pages/admin/Analytics";
import AdminTransactions from "./pages/admin/Transactions";
import AdminUsers from "./pages/admin/Users";
import AdminWithdrawals from "./pages/admin/Withdrawals";
import AdminDeposits from "./pages/admin/Deposits";
import AdminDisputes from "./pages/admin/Disputes";
import InitialSetup from "./pages/admin/InitialSetup";
import AdminSettings from "./pages/admin/Settings";

// Mini App Pages
import MiniAppHome from "./pages/miniapp/Home";
import MiniAppBuy from "./pages/miniapp/Buy";
import MiniAppSell from "./pages/miniapp/Sell";
import MiniAppOrders from "./pages/miniapp/Orders";
import MiniAppOrderDetail from "./pages/miniapp/OrderDetail";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TonConnectProvider>
      <TelegramProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                {/* Redirect root to admin */}
                <Route path="/" element={<Navigate to="/admin" replace />} />
                
                {/* Mini App Routes */}
                <Route path="/app" element={<MiniAppLayout />}>
                  <Route index element={<MiniAppHome />} />
                  <Route path="buy/:productLink" element={<MiniAppBuy />} />
                  <Route path="sell" element={<MiniAppSell />} />
                  <Route path="orders" element={<MiniAppOrders />} />
                  <Route path="order/:orderId" element={<MiniAppOrderDetail />} />
                </Route>
                
                {/* Admin Routes */}
                <Route path="/admin/setup" element={<InitialSetup />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={
                  <ProtectedRoute requireAdmin>
                    <AdminDashboard />
                  </ProtectedRoute>
                } />
                <Route path="/admin/analytics" element={
                  <ProtectedRoute requireAdmin>
                    <AdminAnalytics />
                  </ProtectedRoute>
                } />
                <Route path="/admin/transactions" element={
                  <ProtectedRoute requireAdmin>
                    <AdminTransactions />
                  </ProtectedRoute>
                } />
                <Route path="/admin/users" element={
                  <ProtectedRoute requireAdmin>
                    <AdminUsers />
                  </ProtectedRoute>
                } />
                <Route path="/admin/withdrawals" element={
                  <ProtectedRoute requireAdmin>
                    <AdminWithdrawals />
                  </ProtectedRoute>
                } />
                <Route path="/admin/deposits" element={
                  <ProtectedRoute requireAdmin>
                    <AdminDeposits />
                  </ProtectedRoute>
                } />
                <Route path="/admin/disputes" element={
                  <ProtectedRoute requireAdmin>
                    <AdminDisputes />
                  </ProtectedRoute>
                } />
                <Route path="/admin/settings" element={
                  <ProtectedRoute requireAdmin>
                    <AdminSettings />
                  </ProtectedRoute>
                } />
                
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </TelegramProvider>
    </TonConnectProvider>
  </QueryClientProvider>
);

export default App;
