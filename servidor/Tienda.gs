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
  MINIMO_COMPRA: 100000,   // compra mínima en productos (sin envío)
  CACHE_MIN: 10,           // minutos que se guarda el catálogo en memoria
  ZONA_HORARIA: 'America/Argentina/Buenos_Aires',
  HOJA_CARRITOS: 'Carritos',
  HOJA_PUBLICACION: 'Publicación',
  // Punto de encuentro (entrega en mano, gratis). Solo para CABA y GBA.
  ENCUENTRO_DIA: 'sábados', ENCUENTRO_HORA: '12:00 hs',
  ENCUENTRO_LUGAR: '',              // vacío = "te confirmamos el lugar por mail"
  ENCUENTRO_PROVINCIAS: ['CABA', 'Buenos Aires (GBA)'],
  HOJA_FOTOS: 'Fotos',              // fotos propias de Luz por producto (reemplazan a las de Armony)
  CARPETA_FOTOS: 'Coquette – Fotos', // carpeta de Google Drive donde se guardan // qué productos se ven en la tienda (Publicado / Pendiente / Oculto)
  CONTACTO: 'hola.novafamilymarket@gmail.com', // las clientas responden los mails a esta dirección
  DESCUENTO_CODIGO: 'HOLA10',   // código de primera compra (vacío = sin descuento)
  DESCUENTO_PORC: 10,           // % de descuento sobre los productos
  AVISO_CARRITO_HORAS: 24       // horas sin comprar antes de mandar el recordatorio
};

const COLUMNAS_PUBLICACION = ['ID Producto', 'Producto', 'Estado', 'Avisos', 'Link Armony', 'Detectado', 'Decidido'];
const COLUMNAS_FOTOS = ['ID Producto', 'Producto', 'Mis fotos', 'Fotos Armony al subir', 'Cambio en Armony', 'Actualizado', 'Selección'];
const COLUMNAS_CARRITOS = ['Email', 'Nombre', 'Items', 'Total', 'Actualizado', 'Avisado'];
const ESTADOS_COMPRADOS = ['Pagado', 'Preparando', 'Enviado', 'Entregado'];

const COLUMNAS_PEDIDOS = [
  'Pedido', 'Fecha', 'Estado', 'Email', 'Cliente', 'Teléfono', 'DNI', 'Envío', 'Dirección',
  'Ciudad', 'Provincia', 'CP', 'Productos', 'Subtotal', 'Costo envío', 'Total',
  'Pago MP', 'Estado MP', 'Seguimiento', 'Notas', 'Items', 'Mail pago', 'Código entrega'
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
      case 'guardarCarrito': return json_(guardarCarrito_(body));
      case 'miCarrito': return json_(miCarrito_(body));
      case 'validarCodigo': return json_(validarCodigo_(body));
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
    link: String(f[i('Link')] || ''),
    costo: (Number(f[i('Costo')]) || 0) * (esPromo3_(f[i('Otras opciones')]) && String(f[i('Tipo venta')]) === 'Pack x6' ? 2 : 1),
    otras: String(f[i('Otras opciones')] || ''),
    dosPromos: esPromo3_(f[i('Otras opciones')]) && String(f[i('Tipo venta')]) === 'Pack x6',
    aviso: i('Aviso') >= 0 ? String(f[i('Aviso')] || '') : '',
    imagenesWeb: i('Imágenes web') >= 0 ? String(f[i('Imágenes web')] || '') : ''
  })).filter(v => v.clave && v.pid);
}

// "Promo x3" de Armony que la tienda vende como Pack x6 (hay que comprar 2 promos)
function esPromo3_(otras) { return /promo\s*x?\s*3|x\s*3\b/i.test(String(otras || '')); }

function armarCatalogo_(vars) {
  const prods = {}, orden = [], webDe = {}, origDe = {};
  vars.forEach(v => {
    // fotos de Armony del producto (aunque la variante no tenga precio), para la selección de fotos
    const o = v.imagenes.split(',').map(s => s.trim()).filter(Boolean), w = v.imagenesWeb ? v.imagenesWeb.split(',').map(s => s.trim()) : [];
    o.forEach((u, k) => { webDe[u] = w[k] || webDe[u] || u; (origDe[v.pid] = origDe[v.pid] || {})[u] = 1; });
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
    const orig = v.imagenes.split(',').map(s => s.trim()).filter(Boolean);
    const web = v.imagenesWeb ? v.imagenesWeb.split(',').map(s => s.trim()) : [];
    const liviana = u => { const k = orig.indexOf(u); return k >= 0 && web[k] ? web[k] : u; };
    orig.map(liviana).concat(v.imagen ? [liviana(v.imagen)] : [])
      .forEach(u => { if (u && p.imagenes.indexOf(u) < 0 && p.imagenes.length < 20) p.imagenes.push(u); });
    v.imagenLiviana = v.imagen ? liviana(v.imagen) : '';
    p.variantes.push({
      id: v.clave, color: v.color, talle: v.talle, tipo: v.tipo,
      precio: v.precio, stock: v.stock !== 'Agotado', imagen: v.imagenLiviana || v.imagen
    });
  });
  const estados = estadosPublicacion_();
  const mias = misFotosTodas_();
  orden.forEach(id => {
    const f = mias[id];
    if (!f) return;
    // 1) Si Luz eligió fotos (de Armony y/o propias), se publican esas en ese orden
    const elegidas = (f.seleccion || []).map(r => {
      if (/^drive:/.test(r)) { const d = r.slice(6); return f.fotos.some(x => x.id === d) ? urlDrive_(d, 'w900') : ''; }
      return origDe[id] && origDe[id][r] ? webDe[r] : ''; // si Armony la sacó, no se muestra
    }).filter(Boolean);
    // 2) Si no eligió pero subió propias, se ven solo las propias
    const lista = elegidas.length ? elegidas : f.fotos.map(x => urlDrive_(x.id, 'w900'));
    if (lista.length) {
      prods[id].imagenes = lista;
      prods[id].variantes.forEach(v => { if (lista.indexOf(v.imagen) < 0) v.imagen = ''; }); // foto por color solo si está publicada
    }
  });
  return orden.map(id => prods[id]).filter(p => p.variantes.some(v => v.stock) && (!estados || estados[p.id] === 'Publicado'));
}

/* ===================== PUBLICACIÓN (aprobación de Luz) ===================== */

// null = todavía no existe la hoja (se muestra todo, como antes)
function estadosPublicacion_() {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TIENDA.HOJA_PUBLICACION);
  if (!h || h.getLastRow() < 2) return null;
  const m = {};
  h.getRange(2, 1, h.getLastRow() - 1, 3).getValues().forEach(f => { if (f[0] !== '') m[String(f[0])] = String(f[2]); });
  return m;
}

// Lo llama la sincronización de Armony: agrega los productos nuevos como "Pendiente" y actualiza los avisos
function registrarPublicaciones_(filas) {
  const C = COLUMNAS_ARMONY, c = n => C.indexOf(n);
  const prods = {}, orden = [];
  filas.forEach(f => {
    const id = String(f[c('ID Producto')]);
    if (!prods[id]) { prods[id] = { nombre: f[c('Producto')], link: f[c('Link')], avisos: [] }; orden.push(id); }
    const av = f[c('Aviso')];
    if (av) prods[id].avisos.push(`${[f[c('Color')], f[c('Talle')], f[c('Otras opciones')]].filter(Boolean).join(' / ')}: ${av}`);
  });
  conLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let h = ss.getSheetByName(TIENDA.HOJA_PUBLICACION);
    const primeraVez = !h;
    if (!h) {
      h = ss.insertSheet(TIENDA.HOJA_PUBLICACION);
      h.getRange(1, 1, 1, COLUMNAS_PUBLICACION.length).setValues([COLUMNAS_PUBLICACION]).setFontWeight('bold');
      h.setFrozenRows(1);
    }
    const n = h.getLastRow() - 1;
    const datos = n > 0 ? h.getRange(2, 1, n, COLUMNAS_PUBLICACION.length).getValues() : [];
    const fila = {};
    datos.forEach((f, i) => { fila[String(f[0])] = i; });
    const ahora = new Date();
    orden.forEach(id => {
      const p = prods[id], avisos = p.avisos.slice(0, 20).join('\n').slice(0, 2000);
      if (fila[id] !== undefined) {
        const f = datos[fila[id]];
        f[1] = p.nombre; f[3] = avisos; f[4] = p.link;
      } else {
        // La primera vez, lo que ya estaba a la venta queda publicado; lo que aparece después espera aprobación
        datos.push([id, p.nombre, primeraVez ? 'Publicado' : 'Pendiente', avisos, p.link, ahora, primeraVez ? ahora : '']);
      }
    });
    if (datos.length) h.getRange(2, 1, datos.length, COLUMNAS_PUBLICACION.length).setValues(datos);
  });
  try { revisarCambiosFotos_(filas); } catch (e) { Logger.log('Fotos: ' + e); }
  limpiarCacheCatalogo();
}

/* ===================== FOTOS PROPIAS ===================== */

function hojaFotos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(TIENDA.HOJA_FOTOS);
  if (!h) {
    h = ss.insertSheet(TIENDA.HOJA_FOTOS);
    h.setFrozenRows(1);
  }
  h.getRange(1, 1, 1, COLUMNAS_FOTOS.length).setValues([COLUMNAS_FOTOS]).setFontWeight('bold');
  return h;
}
// Selección de fotos a publicar (de Armony y propias), en orden. Cada foto: URL original de Armony o "drive:ID"
function guardarSeleccion_(pid, nombre, sel, actual) {
  const h = hojaFotos_();
  const m = misFotosTodas_()[pid];
  if (m) {
    h.getRange(m.fila, 7).setValue(JSON.stringify(sel));
    if (!m.armony.length) h.getRange(m.fila, 4).setValue(JSON.stringify(actual)); // para avisar si Armony cambia
  } else h.appendRow([pid, nombre, '[]', JSON.stringify(actual), '', new Date(), JSON.stringify(sel)]);
  limpiarCacheCatalogo();
}
const leerJson_ = (s, d) => { try { return JSON.parse(s || ''); } catch (_) { return d; } };
// { pid: { fila, fotos:[{id,url}], armony:[urls], cambio:'' | fecha ISO } }
function misFotosTodas_() {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TIENDA.HOJA_FOTOS);
  const m = {};
  if (!h || h.getLastRow() < 2) return m;
  const ancho = Math.max(COLUMNAS_FOTOS.length, h.getLastColumn());
  h.getRange(2, 1, h.getLastRow() - 1, ancho).getValues().forEach((f, i) => {
    if (f[0] === '') return;
    m[String(f[0])] = { fila: i + 2, fotos: leerJson_(f[2], []), armony: leerJson_(f[3], []),
      cambio: f[4] instanceof Date ? f[4].toISOString() : String(f[4] || ''), seleccion: leerJson_(f[6], []) };
  });
  return m;
}
// Fotos actuales de Armony de un producto (toda la galería, sin repetir)
function fotosArmony_(pid, vars) {
  const fotos = [];
  (vars || leerVariantes_()).filter(v => v.pid === String(pid)).forEach(v => {
    v.imagenes.split(',').map(x => x.trim()).concat(v.imagen ? [v.imagen] : []).forEach(u => { if (u && fotos.indexOf(u) < 0) fotos.push(u); });
  });
  return fotos;
}
// Foto de Drive en el tamaño pedido: 'w900' para la web, 'w300' miniatura, 's0' original
const urlDrive_ = (id, tam) => 'https://lh3.googleusercontent.com/d/' + id + '=' + (tam || 'w900');
const mismasFotos_ = (a, b) => a.slice().sort().join('|') === b.slice().sort().join('|');

function carpetaFotos_() {
  const id = prop_('FOTOS_CARPETA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (_) {} }
  const c = DriveApp.createFolder(TIENDA.CARPETA_FOTOS);
  PropertiesService.getScriptProperties().setProperty('FOTOS_CARPETA', c.getId());
  return c;
}
// Ejecutar UNA vez desde el editor para dar permiso a Google Drive y crear la carpeta
function instalarFotos() {
  const c = carpetaFotos_();
  hojaFotos_();
  Logger.log('Carpeta de fotos lista ✔ ' + c.getUrl());
}

function guardarMisFotos_(pid, nombre, fotos, armony) {
  const h = hojaFotos_();
  const m = misFotosTodas_()[pid];
  const sel = m ? (m.seleccion || []).filter(r => !/^drive:/.test(r) || fotos.some(x => 'drive:' + x.id === r)) : [];
  const fila = [pid, nombre, JSON.stringify(fotos), JSON.stringify(armony), '', new Date(), JSON.stringify(sel)];
  if (m) {
    // mantiene la marca de "cambió" salvo que se pase armony nuevo (= revisado)
    if (armony === null) { fila[3] = JSON.stringify(m.armony); fila[4] = m.cambio ? new Date(m.cambio) : ''; }
    h.getRange(m.fila, 1, 1, fila.length).setValues([fila]);
  } else {
    if (armony === null) fila[3] = '[]';
    h.appendRow(fila);
  }
  limpiarCacheCatalogo();
}

function adminFotos_(b) {
  const pid = String(b.pid || '');
  if (!pid) throw new Error('Falta el producto.');
  const vars = leerVariantes_();
  const v0 = vars.find(v => v.pid === pid);
  if (!v0) throw new Error('No encontré ese producto.');
  const actual = fotosArmony_(pid, vars);
  const m = misFotosTodas_()[pid] || { fotos: [], armony: [], cambio: '' };

  if (b.op === 'fotos') {
    const webDe = {};
    vars.filter(v => v.pid === pid).forEach(v => { const o = v.imagenes.split(',').map(x => x.trim()), w = v.imagenesWeb.split(',').map(x => x.trim()); o.forEach((u, k) => { if (w[k]) webDe[u] = w[k]; }); });
    return { pid, nombre: v0.producto, link: v0.link, armony: actual, armonyWeb: actual.map(u => webDe[u] || u),
      mias: m.fotos.map(x => ({ id: x.id, url: urlDrive_(x.id, 's0'), mini: urlDrive_(x.id, 'w300') })),
      cambio: m.cambio, armonyAntes: m.cambio ? m.armony : [],
      seleccion: (m.seleccion || []).filter(r => /^drive:/.test(r) ? m.fotos.some(x => 'drive:' + x.id === r) : actual.indexOf(r) >= 0) };
  }
  if (b.op === 'subirFoto') {
    const datos = String(b.datos || '').replace(/^data:image\/\w+;base64,/, '');
    if (!datos || datos.length > 14e6) throw new Error('La foto no es válida o es muy pesada.');
    if ((m.fotos || []).length >= 15) throw new Error('Máximo 15 fotos por producto.');
    const blob = Utilities.newBlob(Utilities.base64Decode(datos), 'image/jpeg',
      `${v0.producto.replace(/[^\w áéíóúñ-]/gi, '').slice(0, 40)} ${Date.now()}.jpg`);
    const f = carpetaFotos_().createFile(blob);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const foto = { id: f.getId(), url: urlDrive_(f.getId(), 's0') };
    let lista;
    conLock_(() => {
      const ahora = misFotosTodas_()[pid] || { fotos: [] };
      lista = (ahora.fotos || []).concat([foto]);
      // la primera foto propia "congela" cómo estaban las de Armony, para avisar si cambian
      guardarMisFotos_(pid, v0.producto, lista, ahora.fotos && ahora.fotos.length ? null : actual);
    });
    return { ok: true, foto, mias: lista.map(x => ({ id: x.id, url: urlDrive_(x.id, 's0'), mini: urlDrive_(x.id, 'w300') })) };
  }
  if (b.op === 'ordenarFotos') {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String);
    const quedan = ids.map(id => m.fotos.find(x => x.id === id)).filter(Boolean);
    m.fotos.filter(x => ids.indexOf(x.id) < 0).forEach(x => { try { DriveApp.getFileById(x.id).setTrashed(true); } catch (_) {} });
    conLock_(() => guardarMisFotos_(pid, v0.producto, quedan, null));
    return { ok: true, mias: quedan.map(x => ({ id: x.id, url: urlDrive_(x.id, 's0'), mini: urlDrive_(x.id, 'w300') })) };
  }
  if (b.op === 'zipFotos') {
    const cuales = b.mias ? m.fotos.map(x => urlDrive_(x.id, 's0')) : actual;
    if (!cuales.length) throw new Error('No hay fotos para descargar.');
    const rs = UrlFetchApp.fetchAll(cuales.map(u => ({ url: u, muteHttpExceptions: true, followRedirects: true })));
    const base = v0.producto.replace(/[^\w áéíóúñ-]/gi, '').trim().slice(0, 40) || 'producto';
    const blobs = rs.map((r, k) => r.getResponseCode() === 200 ? r.getBlob().setName(`${base} ${k + 1}.jpg`) : null).filter(Boolean);
    if (!blobs.length) throw new Error('No pude bajar las fotos. Probá de nuevo.');
    const zip = Utilities.zip(blobs, `${base} - ${b.mias ? 'mis fotos' : 'Armony'}.zip`);
    const f = carpetaFotos_().createFile(zip);
    return { ok: true, url: 'https://drive.google.com/uc?export=download&id=' + f.getId(), cantidad: blobs.length };
  }
  if (b.op === 'seleccion') {
    const sel = (Array.isArray(b.sel) ? b.sel : []).map(String).filter(r => /^drive:/.test(r) ? m.fotos.some(x => 'drive:' + x.id === r) : actual.indexOf(r) >= 0).slice(0, 20);
    conLock_(() => guardarSeleccion_(pid, v0.producto, sel, actual));
    return { ok: true, seleccion: sel };
  }
  if (b.op === 'fotosRevisadas') {
    conLock_(() => guardarMisFotos_(pid, v0.producto, m.fotos, actual));
    return { ok: true };
  }
  throw new Error('Operación desconocida.');
}

// En cada sincronización: si Armony cambió las fotos de un producto con fotos propias, lo marca y avisa por mail
function revisarCambiosFotos_(filas) {
  const mias = misFotosTodas_();
  const pids = Object.keys(mias).filter(id => mias[id].fotos.length || (mias[id].seleccion || []).length);
  if (!pids.length) return;
  const C = COLUMNAS_ARMONY, c = n => C.indexOf(n);
  const actuales = {}, nombres = {}, links = {};
  filas.forEach(f => {
    const id = String(f[c('ID Producto')]);
    if (pids.indexOf(id) < 0) return;
    nombres[id] = f[c('Producto')]; links[id] = f[c('Link')];
    const a = actuales[id] = actuales[id] || [];
    String(f[c('Todas las imágenes')] || '').split(',').map(x => x.trim()).concat([f[c('Imagen principal')]])
      .forEach(u => { if (u && a.indexOf(u) < 0) a.push(u); });
  });
  const h = hojaFotos_(), avisar = [];
  pids.forEach(id => {
    const m = mias[id];
    if (!actuales[id] || m.cambio || !m.armony.length) return;
    if (!mismasFotos_(m.armony, actuales[id])) {
      h.getRange(m.fila, 5).setValue(new Date());
      const nuevas = actuales[id].filter(u => m.armony.indexOf(u) < 0).length;
      const sacadas = m.armony.filter(u => actuales[id].indexOf(u) < 0).length;
      avisar.push(`• ${nombres[id]}: ${nuevas} foto(s) nueva(s), ${sacadas} quitada(s)\n   ${links[id]}`);
    }
  });
  if (avisar.length && TIENDA.ADMINS.length) {
    MailApp.sendEmail(TIENDA.ADMINS.join(','), `📸 Coquette: Armony cambió las fotos de ${avisar.length} producto(s)`,
      `Estos productos tienen fotos tuyas y Armony cambió las originales. Fijate si querés generar nuevas (en tu panel → Publicaciones → 📸 Fotos cambiadas).\n\n${avisar.join('\n\n')}`);
  }
}

// Para el panel: todos los productos con su estado, precios, variantes y avisos
function listaPublicaciones_() {
  const estados = estadosPublicacion_() || {};
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TIENDA.HOJA_PUBLICACION);
  const extra = {};
  if (h && h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, COLUMNAS_PUBLICACION.length).getValues()
    .forEach(f => { extra[String(f[0])] = { detectado: f[5] instanceof Date ? f[5].toISOString() : '', decidido: f[6] instanceof Date ? f[6].toISOString() : '' }; });
  const prods = {}, orden = [];
  leerVariantes_().forEach(v => {
    let p = prods[v.pid];
    if (!p) {
      p = prods[v.pid] = { id: v.pid, nombre: v.producto, categoria: v.categoria, link: v.link, imagen: (v.imagenesWeb.split(',')[0] || '').trim() || v.imagen,
        estado: estados[v.pid] || 'Publicado', detectado: (extra[v.pid] || {}).detectado || '', variantes: 0, conStock: 0, tipos: {}, avisos: [] };
      orden.push(v.pid);
    }
    p.variantes++;
    if (v.stock !== 'Agotado') p.conStock++;
    if (v.aviso) p.avisos.push({ variante: [v.color, v.talle, v.otras].filter(Boolean).join(' / '), motivo: v.aviso, costo: v.costo });
    else if (v.precio) {
      const t = p.tipos[v.tipo] = p.tipos[v.tipo] || { min: Infinity, max: 0, costoMin: Infinity, costoMax: 0 };
      t.min = Math.min(t.min, v.precio); t.max = Math.max(t.max, v.precio);
      t.costoMin = Math.min(t.costoMin, v.costo); t.costoMax = Math.max(t.costoMax, v.costo);
    }
  });
  const mias = misFotosTodas_();
  orden.forEach(id => { const m = mias[id]; prods[id].misFotos = m ? m.fotos.length : 0; prods[id].elegidas = m ? (m.seleccion || []).length : 0; prods[id].fotosCambiaron = !!(m && m.cambio && (m.fotos.length || (m.seleccion || []).length)); if (m && m.fotos.length) prods[id].imagen = urlDrive_(m.fotos[0].id, 'w300'); });
  return orden.map(id => prods[id]);
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
    encuentro: { dia: TIENDA.ENCUENTRO_DIA, hora: TIENDA.ENCUENTRO_HORA, lugar: TIENDA.ENCUENTRO_LUGAR, provincias: TIENDA.ENCUENTRO_PROVINCIAS },
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
    const det = v ? [v.tipo + (v.dosPromos ? ' (comprar 2× Promo x3 a Armony)' : ''), v.color, v.talle].filter(Boolean).join(' · ') : '';
    if (!v || !v.precio) throw new Error('Un producto del carrito ya no está disponible. Quitalo y probá de nuevo.');
    if (v.stock === 'Agotado') throw new Error(`Se agotó: ${v.producto} (${det}). Quitalo del carrito.`);
    return {
      id: v.clave, nombre: v.producto, detalle: det,
      cantidad: Math.min(20, Math.max(1, Math.floor(Number(x.cantidad)))),
      precio: v.precio, imagen: v.imagen, link: v.link
    };
  });
  const bruto = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  if (bruto < TIENDA.MINIMO_COMPRA) throw new Error(`La compra mínima es de $${fmt_(TIENDA.MINIMO_COMPRA)}. Te faltan $${fmt_(TIENDA.MINIMO_COMPRA - bruto)}.`);

  // Código de primera compra: baja el precio de cada prenda (así Mercado Pago cobra el total con descuento)
  let notaDescuento = '';
  if (b.codigo) {
    codigoValido_(b.codigo, u.email); // tira error si no corresponde
    const f = 1 - TIENDA.DESCUENTO_PORC / 100;
    lineas.forEach(l => { l.precioLista = l.precio; l.precio = Math.round(l.precio * f * 100) / 100; });
    notaDescuento = `Código ${TIENDA.DESCUENTO_CODIGO} (${TIENDA.DESCUENTO_PORC}% off)`;
  }
  const subtotal = Math.round(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0) * 100) / 100;
  const descuento = Math.round((bruto - subtotal) * 100) / 100;

  // 2) Datos de envío
  const e = b.envio || {};
  const txt = (s, max) => String(s || '').trim().slice(0, max || 120);
  const env = {
    nombre: txt(e.nombre), telefono: txt(e.telefono, 40), dni: txt(e.dni, 20),
    metodo: ['sucursal', 'encuentro'].indexOf(e.metodo) >= 0 ? e.metodo : 'domicilio',
    direccion: txt(e.direccion, 200), ciudad: txt(e.ciudad), provincia: txt(e.provincia, 60), cp: txt(e.cp, 12)
  };
  if (!env.nombre || !env.telefono || !env.provincia || !env.ciudad || !env.cp) throw new Error('Completá nombre, teléfono, provincia, ciudad y código postal.');
  if (PROVINCIAS.indexOf(env.provincia) < 0) throw new Error('Elegí una provincia de la lista.');
  if (env.metodo === 'domicilio' && !env.direccion) throw new Error('Completá la dirección de entrega.');
  if (env.metodo === 'encuentro' && TIENDA.ENCUENTRO_PROVINCIAS.indexOf(env.provincia) < 0) throw new Error('El punto de encuentro es solo para CABA y GBA.');
  const zona = leerEnvios_().find(z => z.provincias.indexOf(env.provincia) >= 0);
  const costoEnvio = env.metodo === 'encuentro' ? 0 : (zona && zona[env.metodo] != null ? zona[env.metodo] : null); // null = a coordinar
  const total = subtotal + (costoEnvio || 0);

  // 3) Guardar el pedido
  const id = nuevoIdPedido_();
  const resumen = lineas.map(l => `${l.cantidad}× ${l.nombre} (${l.detalle}) $${fmt_(l.precio)}`).join('\n');
  const fila = {
    'Pedido': id, 'Fecha': new Date(), 'Estado': 'Esperando pago', 'Email': u.email, 'Cliente': env.nombre,
    'Teléfono': env.telefono, 'DNI': env.dni,
    'Envío': env.metodo === 'encuentro' ? `Punto de encuentro (${TIENDA.ENCUENTRO_DIA} ${TIENDA.ENCUENTRO_HORA})` : 'Correo Argentino a ' + env.metodo + (costoEnvio == null ? ' (a coordinar)' : ''),
    'Código entrega': env.metodo === 'encuentro' ? nuevoCodigoEntrega_() : '',
    'Dirección': env.direccion, 'Ciudad': env.ciudad, 'Provincia': env.provincia, 'CP': env.cp,
    'Productos': resumen, 'Subtotal': subtotal, 'Costo envío': costoEnvio == null ? '' : costoEnvio, 'Total': total,
    'Pago MP': '', 'Estado MP': '', 'Seguimiento': '', 'Notas': notaDescuento ? `${notaDescuento}: -$${fmt_(descuento)}` : '', 'Items': JSON.stringify(lineas), 'Mail pago': ''
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
  try { borrarCarrito_(u.email); } catch (_) {}
  return { ok: true, pedido: id, total, descuento, envioACoordinar: costoEnvio == null, url: res.checkout_url };
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
    productos: p['Productos'], envio: p['Envío'], seguimiento: p['Seguimiento'],
    items: itemsDe_(p).map(l => ({ id: l.id, cantidad: l.cantidad, nombre: l.nombre, detalle: l.detalle, imagen: l.imagen }))
  })) };
}

// Al iniciar sesión: devuelve el carrito guardado o, si no hay, el último pedido sin pagar (últimos 7 días)
function miCarrito_(b) {
  const u = verificarUsuario_(b.idToken);
  const h = hojaCarritos_();
  const f = filaCarrito_(h, u.email);
  if (f) {
    let items = [];
    try { items = JSON.parse(h.getRange(f, 3).getValue() || '[]'); } catch (_) {}
    if (items.length) return { items, origen: 'carrito' };
  }
  const limite = Date.now() - 7 * 24 * 3600e3;
  const p = leerPedidos_().filter(x => String(x['Email']).toLowerCase() === u.email && x['Estado'] === 'Esperando pago' && new Date(x['Fecha']).getTime() > limite).pop();
  return { items: p ? itemsDe_(p).map(l => ({ id: l.id, cantidad: l.cantidad })) : [], origen: p ? 'pedido' : '' };
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
        pagoMP: p['Pago MP'], estadoMP: p['Estado MP'], seguimiento: p['Seguimiento'], notas: p['Notas'], items,
        encuentro: !!p['Código entrega']
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

  if (b.op === 'publicaciones') return { productos: listaPublicaciones_() };

  // Punto de encuentro: Luz ingresa el código que le muestra la clienta
  if (b.op === 'buscarCodigo' || b.op === 'confirmarEntrega') {
    const cod = String(b.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cod.length !== 6) throw new Error('El código tiene 6 letras y números.');
    const p = leerPedidos_().find(x => String(x['Código entrega']).toUpperCase() === cod);
    if (!p) throw new Error('No hay ningún pedido con ese código. Revisalo con la clienta.');
    if (p['Estado'] === 'Entregado') throw new Error(`Ese pedido (${p['Pedido']}) ya fue entregado.`);
    if (['Pagado', 'Preparando'].indexOf(p['Estado']) < 0) throw new Error(`El pedido ${p['Pedido']} no está pagado (estado: ${p['Estado']}). No lo entregues.`);
    const resumen = { pedido: p['Pedido'], cliente: p['Cliente'], telefono: p['Teléfono'], total: p['Total'], estado: p['Estado'], items: itemsDe_(p) };
    if (b.op === 'buscarCodigo') return { ok: true, pedido: resumen };
    let datos;
    conLock_(() => {
      const f = buscarPedido_(p['Pedido']);
      const cambios = { 'Estado': 'Entregado', 'Notas': [f.datos['Notas'], `Entregado en punto de encuentro el ${Utilities.formatDate(new Date(), TIENDA.ZONA_HORARIA, 'dd/MM/yyyy HH:mm')} (código validado)`].filter(Boolean).join(' · ') };
      escribirCambios_(f.hoja, f.fila, cambios);
      datos = Object.assign(f.datos, cambios);
    });
    try { mailEntregaConfirmada_(datos); } catch (e) { Logger.log('Mail entrega: ' + e); }
    return { ok: true, pedido: resumen };
  }
  if (b.op === 'reenviarCodigo') {
    const f = buscarPedido_(String(b.pedido || ''));
    if (!f || !f.datos['Código entrega']) throw new Error('Ese pedido no es de punto de encuentro.');
    mailCodigoEntrega_(f.datos);
    return { ok: true };
  }
  if (['fotos', 'subirFoto', 'ordenarFotos', 'fotosRevisadas', 'zipFotos', 'seleccion'].indexOf(b.op) >= 0) return adminFotos_(b);

  if (b.op === 'publicar') {
    const id = String(b.pid || ''), estado = ['Publicado', 'Pendiente', 'Oculto'].indexOf(b.estado) >= 0 ? b.estado : '';
    if (!id || !estado) throw new Error('Faltan datos.');
    conLock_(() => {
      const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TIENDA.HOJA_PUBLICACION);
      if (!h || h.getLastRow() < 2) throw new Error('Todavía no hay productos registrados.');
      const ids = h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().map(f => String(f[0]));
      const i = ids.indexOf(id);
      if (i < 0) throw new Error('No encontré ese producto.');
      h.getRange(i + 2, 3).setValue(estado);
      h.getRange(i + 2, 7).setValue(new Date());
    });
    limpiarCacheCatalogo();
    return { ok: true };
  }

  throw new Error('Operación desconocida.');
}

/* ===================== MAILS ===================== */

function mailPagoCliente_(d) {
  const items = itemsDe_(d);
  MailApp.sendEmail({
    to: d['Email'], name: TIENDA.NOMBRE, replyTo: TIENDA.CONTACTO,
    subject: `${TIENDA.NOMBRE} · Recibimos tu pago (pedido ${d['Pedido']})`,
    htmlBody: plantillaMail_(`¡Gracias, ${esc_(String(d['Cliente']).split(' ')[0])}!`,
      `<p>Tu pago fue aprobado. Ya estamos preparando tu pedido <b>${esc_(d['Pedido'])}</b>.</p>` +
      tablaItems_(items, d) +
      (d['Código entrega']
        ? `<p><b>Entrega:</b> punto de encuentro, el <b>sábado ${proximoSabado_()}</b> a las ${TIENDA.ENCUENTRO_HORA} (${esc_(lugarEncuentro_())}).</p>
           <p>Tu código de entrega, <b>único y personal</b>. Mostralo cuando retires:</p>
           <p style="text-align:center;margin:18px 0"><span style="display:inline-block;padding:14px 26px;border-radius:14px;background:#FBEBED;color:#7A1F3D;font:700 30px/1 Arial,sans-serif;letter-spacing:6px">${esc_(d['Código entrega'])}</span></p>`
        : `<p><b>Envío:</b> ${esc_(d['Envío'])}<br>${esc_([d['Dirección'], d['Ciudad'], d['Provincia'], d['CP']].filter(Boolean).join(', '))}</p>` +
          `<p>Despachamos tus prendas dentro de los <b>7 días hábiles</b> de acreditado el pago. Cuando salga te mandamos el número de seguimiento de Correo Argentino.</p>`) +
      `<p>Si necesitás un cambio, tenés <b>5 días</b> desde que recibís el pedido.</p>`)
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
      (d['Notas'] ? `<p><b>Descuento:</b> ${esc_(d['Notas'])}</p>` : '') +
      `<p>Pago Mercado Pago n° ${esc_(d['Pago MP'])}</p>`)
  });
}

function mailEnvio_(d) {
  const seg = d['Seguimiento'] ? `<p>Número de seguimiento de Correo Argentino: <b>${esc_(d['Seguimiento'])}</b><br>Podés seguirlo en <a href="https://www.correoargentino.com.ar">correoargentino.com.ar</a>.</p>` : '';
  MailApp.sendEmail({
    to: d['Email'], name: TIENDA.NOMBRE, replyTo: TIENDA.CONTACTO,
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

/* ===================== DESCUENTO PRIMERA COMPRA ===================== */

function yaCompro_(email) {
  return leerPedidos_().some(p => String(p['Email']).toLowerCase() === email && ESTADOS_COMPRADOS.indexOf(p['Estado']) >= 0);
}

function codigoValido_(codigo, email) {
  const c = String(codigo || '').trim().toUpperCase();
  if (!TIENDA.DESCUENTO_CODIGO || c !== TIENDA.DESCUENTO_CODIGO.toUpperCase()) throw new Error('Ese código no existe.');
  if (yaCompro_(email)) throw new Error('Este código es solo para tu primera compra.');
  return true;
}

function validarCodigo_(b) {
  const u = verificarUsuario_(b.idToken);
  codigoValido_(b.codigo, u.email);
  return { ok: true, codigo: TIENDA.DESCUENTO_CODIGO, porcentaje: TIENDA.DESCUENTO_PORC };
}

/* ===================== CARRITOS ABANDONADOS ===================== */

function hojaCarritos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(TIENDA.HOJA_CARRITOS);
  if (!h) {
    h = ss.insertSheet(TIENDA.HOJA_CARRITOS);
    h.getRange(1, 1, 1, COLUMNAS_CARRITOS.length).setValues([COLUMNAS_CARRITOS]).setFontWeight('bold');
    h.setFrozenRows(1);
  }
  return h;
}

function filaCarrito_(h, email) {
  if (h.getLastRow() < 2) return 0;
  const emails = h.getRange(2, 1, h.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < emails.length; i++) if (String(emails[i][0]).toLowerCase() === email) return i + 2;
  return 0;
}

function borrarCarrito_(email) {
  conLock_(() => { const h = hojaCarritos_(); const f = filaCarrito_(h, email); if (f) h.deleteRow(f); });
}

// La tienda manda el carrito de la clienta (solo si inició sesión)
function guardarCarrito_(b) {
  const u = verificarUsuario_(b.idToken);
  const items = (Array.isArray(b.items) ? b.items : []).filter(x => x && x.id && Number(x.cantidad) > 0).slice(0, 40)
    .map(x => ({ id: String(x.id), cantidad: Math.min(20, Math.floor(Number(x.cantidad))) }));
  if (!items.length) { borrarCarrito_(u.email); return { ok: true }; }
  const vars = {};
  leerVariantes_().forEach(v => { vars[v.clave] = v; });
  const total = items.reduce((s, x) => s + (vars[x.id] ? vars[x.id].precio * x.cantidad : 0), 0);
  conLock_(() => {
    const h = hojaCarritos_();
    const f = filaCarrito_(h, u.email);
    const fila = [u.email, u.nombre, JSON.stringify(items), total, new Date(), ''];
    if (f) h.getRange(f, 1, 1, fila.length).setValues([fila]); else h.appendRow(fila);
  });
  return { ok: true };
}

// Ejecutar UNA vez: revisa cada hora los carritos y manda el recordatorio
function instalarAvisosCarrito() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'avisarCarritos').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('avisarCarritos').timeBased().everyHours(1).create();
  hojaCarritos_();
  Logger.log('Listo: los recordatorios de carrito se revisan cada hora ✔');
}

function avisarCarritos() {
  const h = hojaCarritos_();
  if (h.getLastRow() < 2) return;
  const datos = h.getRange(2, 1, h.getLastRow() - 1, COLUMNAS_CARRITOS.length).getValues();
  const ahora = Date.now(), espera = TIENDA.AVISO_CARRITO_HORAS * 3600e3, maximo = 7 * 24 * 3600e3;
  const vars = {};
  leerVariantes_().forEach(v => { vars[v.clave] = v; });
  const site = prop_('SITE_URL');
  let enviados = 0;
  datos.forEach((f, i) => {
    const [email, nombre, itemsTxt, , actualizado, avisado] = f;
    const t = actualizado instanceof Date ? actualizado.getTime() : 0;
    if (!email || avisado || !t || ahora - t < espera || ahora - t > maximo) return;
    if (enviados >= 20 || MailApp.getRemainingDailyQuota() < 5) return;
    let items = [];
    try { items = JSON.parse(itemsTxt || '[]'); } catch (_) {}
    const lineas = items.map(x => vars[x.id]).filter(v => v && v.stock !== 'Agotado');
    if (!lineas.length) { h.getRange(i + 2, 6).setValue('Sin stock'); return; }
    const primera = !yaCompro_(String(email).toLowerCase());
    const filas = lineas.slice(0, 6).map(v => `<tr><td style="padding:6px 10px 6px 0" width="70">${v.imagen ? `<img src="${esc_(v.imagen)}" width="64" style="border-radius:8px;display:block">` : ''}</td><td>${esc_(v.producto)}<br><small style="color:#7a6670">${esc_([v.color, v.talle].filter(Boolean).join(' · '))}</small></td><td align="right">$${fmt_(v.precio)}</td></tr>`).join('');
    const promo = primera && TIENDA.DESCUENTO_CODIGO ? `<p style="background:#FBEBED;padding:12px;border-radius:10px">Como es tu primera compra, usá el código <b>${TIENDA.DESCUENTO_CODIGO}</b> y tenés <b>${TIENDA.DESCUENTO_PORC}% off</b>.</p>` : '';
    MailApp.sendEmail({
      to: email, name: TIENDA.NOMBRE, replyTo: TIENDA.CONTACTO,
      subject: `${(String(nombre).split(' ')[0] || 'Hola')}, tus prendas te esperan ♡`,
      htmlBody: plantillaMail_('Dejaste algo lindo en tu carrito', `<p>Guardamos tu carrito para que no te lo pierdas.</p>
        <table width="100%" style="border-collapse:collapse;font-size:14px">${filas}</table>${promo}
        <p style="text-align:center;margin:24px 0"><a href="${esc_(site)}" style="background:#7A1F3D;color:#fff;padding:12px 26px;border-radius:24px;text-decoration:none;font-weight:bold">Terminar mi compra</a></p>`)
    });
    h.getRange(i + 2, 6).setValue(new Date());
    enviados++;
  });
}

/* ===================== AYUDANTES ===================== */

function verificarUsuario_(idToken) {
  if (!idToken) throw new Error('Iniciá sesión con Google para continuar.');
  const cid = prop_('GOOGLE_CLIENT_ID');
  if (!cid) throw new Error('La tienda todavía no tiene el inicio de sesión configurado.');
  // Una sesión ya verificada se recuerda unos minutos (evita consultar a Google en cada clic: todo más rápido)
  let claveCache = '';
  try {
    claveCache = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
    const c = CacheService.getScriptCache().get(claveCache);
    if (c) return JSON.parse(c);
  } catch (_) { claveCache = ''; }
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Tu sesión venció. Volvé a iniciar sesión.');
  const t = JSON.parse(r.getContentText());
  if (t.aud !== cid) throw new Error('Sesión no válida. Volvé a iniciar sesión.');
  if (String(t.email_verified) !== 'true') throw new Error('Tu cuenta de Google no tiene el email verificado.');
  const u = { email: String(t.email).toLowerCase(), nombre: t.name || '' };
  const quedan = Math.floor(Number(t.exp || 0) - Date.now() / 1000) - 60;
  if (claveCache && quedan > 60) { try { CacheService.getScriptCache().put(claveCache, JSON.stringify(u), Math.min(quedan, 1800)); } catch (_) {} }
  return u;
}

function hojaPedidos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(TIENDA.HOJA_PEDIDOS);
  if (!h) { instalarTienda(); h = ss.getSheetByName(TIENDA.HOJA_PEDIDOS); }
  // Columnas nuevas (ej. "Código entrega") se agregan solas al final del encabezado
  const enc = h.getRange(1, 1, 1, Math.max(1, h.getLastColumn())).getValues()[0];
  if (enc.length < COLUMNAS_PEDIDOS.length || COLUMNAS_PEDIDOS.some((c, i) => enc[i] !== c && !(enc[i] === '' && i >= enc.length))) {
    COLUMNAS_PEDIDOS.forEach((c, i) => { if (enc[i] !== c && (enc[i] === '' || enc[i] === undefined)) h.getRange(1, i + 1).setValue(c).setFontWeight('bold'); });
  }
  return h;
}

/* ===================== PUNTO DE ENCUENTRO ===================== */

// Código único y personal (sin letras que se confunden: 0/O, 1/I/L)
function nuevoCodigoEntrega_() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const hex = Utilities.getUuid().replace(/-/g, '');
  let c = '';
  for (let i = 0; i < 6; i++) c += abc[parseInt(hex.substr(i * 2, 2), 16) % abc.length];
  return c;
}
// Próximo sábado de entrega: si paga de lunes a jueves, ese sábado; si paga viernes a domingo, el siguiente
function proximoSabado_(desde) {
  const d = new Date(desde || new Date());
  const dia = d.getDay(); // 0 domingo … 6 sábado
  let suma = (6 - dia + 7) % 7;
  if (dia === 5 || dia === 6 || dia === 0) suma += 7;
  if (suma === 0) suma = 7;
  d.setDate(d.getDate() + suma);
  return Utilities.formatDate(d, TIENDA.ZONA_HORARIA, 'dd/MM');
}
const lugarEncuentro_ = () => TIENDA.ENCUENTRO_LUGAR || 'te escribimos para confirmarte el lugar exacto';
function mailCodigoEntrega_(d) {
  MailApp.sendEmail({
    to: d['Email'], name: TIENDA.NOMBRE, replyTo: TIENDA.CONTACTO,
    subject: `${TIENDA.NOMBRE} · Tu código de entrega (pedido ${d['Pedido']})`,
    htmlBody: plantillaMail_('Tu código de entrega', `<p>Elegiste retirar tu pedido <b>${esc_(d['Pedido'])}</b> en el <b>punto de encuentro</b>, los ${TIENDA.ENCUENTRO_DIA} a las ${TIENDA.ENCUENTRO_HORA} (${esc_(lugarEncuentro_())}).</p>
      <p style="text-align:center;margin:22px 0"><span style="display:inline-block;padding:14px 26px;border-radius:14px;background:#FBEBED;color:#7A1F3D;font:700 30px/1 Arial,sans-serif;letter-spacing:6px">${esc_(d['Código entrega'])}</span></p>
      <p>Mostralo cuando retires: es <b>único y personal</b>, no lo compartas con nadie. Con este código confirmamos que la entrega es tuya.</p>`)
  });
}
function mailEntregaConfirmada_(d) {
  MailApp.sendEmail({
    to: d['Email'], name: TIENDA.NOMBRE, replyTo: TIENDA.CONTACTO,
    subject: `${TIENDA.NOMBRE} · Entrega confirmada (pedido ${d['Pedido']})`,
    htmlBody: plantillaMail_('¡Entrega confirmada!', `<p>Confirmamos que retiraste tu pedido <b>${esc_(d['Pedido'])}</b>. ¡Gracias por elegir ${TIENDA.NOMBRE}! 💕</p>
      <p>Si necesitás un cambio, tenés 5 días desde hoy.</p>`)
  });
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
