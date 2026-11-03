/**
 * Tienda Coquette – servidor (Google Apps Script)
 * Va en el MISMO proyecto que Armony.gs (usa la hoja "Armony" como catálogo).
 *
 * Propiedades que hay que cargar (Configuración del proyecto → Propiedades de la secuencia de comandos):
 *   MP_ACCESS_TOKEN   → credencial de producción de Mercado Pago (APP_USR-...)
 *   GOOGLE_CLIENT_ID  → ID de cliente OAuth de Google (....apps.googleusercontent.com)
 *   SITE_URL          → dirección de la tienda (ej: https://usuario.github.io/coquet/)
 *   WEBAPP_URL        → (opcional) URL /exec de esta app web, si Google no la detecta sola
 */

const TIENDA = {
  NOMBRE: 'Coquette',
  HOJA_PEDIDOS: 'Pedidos',
  HOJA_ENVIOS: 'Envíos',
  ADMINS: ['luzaquino84@gmail.com'],
  CUOTAS_MAX: 12,          // máximo de cuotas que ofrece Mercado Pago
  CACHE_MIN: 10,           // minutos que se guarda el catálogo en memoria
  ZONA_HORARIA: 'America/Argentina/Buenos_Aires'
};

const COLUMNAS_PEDIDOS = [
  'Pedido', 'Fecha', 'Estado', 'Email', 'Cliente', 'Teléfono', 'DNI', 'Envío', 'Dirección',
  'Ciudad', 'Provincia', 'CP', 'Productos', 'Subtotal', 'Costo envío', 'Total',
  'Pago MP', 'Estado MP', 'Seguimiento', 'Notas', 'Items', 'Mail pago'
];

const ESTADOS = ['Esperando pago', 'Pago pendiente', 'Pagado', 'Preparando', 'Enviado', 'Entregado', 'Pago rechazado', 'Cancelado', 'Revisar pago'];

const PROVINCIAS = [
  'CABA', 'Buenos Aires (GBA)', 'Buenos Aires (interior)', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba',
  'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'
];

/* ===================== PUERTAS DE ENTRADA ===================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'catalogo': return json_(catalogo_());
      case 'pedido': return json_(estadoPedido_(p.id, p.payment_id));
      case 'mp': procesarNotificacionMP_(p['data.id'] || p.id, p.type || p.topic); return json_({ ok: true });
      default: return json_({ ok: true, tienda: TIENDA.NOMBRE });
    }
  } catch (err) {
    return json_({ error: mensaje_(err) });
  }
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) {}
  try {
    if (p.action === 'mp') { // aviso de Mercado Pago
      const id = (body.data && body.data.id) || p['data.id'] || p.id;
      procesarNotificacionMP_(id, body.type || p.type || p.topic);
      return json_({ ok: true });
    }
    switch (body.action) {
      case 'crearPedido': return json_(crearPedido_(body));
      case 'misPedidos': return json_(misPedidos_(body));
      case 'admin': return json_(admin_(body));
      default: return json_({ error: 'Acción desconocida.' });
    }
  } catch (err) {
    return json_({ error: mensaje_(err) });
  }
}

/* ===================== INSTALACIÓN ===================== */

// Ejecutar UNA vez: crea las hojas "Pedidos" y "Envíos"
function instalarTienda() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ped = ss.getSheetByName(TIENDA.HOJA_PEDIDOS);
  if (!ped) {
    ped = ss.insertSheet(TIENDA.HOJA_PEDIDOS);
    ped.getRange(1, 1, 1, COLUMNAS_PEDIDOS.length).setValues([COLUMNAS_PEDIDOS]).setFontWeight('bold');
    ped.setFrozenRows(1);
  }
  let env = ss.getSheetByName(TIENDA.HOJA_ENVIOS);
  if (!env) {
    env = ss.insertSheet(TIENDA.HOJA_ENVIOS);
    const filas = [
      ['Zona', 'Provincias (separadas por coma)', 'Correo a domicilio', 'Correo a sucursal'],
      ['AMBA', 'CABA, Buenos Aires (GBA)', '', ''],
      ['Buenos Aires interior', 'Buenos Aires (interior)', '', ''],
      ['Centro', 'Córdoba, Santa Fe, Entre Ríos, La Pampa', '', ''],
      ['Cuyo', 'Mendoza, San Juan, San Luis', '', ''],
      ['Norte', 'Catamarca, Chaco, Corrientes, Formosa, Jujuy, La Rioja, Misiones, Salta, Santiago del Estero, Tucumán', '', ''],
      ['Patagonia', 'Chubut, Neuquén, Río Negro, Santa Cruz, Tierra del Fuego', '', '']
    ];
    env.getRange(1, 1, filas.length, 4).setValues(filas);
    env.getRange(1, 1, 1, 4).setFontWeight('bold');
    env.getRange(2, 3, filas.length - 1, 2).setNumberFormat('$#,##0');
    env.setFrozenRows(1);
    env.setColumnWidth(2, 420);
    env.getRange('F1').setValue('Precio vacío = el envío se coordina después y no se cobra en Mercado Pago.');
  }
  const faltan = ['MP_ACCESS_TOKEN', 'GOOGLE_CLIENT_ID', 'SITE_URL'].filter(k => !prop_(k));
  Logger.log(faltan.length ? 'Hojas listas. Faltan estas propiedades: ' + faltan.join(', ') : 'Todo configurado ✔');
}

// Para revisar la configuración sin mostrar las claves
function revisarTienda() {
  const cat = armarCatalogo_(leerVariantes_());
  Logger.log('Productos con stock en la tienda: ' + cat.length);
  ['MP_ACCESS_TOKEN', 'GOOGLE_CLIENT_ID', 'SITE_URL'].forEach(k => Logger.log(k + ': ' + (prop_(k) ? 'cargado ✔' : 'FALTA ✘')));
  Logger.log('URL de esta app web: ' + urlWebApp_());
}

/* ===================== CATÁLOGO ===================== */

function leerVariantes_() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARMONY.HOJA);
  if (!hoja || hoja.getLastRow() < 2) return [];
  const datos = hoja.getDataRange().getValues();
  const enc = datos.shift();
  const i = n => enc.indexOf(n);
  return datos.map(f => ({
    clave: String(f[i('Clave')]),
    pid: String(f[i('ID Producto')]),
    producto: String(f[i('Producto')] || ''),
    categoria: String(f[i('Categoría')] || ''),
    color: String(f[i('Color')] || ''),
    talle: String(f[i('Talle')] || ''),
    tipo: i('Tipo venta') >= 0 && f[i('Tipo venta')] ? String(f[i('Tipo venta')]) : 'Unidad',
    precio: Number(f[i('Precio venta')]) || 0,
    stock: String(f[i('Stock')] || ''),
    imagen: String(f[i('Imagen principal')] || ''),
    imagenes: String(f[i('Todas las imágenes')] || ''),
    descripcion: String(f[i('Descripción')] || ''),
    link: String(f[i('Link')] || '')
  })).filter(v => v.clave && v.pid);
}

function armarCatalogo_(vars) {
  const prods = {}, orden = [];
  vars.forEach(v => {
    if (!v.precio) return;
    let p = prods[v.pid];
    if (!p) {
      p = prods[v.pid] = {
        id: v.pid,
        nombre: v.producto,
        categorias: v.categoria.split(',').map(s => s.trim()).filter(Boolean),
        descripcion: v.descripcion.slice(0, 1200),
        imagenes: [],
        variantes: []
      };
      orden.push(v.pid);
    }
    v.imagenes.split(',').map(s => s.trim()).filter(Boolean).concat(v.imagen ? [v.imagen] : [])
      .forEach(u => { if (p.imagenes.indexOf(u) < 0 && p.imagenes.length < 12) p.imagenes.push(u); });
    p.variantes.push({
      id: v.clave, color: v.color, talle: v.talle, tipo: v.tipo,
      precio: v.precio, stock: v.stock !== 'Agotado', imagen: v.imagen
    });
  });
  return orden.map(id => prods[id]).filter(p => p.variantes.some(v => v.stock));
}

function leerEnvios_() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TIENDA.HOJA_ENVIOS);
  if (!hoja || hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues()
    .filter(f => f[0])
    .map(f => ({
      zona: String(f[0]),
      provincias: String(f[1]).split(',').map(s => s.trim()).filter(Boolean),
      domicilio: f[2] === '' ? null : Number(f[2]),
      sucursal: f[3] === '' ? null : Number(f[3])
    }));
}

function catalogo_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('cat_n') || 0);
  if (n) {
    const claves = Array.from({ length: n }, (_, k) => 'cat_' + k);
    const partes = cache.getAll(claves);
    if (Object.keys(partes).length === n) return JSON.parse(claves.map(k => partes[k]).join(''));
  }
  const data = {
    tienda: TIENDA.NOMBRE,
    cuotas: TIENDA.CUOTAS_MAX,
    provincias: PROVINCIAS,
    envios: leerEnvios_(),
    productos: armarCatalogo_(leerVariantes_()),
    actualizado: new Date().toISOString()
  };
  const s = JSON.stringify(data), obj = {}, TAM = 40000;
  let k = 0;
  for (let i = 0; i < s.length; i += TAM) obj['cat_' + (k++)] = s.slice(i, i + TAM);
  obj.cat_n = String(k);
  try { cache.putAll(obj, TIENDA.CACHE_MIN * 60); } catch (_) {}
  return data;
}

function limpiarCacheCatalogo() {
  CacheService.getScriptCache().remove('cat_n');
}

/* ===================== PEDIDOS ===================== */

function crearPedido_(b) {
  const u = verificarUsuario_(b.idToken);
  const token = prop_('MP_ACCESS_TOKEN');
  if (!token) throw new Error('La tienda todavía no tiene Mercado Pago configurado.');
  const site = prop_('SITE_URL');
  if (!site) throw new Error('Falta configurar la dirección de la tienda (SITE_URL).');

  // 1) Precios y stock SIEMPRE desde la planilla (nunca desde el navegador)
  const pedidos = (Array.isArray(b.items) ? b.items : []).filter(x => x && x.id && Number(x.cantidad) > 0).slice(0, 40);
  if (!pedidos.length) throw new Error('Tu carrito está vacío.');
  const vars = {};
  leerVariantes_().forEach(v => { vars[v.clave] = v; });
  const lineas = pedidos.map(x => {
    const v = vars[String(x.id)];
    const det = v ? [v.tipo, v.color, v.talle].filter(Boolean).join(' · ') : '';
    if (!v || !v.precio) throw new Error('Un producto del carrito ya no está disponible. Quitalo y probá de nuevo.');
    if (v.stock === 'Agotado') throw new Error(`Se agotó: ${v.producto} (${det}). Quitalo del carrito.`);
    return {
      id: v.clave, nombre: v.producto, detalle: det,
      cantidad: Math.min(20, Math.max(1, Math.floor(Number(x.cantidad)))),
      precio: v.precio, imagen: v.imagen, link: v.link
    };
  });
  const subtotal = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);

  // 2) Datos de envío
  const e = b.envio || {};
  const txt = (s, max) => String(s || '').trim().slice(0, max || 120);
  const env = {
    nombre: txt(e.nombre), telefono: txt(e.telefono, 40), dni: txt(e.dni, 20),
    metodo: e.metodo === 'sucursal' ? 'sucursal' : 'domicilio',
    direccion: txt(e.direccion, 200), ciudad: txt(e.ciudad), provincia: txt(e.provincia, 60), cp: txt(e.cp, 12)
  };
  if (!env.nombre || !env.telefono || !env.provincia || !env.ciudad || !env.cp) throw new Error('Completá nombre, teléfono, provincia, ciudad y código postal.');
  if (PROVINCIAS.indexOf(env.provincia) < 0) throw new Error('Elegí una provincia de la lista.');
  if (env.metodo === 'domicilio' && !env.direccion) throw new Error('Completá la dirección de entrega.');
  const zona = leerEnvios_().find(z => z.provincias.indexOf(env.provincia) >= 0);
  const costoEnvio = zona && zona[env.metodo] != null ? zona[env.metodo] : null; // null = a coordinar
  const total = subtotal + (costoEnvio || 0);

  // 3) Guardar el pedido
  const id = nuevoIdPedido_();
  const resumen = lineas.map(l => `${l.cantidad}× ${l.nombre} (${l.detalle}) $${fmt_(l.precio)}`).join('\n');
  const fila = {
    'Pedido': id, 'Fecha': new Date(), 'Estado': 'Esperando pago', 'Email': u.email, 'Cliente': env.nombre,
    'Teléfono': env.telefono, 'DNI': env.dni,
    'Envío': 'Correo Argentino a ' + env.metodo + (costoEnvio == null ? ' (a coordinar)' : ''),
    'Dirección': env.direccion, 'Ciudad': env.ciudad, 'Provincia': env.provincia, 'CP': env.cp,
    'Productos': resumen, 'Subtotal': subtotal, 'Costo envío': costoEnvio == null ? '' : costoEnvio, 'Total': total,
    'Pago MP': '', 'Estado MP': '', 'Seguimiento': '', 'Notas': '', 'Items': JSON.stringify(lineas), 'Mail pago': ''
  };
  conLock_(() => hojaPedidos_().appendRow(COLUMNAS_PEDIDOS.map(c => fila[c] === undefined ? '' : fila[c])));

  // 4) Crear la orden de cobro en Mercado Pago (API de Orders, Checkout Pro)
  const volver = site + (site.indexOf('?') >= 0 ? '&' : '?') + 'pedido=' + encodeURIComponent(id);
  const monto = n => (Math.round(Number(n) * 100) / 100).toFixed(2);
  const items = lineas.map(l => ({
    title: `${l.nombre} – ${l.detalle}`.slice(0, 250), quantity: l.cantidad,
    unit_price: monto(l.precio), picture_url: l.imagen || undefined
  }));
  if (costoEnvio) items.push({ title: 'Envío por Correo Argentino', quantity: 1, unit_price: monto(costoEnvio) });
  const orden = {
    type: 'online',
    processing_mode: 'manual',            // único valor válido para Checkout Pro
    capture_mode: 'automatic_async',
    external_reference: id,
    description: `${TIENDA.NOMBRE} · Pedido ${id}`,
    total_amount: monto(total),
    expiration_time: 'P1D',               // el link de pago vence en 1 día
    payer: { email: u.email },
    items,
    config: { online: { success_url: volver, failure_url: volver, pending_url: volver, auto_return: 'approved' } }
  };

  const r = UrlFetchApp.fetch('https://api.mercadopago.com/v1/orders', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, 'X-Idempotency-Key': id, Accept: 'application/json' },
    payload: JSON.stringify(orden)
  });
  const res = (() => { try { return JSON.parse(r.getContentText()); } catch (_) { return {}; } })();
  if (r.getResponseCode() >= 300 || !res.checkout_url) {
    Logger.log('Mercado Pago respondió ' + r.getResponseCode() + ': ' + r.getContentText());
    actualizarFila_(id, { 'Estado': 'Cancelado', 'Notas': 'Error al crear el cobro en Mercado Pago' });
    throw new Error('Mercado Pago no respondió. Probá de nuevo en unos minutos.');
  }
  actualizarFila_(id, { 'Pago MP': res.id, 'Estado MP': res.status || 'created' });
  return { ok: true, pedido: id, total, envioACoordinar: costoEnvio == null, url: res.checkout_url };
}

function estadoPedido_(id) {
  if (!id) throw new Error('Falta el número de pedido.');
  let f = buscarPedido_(id);
  if (!f) throw new Error('No encontramos ese pedido.');
  const ordenId = String(f.datos['Pago MP'] || '');
  if (/^ORD/i.test(ordenId)) {
    const orden = obtenerOrdenMP_(ordenId);
    if (orden && orden.external_reference === id) { actualizarPedidoConOrden_(orden); f = buscarPedido_(id); }
  }
  return { pedido: id, estado: f.datos['Estado'], total: f.datos['Total'], envio: f.datos['Envío'] };
}

function misPedidos_(b) {
  const u = verificarUsuario_(b.idToken);
  return { pedidos: leerPedidos_().filter(p => p['Email'] === u.email).reverse().slice(0, 50).map(p => ({
    pedido: p['Pedido'], fecha: p['Fecha'], estado: p['Estado'], total: p['Total'],
    productos: p['Productos'], envio: p['Envío'], seguimiento: p['Seguimiento']
  })) };
}

/* ===================== MERCADO PAGO ===================== */

function procesarNotificacionMP_(id, tipo) {
  if (!id) return;
  const t = String(tipo || '');
  if (/order/i.test(t) || /^ORD/i.test(String(id))) {       // aviso de una orden (API de Orders)
    const orden = obtenerOrdenMP_(id);
    if (orden) actualizarPedidoConOrden_(orden);
    return;
  }
  if (/^\d+$/.test(String(id)) && (!t || /payment/i.test(t))) { // aviso de un pago suelto
    const pago = obtenerPagoMP_(id);
    if (pago) actualizarPedidoConPago_(pago);
  }
}

function obtenerOrdenMP_(id) {
  const token = prop_('MP_ACCESS_TOKEN');
  if (!token || !/^[A-Za-z0-9_-]+$/.test(String(id))) return null;
  const r = UrlFetchApp.fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true
  });
  return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
}

// Traduce la orden de Mercado Pago al formato de pago que ya entiende la tienda
function actualizarPedidoConOrden_(orden) {
  const st = String(orden.status || ''), det = String(orden.status_detail || '');
  let status;
  if (st === 'processed') status = 'approved';
  else if (st === 'failed') status = 'rejected';
  else if (st === 'canceled' || st === 'expired') status = 'cancelled';
  else if (st === 'refunded') status = 'refunded';
  else if (st === 'processing' || st === 'action_required') status = 'in_process';
  else return; // "created": todavía no pagó
  const pagos = (orden.transactions && orden.transactions.payments) || [];
  actualizarPedidoConPago_({
    id: orden.id,
    status,
    status_detail: det,
    external_reference: orden.external_reference,
    currency_id: 'ARS',
    transaction_amount: Number(orden.total_paid_amount || (status === 'approved' ? orden.total_amount : 0)),
    _pagos: pagos.map(p => p.id).join(',')
  });
}

function obtenerPagoMP_(id) {
  const token = prop_('MP_ACCESS_TOKEN');
  if (!token) return null;
  const r = UrlFetchApp.fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
}

function actualizarPedidoConPago_(pago) {
  const ref = pago.external_reference;
  if (!ref) return;
  let mandarMail = false, datos = null;
  conLock_(() => {
    const f = buscarPedido_(ref);
    if (!f) return;
    datos = f.datos;
    const antes = datos['Estado'];
    let estado = antes;
    const previos = ['Esperando pago', 'Pago pendiente', 'Pago rechazado', 'Revisar pago'];
    if (previos.indexOf(antes) >= 0) {
      if (pago.status === 'approved') {
        const montoOk = pago.currency_id === 'ARS' && Number(pago.transaction_amount) >= Number(datos['Total']) - 1;
        estado = montoOk ? 'Pagado' : 'Revisar pago';
      } else if (pago.status === 'pending' || pago.status === 'in_process' || pago.status === 'authorized') {
        estado = 'Pago pendiente';
      } else if (pago.status === 'rejected' || pago.status === 'cancelled') {
        estado = 'Pago rechazado';
      }
    }
    if (pago.status === 'refunded' || pago.status === 'charged_back') estado = 'Cancelado';
    const cambios = { 'Estado': estado, 'Pago MP': String(pago.id), 'Estado MP': pago.status + (pago.status_detail ? ' / ' + pago.status_detail : '') };
    if (estado === 'Pagado' && !datos['Mail pago']) { cambios['Mail pago'] = new Date(); mandarMail = true; }
    escribirCambios_(f.hoja, f.fila, cambios);
    Object.assign(datos, cambios);
  });
  if (mandarMail && datos) {
    try { mailPagoCliente_(datos); } catch (e) { Logger.log('Mail cliente: ' + e); }
    try { mailVentaAdmin_(datos); } catch (e) { Logger.log('Mail admin: ' + e); }
  }
}

/* ===================== PANEL DE ADMINISTRADORA ===================== */

function admin_(b) {
  const u = verificarUsuario_(b.idToken);
  const admins = TIENDA.ADMINS.concat(prop_('ADMINS').split(',')).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (admins.indexOf(u.email) < 0) throw new Error('Esta cuenta no es administradora.');

  if (b.op === 'pedidos') {
    return { estados: ESTADOS, pedidos: leerPedidos_().reverse().slice(0, 400).map(p => {
      let items = [];
      try { items = JSON.parse(p['Items'] || '[]'); } catch (_) {}
      return {
        pedido: p['Pedido'], fecha: p['Fecha'], estado: p['Estado'], email: p['Email'], cliente: p['Cliente'],
        telefono: p['Teléfono'], dni: p['DNI'], envio: p['Envío'], direccion: p['Dirección'], ciudad: p['Ciudad'],
        provincia: p['Provincia'], cp: p['CP'], subtotal: p['Subtotal'], costoEnvio: p['Costo envío'], total: p['Total'],
        pagoMP: p['Pago MP'], estadoMP: p['Estado MP'], seguimiento: p['Seguimiento'], notas: p['Notas'], items
      };
    }) };
  }

  if (b.op === 'actualizar') {
    const id = String(b.pedido || '');
    let datos = null, avisarEnvio = false;
    conLock_(() => {
      const f = buscarPedido_(id);
      if (!f) throw new Error('No encontré el pedido ' + id);
      const cambios = {};
      if (b.estado && ESTADOS.indexOf(b.estado) >= 0) cambios['Estado'] = b.estado;
      if (b.seguimiento !== undefined) cambios['Seguimiento'] = String(b.seguimiento).trim().slice(0, 60);
      if (b.notas !== undefined) cambios['Notas'] = String(b.notas).slice(0, 500);
      avisarEnvio = cambios['Estado'] === 'Enviado' && f.datos['Estado'] !== 'Enviado';
      escribirCambios_(f.hoja, f.fila, cambios);
      datos = Object.assign(f.datos, cambios);
    });
    if (avisarEnvio) { try { mailEnvio_(datos); } catch (e) { Logger.log('Mail envío: ' + e); } }
    return { ok: true, avisoEnviado: avisarEnvio };
  }

  throw new Error('Operación desconocida.');
}

/* ===================== MAILS ===================== */

function mailPagoCliente_(d) {
  const items = itemsDe_(d);
  MailApp.sendEmail({
    to: d['Email'], name: TIENDA.NOMBRE,
    subject: `${TIENDA.NOMBRE} · Recibimos tu pago (pedido ${d['Pedido']})`,
    htmlBody: plantillaMail_(`¡Gracias, ${esc_(String(d['Cliente']).split(' ')[0])}!`,
      `<p>Tu pago fue aprobado. Ya estamos preparando tu pedido <b>${esc_(d['Pedido'])}</b>.</p>` +
      tablaItems_(items, d) +
      `<p><b>Envío:</b> ${esc_(d['Envío'])}<br>${esc_([d['Dirección'], d['Ciudad'], d['Provincia'], d['CP']].filter(Boolean).join(', '))}</p>` +
      `<p>Cuando lo despachemos te mandamos el número de seguimiento de Correo Argentino.</p>`)
  });
}

function mailVentaAdmin_(d) {
  const items = itemsDe_(d);
  const compra = items.map(l => `<li>${l.cantidad}× ${esc_(l.nombre)} – ${esc_(l.detalle)} · <a href="${esc_(l.link)}">ver en Armony</a></li>`).join('');
  MailApp.sendEmail({
    to: TIENDA.ADMINS.join(','), name: TIENDA.NOMBRE + ' (tienda)',
    subject: `🛍️ Nueva venta ${d['Pedido']} · $${fmt_(d['Total'])}`,
    htmlBody: plantillaMail_('Nueva venta pagada',
      `<p><b>${esc_(d['Cliente'])}</b> · ${esc_(d['Email'])} · ${esc_(d['Teléfono'])} · DNI ${esc_(d['DNI'])}</p>` +
      tablaItems_(items, d) +
      `<p><b>Comprar a Armony:</b></p><ul>${compra}</ul>` +
      `<p><b>Envío:</b> ${esc_(d['Envío'])}<br>${esc_([d['Dirección'], d['Ciudad'], d['Provincia'], d['CP']].filter(Boolean).join(', '))}</p>` +
      `<p>Pago Mercado Pago n° ${esc_(d['Pago MP'])}</p>`)
  });
}

function mailEnvio_(d) {
  const seg = d['Seguimiento'] ? `<p>Número de seguimiento de Correo Argentino: <b>${esc_(d['Seguimiento'])}</b><br>Podés seguirlo en <a href="https://www.correoargentino.com.ar">correoargentino.com.ar</a>.</p>` : '';
  MailApp.sendEmail({
    to: d['Email'], name: TIENDA.NOMBRE,
    subject: `${TIENDA.NOMBRE} · Tu pedido ${d['Pedido']} está en camino`,
    htmlBody: plantillaMail_('¡Tu pedido salió!', `<p>Despachamos tu pedido <b>${esc_(d['Pedido'])}</b> por Correo Argentino.</p>${seg}<p>Gracias por comprar en ${TIENDA.NOMBRE}.</p>`)
  });
}

function plantillaMail_(titulo, cuerpo) {
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#2B1420">
    <div style="font-size:34px;font-style:italic;color:#7A1F3D;padding:16px 0;border-bottom:2px solid #F3D9DC">${TIENDA.NOMBRE}<span style="font:600 11px Arial,sans-serif;letter-spacing:2px;color:#76606A;vertical-align:4px;margin-left:6px">NFM</span></div>
    <h2 style="font-weight:normal">${titulo}</h2>
    <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${cuerpo}</div></div>`;
}

function tablaItems_(items, d) {
  const filas = items.map(l => `<tr><td style="padding:6px 0">${l.cantidad}× ${esc_(l.nombre)}<br><small style="color:#7a6670">${esc_(l.detalle)}</small></td><td align="right">$${fmt_(l.precio * l.cantidad)}</td></tr>`).join('');
  const envio = d['Costo envío'] === '' ? 'A coordinar' : '$' + fmt_(d['Costo envío']);
  return `<table width="100%" style="border-collapse:collapse;font-size:14px">${filas}
    <tr><td style="border-top:1px solid #eee;padding-top:6px">Envío</td><td align="right" style="border-top:1px solid #eee">${envio}</td></tr>
    <tr><td><b>Total</b></td><td align="right"><b>$${fmt_(d['Total'])}</b></td></tr></table>`;
}

function itemsDe_(d) {
  try { return JSON.parse(d['Items'] || '[]'); } catch (_) { return []; }
}

/* ===================== AYUDANTES ===================== */

function verificarUsuario_(idToken) {
  if (!idToken) throw new Error('Iniciá sesión con Google para continuar.');
  const cid = prop_('GOOGLE_CLIENT_ID');
  if (!cid) throw new Error('La tienda todavía no tiene el inicio de sesión configurado.');
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Tu sesión venció. Volvé a iniciar sesión.');
  const t = JSON.parse(r.getContentText());
  if (t.aud !== cid) throw new Error('Sesión no válida. Volvé a iniciar sesión.');
  if (String(t.email_verified) !== 'true') throw new Error('Tu cuenta de Google no tiene el email verificado.');
  return { email: String(t.email).toLowerCase(), nombre: t.name || '' };
}

function hojaPedidos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(TIENDA.HOJA_PEDIDOS);
  if (!h) { instalarTienda(); h = ss.getSheetByName(TIENDA.HOJA_PEDIDOS); }
  return h;
}

function leerPedidos_() {
  const h = hojaPedidos_();
  if (h.getLastRow() < 2) return [];
  const datos = h.getDataRange().getValues();
  const enc = datos.shift();
  return datos.filter(f => f[0]).map(f => {
    const o = {};
    enc.forEach((c, k) => { o[c] = f[k] instanceof Date ? f[k].toISOString() : f[k]; });
    return o;
  });
}

function buscarPedido_(id) {
  const h = hojaPedidos_();
  const celda = h.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!celda) return null;
  const fila = celda.getRow();
  const enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  const valores = h.getRange(fila, 1, 1, enc.length).getValues()[0];
  const datos = {};
  enc.forEach((c, k) => { datos[c] = valores[k]; });
  return { hoja: h, fila, datos };
}

function escribirCambios_(h, fila, cambios) {
  const enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  Object.keys(cambios).forEach(c => {
    const col = enc.indexOf(c);
    if (col >= 0) h.getRange(fila, col + 1).setValue(cambios[c]);
  });
}

function actualizarFila_(id, cambios) {
  conLock_(() => { const f = buscarPedido_(id); if (f) escribirCambios_(f.hoja, f.fila, cambios); });
}

function conLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function nuevoIdPedido_() {
  const fecha = Utilities.formatDate(new Date(), TIENDA.ZONA_HORARIA, 'yyMMdd');
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 4; i++) r += letras[Math.floor(Math.random() * letras.length)];
  return `CQ${fecha}-${r}`;
}

function urlWebApp_() {
  return prop_('WEBAPP_URL') || ScriptApp.getService().getUrl();
}

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k) || '';
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function mensaje_(err) {
  return String((err && err.message) || err);
}

function fmt_(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
