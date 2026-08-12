import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/leads', label: 'Seller' },
  { to: '/properties', label: 'Property' },
  { to: '/tasks', label: 'Task' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/logs', label: 'Logs' }
];

export default function Sidebar() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">LEAD2DEAL</div>
      <nav className="sidebar-nav">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
          >
            {link.label.toUpperCase()}
          </NavLink>
        ))}
      </nav>
      {user && <div className="sidebar-user">Signed in as {user.name}</div>}
      <button className="sidebar-logout" onClick={handleLogout}>LOG-OUT</button>
    </aside>
  );
}
