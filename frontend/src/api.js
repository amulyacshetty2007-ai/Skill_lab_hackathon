export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

async function request(method, path, body, headers = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok && !(data && data.payment)) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Something went wrong', e.details);
  }
  return { status: res.status, ...data };
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b, h) => request('POST', p, b ?? {}, h),
};

export const fieldErrors = (e) => Object.fromEntries((e.details || []).map((d) => [d.field, d.message]));
