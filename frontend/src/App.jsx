import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import PrivateRoute from './components/PrivateRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Properties from './pages/Properties';
import Tasks from './pages/Tasks';
import Pipeline from './pages/Pipeline';
import Logs from './pages/Logs';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/leads" element={<PrivateRoute><Leads /></PrivateRoute>} />
            <Route path="/properties" element={<PrivateRoute><Properties /></PrivateRoute>} />
            <Route path="/tasks" element={<PrivateRoute><Tasks /></PrivateRoute>} />
            <Route path="/pipeline" element={<PrivateRoute><Pipeline /></PrivateRoute>} />
            <Route path="/logs" element={<PrivateRoute><Logs /></PrivateRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}