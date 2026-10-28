import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Header() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <header className="site-header">
      <div className="container">
        <Link to={user?.role === 'ORGANISER' ? '/organiser' : '/'} className="brand" aria-label="RailRush home">
          <span className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 20V5h7a4.5 4.5 0 0 1 0 9H6m6.5 0L18 20" /></svg>
          </span>
          RailRush
        </Link>
        <nav className="nav" aria-label="Main">
          {user?.role === 'ORGANISER' ? (
            <>
              <NavLink to="/organiser" end>Dashboard</NavLink>
              <NavLink to="/organiser/trains">Trains</NavLink>
              <NavLink to="/organiser/runs">Runs</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/" end>Book</NavLink>
              {user && <NavLink to="/bookings">My bookings</NavLink>}
            </>
          )}
          {user ? (
            <>
              <span className="who">{user.name}</span>
              <button className="linklike" onClick={async () => { await logout(); nav('/'); }}>Sign out</button>
            </>
          ) : user === null ? (
            <>
              <NavLink to="/login">Sign in</NavLink>
              <Link className="btn btn-primary btn-sm" to="/register">Create account</Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
