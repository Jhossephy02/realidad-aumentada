function normalizeBase(base) {
  const v = String(base || '').trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
}

export function getApiBase() {
  return normalizeBase(import.meta.env.VITE_API_BASE);
}

export function absUrl(pathOrUrl) {
  const v = String(pathOrUrl || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const base = getApiBase();
  if (!base) return v;
  if (v.startsWith('/')) return `${base}${v}`;
  return `${base}/${v}`;
}

export async function apiFetch(path, { method = 'GET', token, json, formData } = {}) {
  const url = absUrl(path);
  const headers = {};
  const auth = String(token || '').trim();
  if (auth) headers.Authorization = `Bearer ${auth}`;
  let body = undefined;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (formData) {
    body = formData;
  }

  const res = await fetch(url, { method, headers, body });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      try {
        window.dispatchEvent(new CustomEvent('webar:unauthorized', { detail: { status: 401 } }));
      } catch (e) {}
    }
    const message = typeof data === 'object' && data && data.message ? String(data.message) : `Error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
