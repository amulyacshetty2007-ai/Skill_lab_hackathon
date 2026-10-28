import { HttpError } from '../utils/httpError.js';

// CSRF defence in depth (the session cookie is also SameSite=Strict):
// browsers always send Origin on cross-site POST/PUT/DELETE, so reject any state-changing request
// whose Origin is not one of ours. Non-browser clients (curl, tests) send no Origin and are unaffected,
// and they cannot ride on a victim's cookie anyway.
export const originGuard = (allowed) => (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !allowed.includes(origin)) return next(new HttpError(403, 'BAD_ORIGIN', 'Cross-site request blocked'));
  next();
};
