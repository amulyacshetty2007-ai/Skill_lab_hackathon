import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { fieldErrors } from '../api.js';

function useAfterAuth() {
  const nav = useNavigate(); const [sp] = useSearchParams();
  return (user) => {
    const next = sp.get('next');
    nav(next && next.startsWith('/') && !next.startsWith('//') ? next : user.role === 'ORGANISER' ? '/organiser' : '/', { replace: true });
  };
}

export function Login() {
  const { login } = useAuth();
  const after = useAfterAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { after(await login(email, password)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1 style={{ fontSize: '2.2rem' }}>Sign in</h1>
        {err && <div className="notice notice-bad" role="alert">{err}</div>}
        <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="demo-creds">
          <strong>Demo accounts</strong>
          <button type="button" onClick={() => { setEmail('user@railrush.dev'); setPassword('User@12345'); }}>Traveller: user@railrush.dev</button>
          <button type="button" onClick={() => { setEmail('organiser@railrush.dev'); setPassword('Organiser@123'); }}>Organiser: organiser@railrush.dev</button>
        </div>
        <p className="muted">New here? <Link to="/register" style={{ fontWeight: 700 }}>Create an account</Link></p>
      </form>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const after = useAfterAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', organiserCode: '' });
  const [org, setOrg] = useState(false);
  const [errs, setErrs] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setErrs({});
    try { after(await register({ name: f.name, email: f.email, password: f.password, ...(org && f.organiserCode ? { organiserCode: f.organiserCode } : {}) })); }
    catch (x) { if (x.code === 'VALIDATION_FAILED') setErrs(fieldErrors(x)); else setErr(x.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1 style={{ fontSize: '2.2rem' }}>Create your account</h1>
        {err && <div className="notice notice-bad" role="alert">{err}</div>}
        <div className="field"><label htmlFor="rn">Full name</label><input id="rn" className="input" autoComplete="name" value={f.name} onChange={set('name')} aria-invalid={!!errs.name} />{errs.name && <span className="field-error">{errs.name}</span>}</div>
        <div className="field"><label htmlFor="re">Email</label><input id="re" className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} aria-invalid={!!errs.email} />{errs.email && <span className="field-error">{errs.email}</span>}</div>
        <div className="field"><label htmlFor="rp">Password</label><input id="rp" className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} aria-invalid={!!errs.password} />
          <span className="hint">At least 8 characters with upper case, lower case and a digit.</span>{errs.password && <span className="field-error">{errs.password}</span>}</div>
        <label className="row" style={{ fontWeight: 600 }}><input type="checkbox" checked={org} onChange={(e) => setOrg(e.target.checked)} /> I run trains and have an organiser invite code</label>
        {org && <div className="field"><label htmlFor="rc">Organiser invite code</label><input id="rc" className="input" value={f.organiserCode} onChange={set('organiserCode')} autoComplete="off" /></div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="muted">Already registered? <Link to="/login" style={{ fontWeight: 700 }}>Sign in</Link></p>
      </form>
    </div>
  );
}
