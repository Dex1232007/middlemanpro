import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import NotFound from "./pages/NotFound";

// Lazy load Admin Pages for code splitting
const AdminLogin = lazy(() => import("./pages/admin/Login"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminAnalytics = lazy(() => import("./pages/admin/Analytics"));
const AdminTransactions = lazy(() => import("./pages/admin/Transactions"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminWithdrawals = lazy(() => import("./pages/admin/Withdrawals"));
const AdminDeposits = lazy(() => import("./pages/admin/Deposits"));
const AdminDisputes = lazy(() => import("./pages/admin/Disputes"));
const InitialSetup = lazy(() => import("./pages/admin/InitialSetup"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));
const AdminBroadcast = lazy(() => import("./pages/admin/Broadcast"));
const AdminReferrals = lazy(() => import("./pages/admin/Referrals"));

const queryClient = new QueryClient();

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen bg-background">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Redirect root to admin */}
              <Route path="/" element={<Navigate to="/admin" replace />} />
              
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
              <Route path="/admin/broadcast" element={
                <ProtectedRoute requireAdmin>
                  <AdminBroadcast />
                </ProtectedRoute>
              } />
              <Route path="/admin/referrals" element={
                <ProtectedRoute requireAdmin>
                  <AdminReferrals />
                </ProtectedRoute>
              } />
              
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
