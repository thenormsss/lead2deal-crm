import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">LEAD2DEAL</div>
        <div className="login-form-wrap">
          <h2>LOG IN YOUR ACCOUNT</h2>
          <form onSubmit={handleSubmit}>
            <label>USERNAME</label>
            <input
              type="text"
              placeholder="Enter Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <label>PASSWORD</label>
            <input
              type="password"
              placeholder="Enter Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="btn-yellow login-btn" disabled={submitting}>
              {submitting ? 'LOGGING IN...' : 'LOG IN'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
