import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Header from './components/Header.jsx';
import Home from './pages/Home.jsx';
import Search from './pages/Search.jsx';
import Book from './pages/Book.jsx';
import Checkout from './pages/Checkout.jsx';
import TicketPage from './pages/TicketPage.jsx';
import MyBookings from './pages/MyBookings.jsx';
import { Login, Register } from './pages/Auth.jsx';
import Dashboard from './pages/organiser/Dashboard.jsx';
import Trains from './pages/organiser/Trains.jsx';
import Runs from './pages/organiser/Runs.jsx';
import RunDetail from './pages/organiser/RunDetail.jsx';

function Guard({ role, children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <div className="center-box"><span className="spinner" /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (role && user.role !== role) {
    return (
      <div className="container page"><div className="empty">
        <h3>This area is for {role === 'ORGANISER' ? 'organisers' : 'travellers'}</h3>
        <p>You are signed in as {user.role.toLowerCase()}.</p>
        <Link className="btn btn-dark" to={user.role === 'ORGANISER' ? '/organiser' : '/'}>Go to your home</Link>
      </div></div>
    );
  }
  return children;
}

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/book/:runId" element={<Book />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/checkout/:id" element={<Guard role="USER"><Checkout /></Guard>} />
          <Route path="/ticket/:id" element={<Guard role="USER"><TicketPage /></Guard>} />
          <Route path="/bookings" element={<Guard role="USER"><MyBookings /></Guard>} />
          <Route path="/organiser" element={<Guard role="ORGANISER"><Dashboard /></Guard>} />
          <Route path="/organiser/trains" element={<Guard role="ORGANISER"><Trains /></Guard>} />
          <Route path="/organiser/runs" element={<Guard role="ORGANISER"><Runs /></Guard>} />
          <Route path="/organiser/runs/:id" element={<Guard role="ORGANISER"><RunDetail /></Guard>} />
          <Route path="*" element={<div className="container page"><div className="empty"><h3>Page not found</h3><Link className="btn btn-dark" to="/">Back to home</Link></div></div>} />
        </Routes>
      </main>
      <footer className="site-footer"><div className="container">RailRush is a demo booking system. Payments are simulated and no real money moves.</div></footer>
    </>
  );
}
