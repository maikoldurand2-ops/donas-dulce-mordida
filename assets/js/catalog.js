import {api} from './backend.js';
const WHATSAPP = 'https://wa.me/584142227837?text=';
const money = (value) => '$' + Number(value).toFixed(2);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function imageUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}
async function rows(table, fields, maxPages = 20) {
  const result = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await api(`/rest/v1/${table}?select=${fields}&order=${table === 'combo_items' ? 'combo_id,product_id' : table === 'site_settings' ? 'key' : 'sort_order,id'}&limit=200&offset=${page * 200}`);
    if (!Array.isArray(data)) throw new Error('Respuesta de catálogo no válida.');
    result.push(...data);
    if (data.length < 200) return result;
  }
  throw new Error('El catálogo excede el tamaño permitido. Contacta con el negocio.');
}
function photo(image, className) {
  const src = image && imageUrl(image.url);
  if (!src) return null;
  const img = el('img'); img.src = src; img.alt = image.caption || 'Donas Dulce Mordida';
  img.loading = 'lazy'; img.width = 765; img.height = 1020;
  img.referrerPolicy = 'no-referrer'; if (className) img.className = className;
  return img;
}
function promoCard(record, image, subtitle, message, kind) {
  const card = el('article', undefined, 'promo-card');
  card.dataset.itemId = record.id; card.dataset.kind = kind;
  card.append(el('span', `${kind === 'combo' ? 'Combo · ' : ''}${money(record.price)}`, 'promo-tag'));
  const visual = el('div', undefined, 'visual');
  const img = photo(image); if (img) visual.append(img); else visual.append(el('span', 'Donas Dulce Mordida'));
  const content = el('div', undefined, 'promo-card-content');
  content.append(el('h3', record.name), el('p', subtitle));
  if (record.description) content.append(el('p', record.description));
  const order = el('a', 'Pedir ' + record.name, 'ghost');
  order.href = WHATSAPP + encodeURIComponent(message); order.target = '_blank'; order.rel = 'noopener noreferrer';
  content.append(order); card.append(visual, content); return card;
}
async function loadCatalog() {
  const status = document.getElementById('catalogStatus');
  try {
    const [products, images, combos, items, settings] = await Promise.all([
      rows('products','id,name,description,price,quantity,image_id,sort_order'),
      rows('catalog_images','id,url,caption,in_gallery,sort_order'),
      rows('combos','id,name,description,price,image_id,sort_order'),
      rows('combo_items','combo_id,product_id,quantity',50), rows('site_settings','key,image_id',1)
    ]);
    const imageMap = new Map(images.map(i => [i.id,i]));
    const productMap = new Map(products.map(p => [p.id,p]));
    const grid = document.querySelector('#catalogo .promo-grid');
    const cards = products.map(p => promoCard(p,imageMap.get(p.image_id),`${p.quantity} mini donas · ${money(p.price)}`,
      `Hola Donas Dulce Mordida, quiero pedir ${p.name}: ${p.quantity} mini donas, precio base ${money(p.price)}. Quisiera confirmar toppings, disponibilidad, extras y entrega.`, 'product'));
    for (const combo of combos) {
      const components = items.filter(i => i.combo_id === combo.id);
      if (!components.length || components.some(i => !productMap.has(i.product_id))) continue;
      const text = components.map(i => `${i.quantity} × ${productMap.get(i.product_id).name}`).join(' + ');
      cards.push(promoCard(combo,imageMap.get(combo.image_id),text + ' · ' + money(combo.price),
        `Hola Donas Dulce Mordida, quiero pedir el combo ${combo.name}: ${text}. Precio de oferta ${money(combo.price)}. Quisiera confirmar toppings, disponibilidad, extras y entrega.`, 'combo'));
    }
    grid.replaceChildren(...cards); grid.hidden=false;
    if (!cards.length) grid.append(el('p','No hay productos u ofertas activos en este momento. Consulta por WhatsApp.'));
    const gallery = document.querySelector('#galeria .gallery-grid');
    const galleryCards = images.filter(i => i.in_gallery && imageUrl(i.url)).map(image => {
      const card = el('article',undefined,'gallery-item');
      const link = el('a',undefined,'thumb'); link.style.display='block'; link.href=imageUrl(image.url);
      link.target='_blank'; link.rel='noopener noreferrer'; link.setAttribute('aria-label','Ver foto completa: '+image.caption);
      link.append(photo(image)); const meta=el('div',undefined,'meta'); meta.append(el('h4',image.caption));
      card.append(link,meta); return card;
    });
    gallery.replaceChildren(...galleryCards); gallery.hidden=false;
    if (!galleryCards.length) gallery.append(el('p','Pronto compartiremos nuevas fotos.'));
    const heroImage=imageMap.get(settings.find(s=>s.key==='hero')?.image_id);
    const hero=document.querySelector('.hero-photo'); const heroSrc=heroImage&&imageUrl(heroImage.url);
    hero.hidden=!heroSrc; if(heroSrc){hero.src=heroSrc;hero.alt=heroImage.caption;}
    const menuImage=imageMap.get(settings.find(s=>s.key==='menu')?.image_id);
    const menu=document.querySelector('.menu-original'); const menuSrc=menuImage&&imageUrl(menuImage.url);
    menu.hidden=!menuSrc;
    if(menuSrc){
      for(const a of menu.querySelectorAll('a'))a.href=menuSrc;
      const img=menu.querySelector('img');img.src=menuSrc;img.alt=menuImage.caption;
      const caption=menu.querySelector('figcaption');
      caption.firstChild.textContent='Menú de referencia facilitado por el negocio. Los precios vigentes son los de las tarjetas de productos y combos. ';
    }
    window.dispatchEvent(new CustomEvent('dulcemordida:catalog',{detail:products}));
    status.textContent='Catálogo actualizado. Los pedidos se confirman por WhatsApp.';
    status.dataset.state='ready';
  } catch {
    status.textContent='No se pudo consultar el catálogo actualizado. Usa WhatsApp para confirmar disponibilidad y precios.';
    status.dataset.state='error';
    // No mostrar precios antiguos como si acabaran de guardarse o consultarse.
    document.querySelector('#catalogo .promo-grid').replaceChildren();
    window.dispatchEvent(new CustomEvent('dulcemordida:catalog',{detail:[]}));
    document.querySelector('.menu-original').hidden=true;
  }
}
loadCatalog();
