// Solo configuración pública. La autorización real se aplica en PostgreSQL y Storage.
export const SUPABASE_URL = 'https://knzxdzuuklfpaplnzmev.supabase.co';
export const PUBLIC_KEY = 'sb_publishable_HvavGm_Km0bMEH3F0AjfkA_fMs4fTMc';
export async function api(path, options = {}) {
  const {method = 'GET', body, token, headers = {}, rawBody} = options;
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Ruta no válida.');
  const requestHeaders = new Headers({apikey: PUBLIC_KEY, ...headers});
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(SUPABASE_URL + path, {
      method, headers: requestHeaders,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : null; } catch { result = null; }
    if (!response.ok) {
      const message = result?.msg || result?.message || result?.error_description || result?.error || `Error HTTP ${response.status}`;
      const error = new Error(typeof message === 'string' ? message : 'No se pudo completar la operación.');
      error.status = response.status;
      error.code = result?.code;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El servidor tardó demasiado. Comprueba la lista antes de volver a guardar.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export function authRequest(path, {method = 'POST', body, token} = {}) {
  return api('/auth/v1' + path, {method, body, token});
}
