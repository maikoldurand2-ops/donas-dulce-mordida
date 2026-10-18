import { api, authRequest, SUPABASE_URL, PUBLIC_KEY } from '../assets/js/backend.js';

const ADMIN_EMAIL = 'maikoldurand2@gmail.com';
void PUBLIC_KEY;
const state = { accessToken: null, refreshToken: null, expiresAt: 0, refreshTimer: null, refreshing: null, products: [], images: [], combos: [], comboItems: [], settings: [], activationPending: false };
const $ = (id) => document.getElementById(id);
const esc = encodeURIComponent;
const fields = {
  products: 'id,name,description,price,quantity,image_id,active,sort_order',
  images: 'id,url,storage_path,caption,in_gallery,active,sort_order',
  combos: 'id,name,description,price,image_id,active,sort_order',
  comboItems: 'combo_id,product_id,quantity',
  settings: 'key,image_id'
};

function setStatus(target, message = '', kind = '') {
  const node = typeof target === 'string' ? $(target) : target;
  node.textContent = message;
  node.className = `status${kind ? ` ${kind}` : ''}`;
}
function showView(name) {
  $('login-view').hidden = name !== 'login';
  $('activation-view').hidden = name !== 'activation';
  $('admin-view').hidden = name !== 'admin';
}
function setBusy(form, busy) {
  for (const button of form.querySelectorAll('button[type="submit"]')) {
    button.disabled = busy;
    if (busy) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
  }
}
function setSession(session) {
  state.accessToken = session.access_token || null;
  state.refreshToken = session.refresh_token || null;
  const expires = session.expires_at || (session.expires_in ? Math.floor(Date.now() / 1000) + Number(session.expires_in) : 0);
  state.expiresAt = Number(expires) * 1000;
  scheduleRefresh();
}
function clearSecrets() {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = null;
  state.accessToken = null;
  state.refreshToken = null;
  state.expiresAt = 0;
  state.activationPending = false;
  $('login-password').value = '';
  $('new-password').value = '';
  $('confirm-password').value = '';
  for (const id of ['product-form', 'combo-form', 'image-edit-form']) $(id).reset();
  $('product-form').hidden = true;
  $('combo-form').hidden = true;
  $('image-edit-form').hidden = true;
  $('product-list').replaceChildren();
  $('combo-list').replaceChildren();
  $('image-list').replaceChildren();
  $('global-status').textContent = '';
}
async function validateAdmin() {
  if (!state.accessToken) throw new Error('La sesión no está disponible. Inicia sesión de nuevo.');
  const user = await authRequest('/user', { method: 'GET', token: state.accessToken });
  if (!user?.email || user.email.toLowerCase() !== ADMIN_EMAIL) throw new Error('Esta cuenta no está autorizada para administrar el sitio.');
  const allowed = await api('/rest/v1/rpc/is_catalog_admin', { method: 'POST', body: {}, token: state.accessToken });
  if (allowed !== true) throw new Error('La cuenta no tiene permiso de administrador en el catálogo.');
  return user;
}
function scheduleRefresh() {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  if (!state.refreshToken || !state.expiresAt) return;
  const delay = Math.max(1000, state.expiresAt - Date.now() - 60_000);
  state.refreshTimer = setTimeout(() => refreshSession().catch((error) => {
    clearSecrets(); showView('login'); setStatus('login-status', `La sesión expiró: ${error.message}`, 'error');
  }), delay);
}
async function refreshSession() {
  if (state.refreshing) return state.refreshing;
  if (!state.refreshToken) throw new Error('No hay sesión renovable. Inicia sesión de nuevo.');
  const refreshToken = state.refreshToken;
  state.refreshing = (async () => {
    const session = await authRequest('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
    setSession(session);
    await validateAdmin();
  })();
  try { await state.refreshing; } finally { state.refreshing = null; }
}
async function ensureFreshSession() {
  if (!state.accessToken) throw new Error('Inicia sesión de nuevo para continuar.');
  if (state.expiresAt && state.expiresAt - Date.now() < 30_000) await refreshSession();
  return state.accessToken;
}
async function request(path, options = {}) {
  const token = await ensureFreshSession();
  return api(path, { ...options, token });
}
async function authSession(session) {
  if (!session?.access_token) throw new Error('El servidor no devolvió una sesión válida.');
  setSession(session);
  await validateAdmin();
}
function safeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
      return null;
    }
    if (/^(?:javascript|data|vbscript):/i.test(raw) || raw.startsWith('//')) return null;
    const url = new URL(raw, `${location.origin}/`);
    return url.origin === location.origin ? url.href : null;
  } catch { return null; }
}
function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}
function fillImageSelect(select, selected, includeBlank = true) {
  select.replaceChildren();
  if (includeBlank) addOption(select, '', 'Sin imagen');
  for (const image of state.images) {
    const option = document.createElement('option');
    option.value = image.id;
    option.textContent = `${image.caption || 'Imagen sin descripción'}${image.active ? '' : ' (inactiva)'}`;
    select.append(option);
  }
  select.value = selected || '';
}
async function readAll(table, columns, order = 'sort_order,id') {
  const result = [];
  for (let page = 0; page < 40; page++) {
    const data = await request(`/rest/v1/${table}?select=${columns}&order=${order}&limit=200&offset=${page*200}`);
    if (!Array.isArray(data)) throw new Error('Respuesta de catálogo no válida.');
    result.push(...data);
    if (data.length < 200) return result;
  }
  throw new Error('El catálogo excede el tamaño admitido por el panel; no se muestra una lista parcial.');
}
async function loadState() {
  $('loading').hidden = false;
  setStatus('global-status', '');
  try {
    const [products, images, combos, comboItems, settings] = await Promise.all([
      readAll('products', fields.products),
      readAll('catalog_images', fields.images),
      readAll('combos', fields.combos),
      readAll('combo_items', fields.comboItems, 'combo_id,product_id'),
      readAll('site_settings', fields.settings, 'key')
    ]);
    state.products = Array.isArray(products) ? products : [];
    state.images = Array.isArray(images) ? images : [];
    state.combos = Array.isArray(combos) ? combos : [];
    state.comboItems = Array.isArray(comboItems) ? comboItems : [];
    state.settings = Array.isArray(settings) ? settings : [];
    renderProducts(); renderCombos(); renderImages(); renderSelectors();
  } catch (error) {
    setStatus('global-status', `No se pudo cargar el catálogo: ${error.message}`, 'error');
    throw error;
  } finally { $('loading').hidden = true; }
}
function renderSelectors() {
  fillImageSelect($('product-image'), $('product-image').value);
  fillImageSelect($('combo-image'), $('combo-image').value);
  const hero = state.settings.find((row) => row.key === 'hero')?.image_id || '';
  const menu = state.settings.find((row) => row.key === 'menu')?.image_id || '';
  fillImageSelect($('hero-image'), hero, false);
  fillImageSelect($('menu-image'), menu, false);
}
function imageLabel(id) { return state.images.find((image) => image.id === id)?.caption || (id ? 'Imagen vinculada' : 'Sin imagen'); }
function makeEmpty(message) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = message; return p; }
function addRecord(list, record, detail, editAction, deleteAction) {
  const card = document.createElement('article'); card.className = 'record';
  const main = document.createElement('div'); main.className = 'record-main';
  const title = document.createElement('p'); title.className = 'record-title'; title.textContent = record.name || '(Sin nombre)';
  const badge = document.createElement('span'); badge.className = `badge${record.active ? '' : ' inactive'}`; badge.textContent = record.active ? 'Activo' : 'Inactivo'; title.append(badge);
  const meta = document.createElement('p'); meta.className = 'record-meta'; meta.textContent = detail;
  main.append(title, meta);
  const actions = document.createElement('div'); actions.className = 'record-actions';
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button secondary'; edit.textContent = 'Editar'; edit.addEventListener('click', editAction);
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = 'Eliminar'; remove.addEventListener('click', deleteAction);
  actions.append(edit, remove); card.append(main, actions); list.append(card);
}
function renderProducts() {
  const list = $('product-list'); list.replaceChildren();
  if (!state.products.length) { list.append(makeEmpty('Todavía no hay productos.')); return; }
  [...state.products].sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).forEach((product) => {
    addRecord(list, product, `${product.quantity ?? 0} unidades · $${product.price ?? '0'} · ${imageLabel(product.image_id)} · orden ${product.sort_order ?? 0}`, () => editProduct(product), () => deleteProduct(product));
  });
}
function renderCombos() {
  const list = $('combo-list'); list.replaceChildren();
  if (!state.combos.length) { list.append(makeEmpty('Todavía no hay combos.')); return; }
  [...state.combos].sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).forEach((combo) => {
    const items = state.comboItems.filter((item) => item.combo_id === combo.id).map((item) => {
      const p = state.products.find((product) => product.id === item.product_id);
      return `${p?.name || 'Producto eliminado'} × ${item.quantity}`;
    }).join(', ') || 'Sin componentes';
    addRecord(list, combo, `$${combo.price ?? '0'} · ${items} · orden ${combo.sort_order ?? 0}`, () => editCombo(combo), () => deleteCombo(combo));
  });
}
function renderImages() {
  const grid = $('image-list'); grid.replaceChildren();
  if (!state.images.length) { grid.append(makeEmpty('Todavía no hay imágenes.')); return; }
  [...state.images].sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).forEach((image) => {
    const card = document.createElement('article'); card.className = 'image-card';
    const src = safeImageUrl(image.url);
    if (src) { const img = document.createElement('img'); img.src = src; img.alt = image.caption || ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; card.append(img); }
    const body = document.createElement('div'); body.className = 'image-card-body';
    const title = document.createElement('h3'); title.textContent = image.caption || 'Imagen sin descripción';
    const info = document.createElement('p'); info.textContent = `${image.active ? 'Activa' : 'Inactiva'} · ${image.in_gallery ? 'En galería' : 'Fuera de galería'} · orden ${image.sort_order ?? 0}`;
    const buttons = document.createElement('div'); buttons.className = 'image-card-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'button secondary'; edit.textContent = 'Editar'; edit.addEventListener('click', () => editImage(image));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => deleteImage(image));
    buttons.append(edit, remove); body.append(title, info, buttons); card.append(body); grid.append(card);
  });
}
function resetProductForm() { $('product-form').reset(); $('product-id').value = ''; $('product-quantity').value = '1'; $('product-sort').value = '0'; $('product-active').checked = true; $('product-form-title').textContent = 'Nuevo producto'; renderSelectors(); }
function editProduct(product) {
  $('product-id').value = product.id; $('product-name').value = product.name || ''; $('product-description').value = product.description || '';
  $('product-price').value = product.price ?? 0; $('product-quantity').value = product.quantity ?? 0; $('product-sort').value = product.sort_order ?? 0; $('product-active').checked = !!product.active;
  renderSelectors(); $('product-image').value = product.image_id || ''; $('product-form-title').textContent = 'Editar producto'; $('product-form').hidden = false; $('product-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function deleteProduct(product) {
  if (!confirm(`¿Eliminar “${product.name}”? Los productos referenciados por combos no se pueden eliminar.`)) return;
  try { await request(`/rest/v1/products?id=eq.${esc(product.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }); await loadState(); setStatus('global-status', 'Producto eliminado.', 'success'); }
  catch (error) { setStatus('global-status', `No se pudo eliminar el producto. Si un combo lo referencia, elimínalo de ese combo primero. Detalle: ${error.message}`, 'error'); }
}
function addComboItem(productId = '', quantity = 1) {
  const row = document.createElement('div'); row.className = 'component-row';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Producto del combo');
  addOption(select, '', 'Selecciona producto');
  for (const p of state.products) { const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.name}${p.active ? '' : ' (inactivo)'}`; select.append(o); }
  select.value = productId;
  const count = document.createElement('input'); count.type = 'number'; count.min = '1'; count.step = '1'; count.required = true; count.value = String(quantity); count.setAttribute('aria-label', 'Cantidad');
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger remove-component'; remove.textContent = 'Quitar'; remove.addEventListener('click', () => row.remove());
  row.append(select, count, remove); $('combo-items').append(row);
}
function resetComboForm() { $('combo-form').reset(); $('combo-id').value = ''; $('combo-sort').value = '0'; $('combo-active').checked = true; $('combo-items').replaceChildren(); $('combo-form-title').textContent = 'Nuevo combo'; renderSelectors(); }
function editCombo(combo) {
  $('combo-id').value = combo.id; $('combo-name').value = combo.name || ''; $('combo-description').value = combo.description || ''; $('combo-price').value = combo.price ?? 0;
  $('combo-sort').value = combo.sort_order ?? 0; $('combo-active').checked = !!combo.active; renderSelectors(); $('combo-image').value = combo.image_id || '';
  $('combo-items').replaceChildren();
  for (const item of state.comboItems.filter((row) => row.combo_id === combo.id)) addComboItem(item.product_id, item.quantity);
  $('combo-form-title').textContent = 'Editar combo'; $('combo-form').hidden = false; $('combo-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function deleteCombo(combo) {
  if (!confirm(`¿Eliminar el combo “${combo.name}”?`)) return;
  try { await request(`/rest/v1/combos?id=eq.${esc(combo.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }); await loadState(); setStatus('global-status', 'Combo eliminado.', 'success'); }
  catch (error) { setStatus('global-status', `No se pudo eliminar el combo: ${error.message}`, 'error'); }
}
function editImage(image) {
  $('image-edit-id').value = image.id; $('image-edit-caption').value = image.caption || ''; $('image-edit-sort').value = image.sort_order ?? 0;
  $('image-edit-gallery').checked = !!image.in_gallery; $('image-edit-active').checked = !!image.active; $('image-edit-form').hidden = false;
  $('image-edit-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function saveSetting(key, imageId) {
  const existing = state.settings.find((row) => row.key === key);
  if (existing) await request(`/rest/v1/site_settings?key=eq.${esc(key)}`, { method: 'PATCH', body: { image_id: imageId || null }, headers: { Prefer: 'return=representation' } });
  else await request('/rest/v1/site_settings', { method: 'POST', body: { key, image_id: imageId || null }, headers: { Prefer: 'return=representation' } });
  await loadState(); setStatus('global-status', `Imagen ${key === 'hero' ? 'principal' : 'del menú'} actualizada.`, 'success');
}
async function deleteImage(image) {
  const assigned = state.settings.filter((row) => row.image_id === image.id).map((row) => row.key);
  if (assigned.length) { setStatus('global-status', `No se puede borrar esta imagen todavía: reemplaza primero ${assigned.join(' y ')} en “Imágenes principales del sitio”.`, 'error'); return; }
  if (!confirm(`¿Eliminar la imagen “${image.caption || image.url}”? Los productos/combos que la usen quedarán sin imagen. Esta acción no se puede deshacer.`)) return;
  try {
    await request(`/rest/v1/catalog_images?id=eq.${esc(image.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  } catch (error) { setStatus('global-status', `No se pudo borrar la fila de imagen: ${error.message}`, 'error'); return; }
  if (image.storage_path) {
    try { await request('/storage/v1/object/catalog-images', { method: 'DELETE', body: { prefixes: [image.storage_path] } }); }
    catch (error) {
      let reloadError = '';
      try { await loadState(); } catch (refreshError) { reloadError = ` Además, no se pudo recargar el catálogo: ${refreshError.message}.`; }
      setStatus('global-status', `La fila se borró, pero falló la limpieza del archivo almacenado (${image.storage_path}): ${error.message}. El archivo puede quedar huérfano.${reloadError}`, 'error'); return;
    }
  }
  await loadState(); setStatus('global-status', 'Imagen eliminada.', 'success');
}

$('login-email').value = ADMIN_EMAIL;
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setStatus('login-status', ''); setBusy(form, true);
  try {
    const email = $('login-email').value.trim().toLowerCase();
    if (email !== ADMIN_EMAIL) throw new Error('Correo no autorizado.');
    const session = await authRequest('/token?grant_type=password', { body: { email: ADMIN_EMAIL, password: $('login-password').value } });
    await authSession(session); $('login-password').value = ''; showView('admin'); await loadState();
  } catch (error) { clearSecrets(); showView('login'); setStatus('login-status', error.message || 'No se pudo iniciar sesión.', 'error'); }
  finally { setBusy(form, false); }
});
$('activation-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true); setStatus('activation-status', '');
  const password = $('new-password').value; const confirmation = $('confirm-password').value;
  try {
    if (password.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
    await authRequest('/user', { method: 'PUT', body: { password }, token: state.accessToken });
    $('new-password').value = ''; $('confirm-password').value = ''; state.activationPending = false; showView('admin'); await loadState();
  } catch (error) { setStatus('activation-status', error.message || 'No se pudo guardar la contraseña.', 'error'); }
  finally { setBusy(form, false); }
});
$('signout-button').addEventListener('click', async () => {
  let logoutError = null;
  try { if (state.accessToken) await authRequest('/logout', { method: 'POST', token: state.accessToken }); }
  catch (error) { logoutError = error; }
  clearSecrets(); showView('login');
  if (logoutError) setStatus('login-status', `Sesión local cerrada; el servidor no confirmó el cierre: ${logoutError.message}`, 'error');
  else setStatus('login-status', 'Sesión cerrada.', 'success');
});
$('new-product').addEventListener('click', () => { resetProductForm(); $('product-form').hidden = false; $('product-form').scrollIntoView({ behavior: 'smooth' }); $('product-name').focus(); });
$('product-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true); setStatus('global-status', '');
  const id = $('product-id').value;
  const body = { name: $('product-name').value.trim(), description: $('product-description').value.trim(), price: Number($('product-price').value), quantity: Number($('product-quantity').value), image_id: $('product-image').value || null, active: $('product-active').checked, sort_order: Number($('product-sort').value || 0) };
  try {
    await request(id ? `/rest/v1/products?id=eq.${esc(id)}` : '/rest/v1/products', { method: id ? 'PATCH' : 'POST', body, headers: { Prefer: 'return=representation' } });
    $('product-form').hidden = true; resetProductForm(); await loadState(); setStatus('global-status', 'Producto guardado.', 'success');
  } catch (error) { setStatus('global-status', `No se pudo guardar el producto: ${error.message}`, 'error'); }
  finally { setBusy(form, false); }
});
$('new-combo').addEventListener('click', () => { resetComboForm(); addComboItem(); $('combo-form').hidden = false; $('combo-form').scrollIntoView({ behavior: 'smooth' }); $('combo-name').focus(); });
$('add-combo-item').addEventListener('click', () => addComboItem());
$('combo-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true); setStatus('global-status', '');
  const id = $('combo-id').value || null;
  const aggregated = new Map();
  for (const row of $('combo-items').querySelectorAll('.component-row')) {
    const [select, count] = row.querySelectorAll('select,input');
    if (!select.value) { setStatus('global-status', 'Selecciona un producto en cada componente.', 'error'); setBusy(form, false); return; }
    const quantity = Number(count.value);
    if (!Number.isInteger(quantity) || quantity < 1) { setStatus('global-status', 'La cantidad de cada componente debe ser un entero mayor que cero.', 'error'); setBusy(form, false); return; }
    aggregated.set(select.value, (aggregated.get(select.value) || 0) + quantity);
  }
  const body = { p_id: id, p_name: $('combo-name').value.trim(), p_description: $('combo-description').value.trim(), p_price: Number($('combo-price').value), p_image_id: $('combo-image').value || null, p_active: $('combo-active').checked, p_sort_order: Number($('combo-sort').value || 0), p_items: [...aggregated].map(([product_id, quantity]) => ({ product_id, quantity })) };
  try {
    await request('/rest/v1/rpc/save_combo', { method: 'POST', body, headers: { Prefer: 'return=representation' } });
    $('combo-form').hidden = true; resetComboForm(); await loadState(); setStatus('global-status', 'Combo y componentes guardados.', 'success');
  } catch (error) { setStatus('global-status', `No se pudo guardar el combo: ${error.message}`, 'error'); }
  finally { setBusy(form, false); }
});
$('upload-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true); setStatus('global-status', '');
  const file = $('image-file').files[0];
  try {
    if (!file) throw new Error('Selecciona un archivo de imagen.');
    if (file.size > 5 * 1024 * 1024) throw new Error('El archivo supera el límite de 5 MB.');
    const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    const ext = types[file.type];
    if (!ext) throw new Error('Formato no permitido. Sube JPEG, PNG o WebP; SVG está prohibido.');
    const filename = `${crypto.randomUUID()}.${ext}`;
    const storagePath = filename;
    const objectPath = `/storage/v1/object/catalog-images/${storagePath}`;
    await request(objectPath, { method: 'POST', rawBody: file, headers: { 'Content-Type': file.type, 'x-upsert': 'false' } });
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/catalog-images/${storagePath}`;
    try {
      await request('/rest/v1/catalog_images', { method: 'POST', body: { url, storage_path: storagePath, caption: $('image-caption').value.trim(), in_gallery: $('image-gallery').checked, active: $('image-active').checked, sort_order: Number($('image-sort').value || 0) }, headers: { Prefer: 'return=representation' } });
    } catch (dbError) {
      let alreadySaved = false;
      if (!dbError.status || dbError.status >= 500) {
        try {
          const matches = await request(`/rest/v1/catalog_images?select=id&storage_path=eq.${esc(storagePath)}&limit=1`);
          alreadySaved = Array.isArray(matches) && matches.length > 0;
        } catch {
          throw new Error(`La red no permite confirmar si la imagen se guardó. No se borró el archivo por precaución. Recarga el catálogo antes de volver a subirla. Archivo: ${storagePath}`);
        }
      }
      if (!alreadySaved) {
        try { await request('/storage/v1/object/catalog-images', { method: 'DELETE', body: { prefixes: [storagePath] } }); }
        catch (cleanupError) { throw new Error(`No se pudo guardar el registro (${dbError.message}) y falló la limpieza del archivo subido (${cleanupError.message}); puede quedar un archivo huérfano.`); }
        throw new Error(`No se pudo guardar el registro; se limpió el archivo subido. Detalle: ${dbError.message}`);
      }
    }
    form.reset(); $('image-sort').value = '0'; $('image-gallery').checked = true; $('image-active').checked = true;
    await loadState(); setStatus('global-status', 'Imagen subida y registrada.', 'success');
  } catch (error) { setStatus('global-status', `No se pudo subir la imagen: ${error.message}`, 'error'); }
  finally { setBusy(form, false); }
});
$('image-edit-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  const id = $('image-edit-id').value;
  try {
    await request(`/rest/v1/catalog_images?id=eq.${esc(id)}`, { method: 'PATCH', body: { caption: $('image-edit-caption').value.trim(), sort_order: Number($('image-edit-sort').value || 0), in_gallery: $('image-edit-gallery').checked, active: $('image-edit-active').checked }, headers: { Prefer: 'return=representation' } });
    form.hidden = true; form.reset(); await loadState(); setStatus('global-status', 'Metadatos de imagen guardados.', 'success');
  } catch (error) { setStatus('global-status', `No se pudieron guardar los metadatos: ${error.message}`, 'error'); }
  finally { setBusy(form, false); }
});
$('hero-image').addEventListener('change', (event) => saveSetting('hero', event.currentTarget.value).catch((error) => setStatus('global-status', `No se pudo actualizar la imagen principal: ${error.message}`, 'error')));
$('menu-image').addEventListener('change', (event) => saveSetting('menu', event.currentTarget.value).catch((error) => setStatus('global-status', `No se pudo actualizar la imagen del menú: ${error.message}`, 'error')));
document.querySelectorAll('.cancel-editor').forEach((button) => button.addEventListener('click', () => { const form = button.closest('form'); form.hidden = true; form.reset(); }));
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
  for (const name of ['products', 'combos', 'images']) $(`${name}-panel`).hidden = tab.dataset.tab !== name;
}));

async function initialize() {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(fragment);
  const tokenHash = params.get('token_hash'); const inviteType = params.get('type');
  if (fragment) history.replaceState(null, '', `${location.pathname}${location.search}`);
  if (tokenHash && inviteType === 'invite') {
    showView('activation'); setStatus('activation-status', 'Verificando invitación…');
    try {
      const result = await authRequest('/verify', { body: { token_hash: tokenHash, type: 'invite' } });
      await authSession(result.session || result);
      state.activationPending = true; showView('activation'); setStatus('activation-status', 'Invitación verificada. Elige tu contraseña para continuar.', 'success');
    } catch (error) { clearSecrets(); showView('login'); setStatus('login-status', `No se pudo verificar la invitación: ${error.message}`, 'error'); }
    return;
  }
  clearSecrets(); showView('login');
}
initialize();
