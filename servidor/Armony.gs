/**
 * Sincronización del catálogo de Armony Fabricantes (WooCommerce) → Google Sheets
 * Coquette – Ropa femenina
 *
 * Uso:
 *  1. Pegá este archivo como un archivo nuevo en tu proyecto de Apps Script (Armony.gs).
 *  2. Ajustá CONFIG (email, redondeo).
 *  3. Ejecutá syncArmony() una vez a mano (te pide permisos).
 *  4. Ejecutá crearActivadorArmony() una vez: queda sincronizando cada 30 min.
 */

const ARMONY = {
  BASE: 'https://armonyfabricantes.com.ar',
  HOJA: 'Armony',
  HOJA_ALERTAS: 'Alertas Armony',
  MARGEN_UNIDAD: 2.5, // venta por unidad = costo + 150% (× 2,5)
  MARGEN_PACK: 2,     // venta por pack de 6 = costo × 2
  REDONDEO: 0,      // 0 = sin redondeo. Ej: 100 → redondea hacia arriba a múltiplos de $100
  EMAIL: 'luzaquino84@gmail.com', // a dónde llegan los avisos. Vacío = sin mails
  AVISAR_POR_MAIL: ['AGOTADO', 'Nuevo'], // tipos de alerta que se mandan por mail (todas quedan en la hoja)
  HORAS_ENTRE_MAILS_ERROR: 6,             // si el error se repite, no manda otro mail antes de este tiempo
  POR_PAGINA: 100,  // máximo que permite WooCommerce
  LOTE: 25          // variantes que se piden en paralelo
};

const COLUMNAS_ARMONY = [
  'Clave', 'ID Producto', 'Producto', 'Categoría', 'Color', 'Talle', 'Otras opciones',
  'Costo', 'Precio venta', 'Precio regular', 'En oferta', 'Stock', 'Stock restante',
  'Imagen principal', 'Todas las imágenes', 'Descripción', 'Link', 'Actualizado', 'Tipo venta'
];

/* ===================== FUNCIÓN PRINCIPAL ===================== */

function syncArmony() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // ya hay una sincronización corriendo
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let hoja = ss.getSheetByName(ARMONY.HOJA);
    if (!hoja) {
      // Si la planilla tiene una sola hoja vacía o con los encabezados, la reutiliza
      const primera = ss.getSheets()[0];
      const a1 = String(primera.getRange('A1').getValue());
      hoja = (ss.getSheets().length === 1 && (a1 === '' || a1 === 'Clave'))
        ? primera.setName(ARMONY.HOJA)
        : ss.insertSheet(ARMONY.HOJA);
    }

    const anterior = leerEstadoAnterior_(hoja);
    const productos = traerProductos_();
    const filas = armarFilas_(productos);

    if (!filas.length) throw new Error('No se obtuvo ningún producto. La hoja no se modificó.');

    escribirHoja_(hoja, filas);
    const alertas = compararEstados_(anterior, filas);
    registrarAlertas_(ss, alertas);

    Logger.log(`OK: ${productos.length} productos, ${filas.length} filas, ${alertas.length} alertas.`);
    PropertiesService.getScriptProperties().deleteProperty('ULTIMO_ERROR');
  } catch (e) {
    avisarError_(e);
    throw e; // queda también en el registro de Ejecuciones
  } finally {
    lock.releaseLock();
  }
}

function crearActivadorArmony() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncArmony')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncArmony').timeBased().everyMinutes(30).create();
}

/* ===================== LECTURA DE LA TIENDA ===================== */

function traerProductos_() {
  const todos = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${ARMONY.BASE}/wp-json/wc/store/v1/products?per_page=${ARMONY.POR_PAGINA}&page=${page}`;
    const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
    const code = r.getResponseCode();
    if (code === 400 && page > 1) break; // pasamos la última página
    if (code !== 200) throw new Error(`Error ${code} leyendo el catálogo (${url}). ¿La tienda bloqueó la API?`);

    const data = JSON.parse(r.getContentText());
    if (!data.length) break;
    todos.push(...data);

    const h = r.getAllHeaders();
    const totalPag = Number(h['X-WP-TotalPages'] || h['x-wp-totalpages'] || 0);
    if (totalPag && page >= totalPag) break;
  }
  return todos;
}

// Pide TODAS las variantes en páginas de 100 (≈25 consultas en vez de una por variante)
function traerVariantesEnLote_() {
  const out = {};
  for (let page = 1; page <= 100; page++) {
    const url = `${ARMONY.BASE}/wp-json/wc/store/v1/products?type=variation&per_page=${ARMONY.POR_PAGINA}&page=${page}`;
    const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
    if (r.getResponseCode() !== 200) break;
    const data = JSON.parse(r.getContentText());
    if (!data.length) break;
    data.forEach(v => { out[v.id] = v; });
    const h = r.getAllHeaders();
    const totalPag = Number(h['X-WP-TotalPages'] || h['x-wp-totalpages'] || 0);
    if (totalPag && page >= totalPag) break;
  }
  return out;
}

// Respaldo: pide de a una las variantes que no vinieron en lote
function traerVariantes_(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += ARMONY.LOTE) {
    const lote = ids.slice(i, i + ARMONY.LOTE);
    const reqs = lote.map(id => ({
      url: `${ARMONY.BASE}/wp-json/wc/store/v1/products/${id}`,
      muteHttpExceptions: true,
      headers: { Accept: 'application/json' }
    }));
    UrlFetchApp.fetchAll(reqs).forEach((r, k) => {
      if (r.getResponseCode() === 200) out[lote[k]] = JSON.parse(r.getContentText());
    });
  }
  return out;
}

/* ===================== ARMADO DE FILAS ===================== */

function armarFilas_(productos) {
  const ahora = new Date();

  // Juntar todas las variantes para pedirlas de una
  const idsVariantes = [];
  productos.forEach(p => (p.variations || []).forEach(v => idsVariantes.push(v.id)));
  const variantes = idsVariantes.length ? traerVariantesEnLote_() : {};
  const faltantes = idsVariantes.filter(id => !variantes[id]);
  // Si faltan pocas, se piden de a una; si faltan muchas, el lote no funcionó y se piden todas
  if (faltantes.length) Object.assign(variantes, traerVariantes_(faltantes));
  Logger.log(`Variantes: ${idsVariantes.length} (en lote: ${idsVariantes.length - faltantes.length}, de a una: ${faltantes.length})`);

  const filas = [];
  productos.forEach(p => {
    const nombre = limpiarTexto_(p.name);
    const categoria = (p.categories || []).map(c => limpiarTexto_(c.name)).join(', ');
    const imagenes = (p.images || []).map(img => img.src);
    const descripcion = textoPlano_(p.description || p.short_description);
    const mapaTerminos = mapaTerminos_(p.attributes || []);

    if (p.variations && p.variations.length) {
      p.variations.forEach(vRef => {
        const v = variantes[vRef.id];
        const opc = clasificarAtributos_(vRef.attributes || [], mapaTerminos);
        const imgsVar = v && v.images && v.images.length ? v.images.map(i => i.src) : imagenes;
        filas.push(armarFila_(String(vRef.id), p, nombre, categoria, opc, v, imgsVar, descripcion, ahora));
      });
    } else {
      filas.push(armarFila_(String(p.id), p, nombre, categoria, { color: '', talle: '', otras: '' }, p, imagenes, descripcion, ahora));
    }
  });
  definirPrecios_(filas);
  return filas;
}

function armarFila_(clave, p, nombre, categoria, opc, datos, imagenes, descripcion, ahora) {
  let costo = '', regular = '', oferta = '', stock = 'Sin datos', restante = '';
  if (datos) {
    costo = precio_(datos.prices, 'price');
    regular = precio_(datos.prices, 'regular_price');
    oferta = datos.on_sale ? 'Sí' : 'No';
    stock = datos.is_in_stock ? 'Hay' : 'Agotado';
    restante = datos.low_stock_remaining != null ? datos.low_stock_remaining : '';
  }
  return [
    clave, p.id, nombre, categoria, opc.color, opc.talle, opc.otras,
    costo, '', regular, oferta, stock, restante, // el precio de venta se calcula en definirPrecios_
    imagenes[0] || '', imagenes.join(', '), descripcion, p.permalink, ahora, ''
  ];
}

// Traduce el "slug" de cada opción (ej: "negro") a su nombre visible (ej: "Negro")
function mapaTerminos_(atributos) {
  const mapa = {};
  atributos.forEach(a => {
    const m = {};
    (a.terms || []).forEach(t => { m[t.slug] = limpiarTexto_(t.name); });
    mapa[String(a.name).toLowerCase()] = m;
    if (a.taxonomy) mapa[String(a.taxonomy).toLowerCase()] = m;
  });
  return mapa;
}

function clasificarAtributos_(attrs, mapaTerminos) {
  const res = { color: '', talle: '', otras: [] };
  attrs.forEach(a => {
    const nombreAttr = String(a.name || '');
    const clave = nombreAttr.toLowerCase();
    const terminos = mapaTerminos[clave] || {};
    const crudo = String(a.value || '').trim();
    let valor = crudo === '' ? 'Todos' : (terminos[crudo] || limpiarTexto_(crudo));
    // "beige-claro" → "Beige claro"
    if (/^[a-z0-9-]+$/.test(valor)) valor = valor.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

    if (/color/.test(clave)) res.color = valor;
    else if (/talle|talla|size/.test(clave)) res.talle = valor;
    else res.otras.push(`${limpiarTexto_(nombreAttr.replace(/^pa_/, ''))}: ${valor}`);
  });
  res.otras = res.otras.join(' | ');
  return res;
}

/* ===================== PRECIOS Y TEXTO ===================== */

function precio_(prices, campo) {
  if (!prices || prices[campo] === undefined || prices[campo] === '' || prices[campo] === null) return '';
  const minor = Number(prices.currency_minor_unit || 0);
  return Number(prices[campo]) / Math.pow(10, minor);
}

// Decide si cada variante es "Unidad" o "Pack x6" y le pone su precio de venta.
// Es pack si la opción lo dice (6 / pack / curva) o si cuesta 3 veces o más que la más barata del producto.
function definirPrecios_(filas) {
  const c = n => COLUMNAS_ARMONY.indexOf(n);
  const minimo = {};
  filas.forEach(f => {
    const id = f[c('ID Producto')], costo = f[c('Costo')];
    if (costo !== '' && !isNaN(costo)) minimo[id] = Math.min(minimo[id] ?? Infinity, costo);
  });
  filas.forEach(f => {
    const costo = f[c('Costo')];
    const opciones = String(f[c('Otras opciones')] || '');
    const esPack = /\b6\b|pack|curva|docena|mayor/i.test(opciones) ||
      (costo !== '' && minimo[f[c('ID Producto')]] && costo >= 3 * minimo[f[c('ID Producto')]]);
    f[c('Tipo venta')] = esPack ? 'Pack x6' : 'Unidad';
    f[c('Precio venta')] = precioVenta_(costo, esPack);
  });
}

function precioVenta_(costo, esPack) {
  if (costo === '' || isNaN(costo)) return '';
  let v = costo * (esPack ? ARMONY.MARGEN_PACK : ARMONY.MARGEN_UNIDAD);
  if (ARMONY.REDONDEO > 0) v = Math.ceil(v / ARMONY.REDONDEO) * ARMONY.REDONDEO;
  return v;
}

// Normaliza letras "negrita" Unicode (𝐕𝐄𝐒𝐓𝐈𝐃𝐎 → VESTIDO) y decodifica entidades HTML
function limpiarTexto_(s) {
  return decodificarHtml_(String(s || '')).normalize('NFKC').trim();
}

function textoPlano_(html) {
  const t = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return limpiarTexto_(t).replace(/\n{3,}/g, '\n\n').slice(0, 5000);
}

function decodificarHtml_(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/* ===================== HOJA ===================== */

function escribirHoja_(hoja, filas) {
  // Escribe encima (sin borrar antes) para que la tienda nunca lea la hoja vacía
  const ultima = hoja.getLastRow();
  hoja.getRange(1, 1, 1, COLUMNAS_ARMONY.length).setValues([COLUMNAS_ARMONY]).setFontWeight('bold');
  hoja.getRange(2, 1, filas.length, COLUMNAS_ARMONY.length).setValues(filas);
  if (ultima > filas.length + 1) hoja.getRange(filas.length + 2, 1, ultima - filas.length - 1, hoja.getMaxColumns()).clearContent();
  if (typeof limpiarCacheCatalogo === 'function') limpiarCacheCatalogo();
  hoja.setFrozenRows(1);
  const col = n => COLUMNAS_ARMONY.indexOf(n) + 1;
  hoja.getRange(2, col('Costo'), filas.length, 3).setNumberFormat('$#,##0');
  hoja.getRange(2, col('Actualizado'), filas.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
}

function leerEstadoAnterior_(hoja) {
  const estado = {};
  if (hoja.getLastRow() < 2) return estado;
  const datos = hoja.getDataRange().getValues();
  const enc = datos[0];
  const i = n => enc.indexOf(n);
  if (i('Clave') < 0) return estado;
  for (let r = 1; r < datos.length; r++) {
    const f = datos[r];
    estado[String(f[i('Clave')])] = {
      producto: f[i('Producto')],
      variante: [f[i('Color')], f[i('Talle')], f[i('Otras opciones')]].filter(Boolean).join(' / '),
      costo: f[i('Costo')],
      stock: f[i('Stock')],
      link: f[i('Link')]
    };
  }
  return estado;
}

/* ===================== ALERTAS ===================== */

function compararEstados_(anterior, filas) {
  const alertas = [];
  const hayAnterior = Object.keys(anterior).length > 0;
  const vistos = {};
  const c = n => COLUMNAS_ARMONY.indexOf(n);

  filas.forEach(f => {
    const clave = String(f[c('Clave')]);
    vistos[clave] = true;
    const producto = f[c('Producto')];
    const variante = [f[c('Color')], f[c('Talle')], f[c('Otras opciones')]].filter(Boolean).join(' / ');
    const link = f[c('Link')];
    const costo = f[c('Costo')];
    const stock = f[c('Stock')];
    const prev = anterior[clave];

    if (!prev) {
      if (hayAnterior) alertas.push(['Nuevo', producto, variante, `Costo $${costo}`, link]);
      return;
    }
    if (stock === 'Sin datos' || prev.stock === 'Sin datos') return;

    if (prev.stock === 'Hay' && stock === 'Agotado') alertas.push(['AGOTADO', producto, variante, '', link]);
    if (prev.stock === 'Agotado' && stock === 'Hay') alertas.push(['Repuesto', producto, variante, '', link]);
    if (prev.costo !== '' && costo !== '' && Number(prev.costo) !== Number(costo)) {
      alertas.push(['Cambio de precio', producto, variante,
        `Costo $${prev.costo} → $${costo} | Nuevo precio venta $${f[c('Precio venta')]}`, link]);
    }
  });

  Object.keys(anterior).forEach(k => {
    if (!vistos[k]) alertas.push(['Ya no está publicado', anterior[k].producto, anterior[k].variante, '', anterior[k].link]);
  });

  return alertas;
}

function registrarAlertas_(ss, alertas) {
  if (!alertas.length) return;
  const hoja = ss.getSheetByName(ARMONY.HOJA_ALERTAS) || ss.insertSheet(ARMONY.HOJA_ALERTAS);
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(['Fecha', 'Tipo', 'Producto', 'Variante', 'Detalle', 'Link']);
    hoja.getRange(1, 1, 1, 6).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  const ahora = new Date();
  const filas = alertas.map(a => [ahora, ...a]);
  // Las alertas nuevas quedan arriba
  hoja.insertRowsAfter(1, filas.length);
  hoja.getRange(2, 1, filas.length, 6).setValues(filas);

  enviarMailAlertas_(ss, alertas);
}

// Mail agrupado por producto: "VESTIDO LISBOA — Agotado: Negro / M, Blanco / L"
function enviarMailAlertas_(ss, alertas) {
  if (!ARMONY.EMAIL) return;
  const titulos = { AGOTADO: '🔴 SIN STOCK', Nuevo: '🆕 PRODUCTOS NUEVOS' };
  const secciones = [];
  let total = 0;

  ARMONY.AVISAR_POR_MAIL.forEach(tipo => {
    const grupo = {};
    alertas.filter(a => a[0] === tipo).forEach(a => {
      const p = a[1];
      if (!grupo[p]) grupo[p] = { variantes: [], link: a[4], detalle: a[3] };
      if (a[2]) grupo[p].variantes.push(a[2]);
    });
    const productos = Object.keys(grupo);
    if (!productos.length) return;
    total += productos.length;

    const lineas = productos.slice(0, 60).map(p => {
      const g = grupo[p];
      const vars = g.variantes.length ? `\n   ${g.variantes.slice(0, 15).join(', ')}${g.variantes.length > 15 ? ` y ${g.variantes.length - 15} más` : ''}` : '';
      const precio = tipo === 'Nuevo' && g.detalle ? `  (${g.detalle})` : '';
      return `• ${p}${precio}${vars}\n   ${g.link}`;
    });
    if (productos.length > 60) lineas.push(`…y ${productos.length - 60} productos más.`);
    secciones.push(`${titulos[tipo] || tipo}\n\n${lineas.join('\n\n')}`);
  });

  if (!secciones.length) return;
  const cuerpo = secciones.join('\n\n────────────\n\n') +
    `\n\nVer todo en la planilla: ${ss.getUrl()}`;
  MailApp.sendEmail(ARMONY.EMAIL, `Coquette · Armony: ${total} producto(s) con novedades`, cuerpo);
}

// Avisa por mail si la actualización automática falla (sin repetir el mismo error cada 30 min)
function avisarError_(e) {
  if (!ARMONY.EMAIL) return;
  const props = PropertiesService.getScriptProperties();
  const msg = String(e && e.message || e);
  const previo = JSON.parse(props.getProperty('ULTIMO_ERROR') || '{}');
  const ahora = Date.now();
  if (previo.msg === msg && ahora - previo.t < ARMONY.HORAS_ENTRE_MAILS_ERROR * 3600 * 1000) return;
  props.setProperty('ULTIMO_ERROR', JSON.stringify({ msg, t: ahora }));
  let url = '';
  try { url = SpreadsheetApp.getActiveSpreadsheet().getUrl(); } catch (_) {}
  MailApp.sendEmail(ARMONY.EMAIL, '⚠️ Coquette · Armony: falló la actualización',
    `La actualización automática del catálogo de Armony dio este error:\n\n${msg}\n\n` +
    `La planilla quedó con los últimos datos buenos. Si el error se repite, avisale a Claude.\n\n${url}`);
}

// Ejecutá esta función una vez para comprobar que te llegan los mails
function probarMails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  enviarMailAlertas_(ss, [
    ['AGOTADO', 'PRODUCTO DE PRUEBA', 'Negro / M', '', ss.getUrl()],
    ['Nuevo', 'PRODUCTO NUEVO DE PRUEBA', 'Rojo / Único', 'Costo $10000', ss.getUrl()]
  ]);
  PropertiesService.getScriptProperties().deleteProperty('ULTIMO_ERROR');
  avisarError_(new Error('Esto es solo una prueba, no pasó nada.'));
}
