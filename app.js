/* Coquette — tienda */
(() => {
  'use strict';

  const CFG = window.COQUET_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const fmt = n => '$' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const leer = (k, d, ses) => { try { const v = JSON.parse((ses ? sessionStorage : localStorage).getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const guardar = (k, v, ses) => { try { (ses ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch (_) {} };
  const borrar = (k, ses) => { try { (ses ? sessionStorage : localStorage).removeItem(k); } catch (_) {} };

  const st = {
    cat: null, productos: [], porId: {}, filtro: 'todo', q: '',
    carrito: leer('coquet_carrito', []),
    sesion: null, sel: null, paso: 'carrito', enviando: false
  };

  /* ---------- Texto ---------- */
  const MINUS = new Set(['de', 'del', 'con', 'y', 'en', 'la', 'el', 'a', 'x']);
  function nombreLindo(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ')
      .map((w, i) => (i > 0 && (MINUS.has(w) || w.includes('/'))) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  function etiquetaCategoria(c) {
    const partes = c.split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
    const t = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes[0] || '';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const esPrincipal = c => c && c === c.toUpperCase();
  function categoriaDe(p) {
    const main = p.categorias.find(esPrincipal);
    const sub = p.categorias.find(c => !esPrincipal(c));
    const t = main ? etiquetaCategoria(main) : (sub || '');
    return sub && main ? `${t} ${sub.toLowerCase()}` : t;
  }

  /* ---------- Colores ---------- */
  const COLORES = {
    negro: '#1f1a1c', blanco: '#ffffff', crudo: '#f3ecdc', crema: '#f3e7cf', natural: '#efe5d1', beige: '#e3d2b8',
    'beige claro': '#efe3cf', 'beige oscuro': '#c4a982', camel: '#c19a6b', nude: '#e4c4b0', marron: '#6e4a35',
    'marron claro': '#a47c5d', chocolate: '#4a2c1d', rojo: '#b3261e', bordo: '#6d1a2c', vino: '#6d1a2c', rosa: '#f2b9c6',
    'rosa viejo': '#c98d93', fucsia: '#d3337a', coral: '#ef7f6e', naranja: '#e8873a', amarillo: '#f1d35b', mostaza: '#c99a2e',
    verde: '#4f7d4a', 'verde pistacho': '#bcd197', pistacho: '#bcd197', 'verde oliva': '#6b7240', 'verde militar': '#4d5232',
    'verde agua': '#a2dccd', menta: '#bde5cf', turquesa: '#3fb6b2', celeste: '#9fc8ea', azul: '#2e4a8b', 'azul marino': '#1f2b4d',
    lila: '#c4a7da', violeta: '#6f4a9b', lavanda: '#d8c8ec', gris: '#9b9a9c', 'gris melange': '#b4b1b3', plata: '#c9c9cf', dorado: '#cfae62'
  };
  function colorCss(nombre) {
    const n = sinAcentos(nombre).replace(/-/g, ' ').trim();
    if (COLORES[n]) return COLORES[n];
    const pal = n.split(' ');
    for (let k = pal.length; k > 0; k--) { const c = COLORES[pal.slice(0, k).join(' ')]; if (c) return c; }
    const algun = pal.map(w => COLORES[w]).find(Boolean);
    if (/estamp|print|flor|surtid|varios|hojas|ramita/.test(n)) return `conic-gradient(${algun || '#e9a5b4'} 0 25%, #f4e6c8 0 50%, ${algun || '#7A1F3D'} 0 75%, #f4e6c8 0)`;
    return algun || 'linear-gradient(135deg,#eee,#bbb)';
  }

  /* ---------- Producto ---------- */
  function resumenProducto(p) {
    const conStock = p.variantes.filter(v => v.stock);
    const unidad = conStock.filter(v => v.tipo !== 'Pack x6');
    const pack = conStock.filter(v => v.tipo === 'Pack x6');
    const min = a => a.length ? Math.min(...a.map(v => v.precio)) : null;
    const colores = [...new Set(conStock.map(v => v.color).filter(Boolean))];
    return { desde: min(unidad.length ? unidad : conStock), pack: unidad.length ? min(pack) : null, soloPack: !unidad.length, colores };
  }

  function indexar(cat) {
    st.cat = cat;
    st.productos = (cat.productos || []).map(p => Object.assign(p, { _nombre: nombreLindo(p.nombre), _cat: categoriaDe(p), _res: resumenProducto(p) }));
    st.porId = {};
    st.variantes = {};
    st.productos.forEach(p => { st.porId[p.id] = p; p.variantes.forEach(v => { st.variantes[v.id] = { v, p }; }); });
  }

  /* ---------- Carga del catálogo ---------- */
  async function cargarCatalogo() {
    const cache = leer('coquet_cat', null);
    if (cache && cache.productos) { indexar(cache); pintarTodo(); }
    else pintarEsqueletos();
    try {
      let cat;
      if (DEMO) cat = await new Promise(r => setTimeout(() => r(window.COQUET_DEMO), 350));
      else {
        const r = await fetch(CFG.API_URL + '?action=catalogo', { redirect: 'follow' });
        cat = await r.json();
        if (cat.error) throw new Error(cat.error);
      }
      indexar(cat);
      guardar('coquet_cat', cat);
      pintarTodo();
    } catch (err) {
      console.warn(err);
      if (!st.productos.length) {
        $('#grilla').innerHTML = '';
        $('#resultado').innerHTML = 'No pudimos cargar los productos. Revisá tu conexión y <button class="chip" id="reintentar">volvé a intentar</button>';
        $('#reintentar').onclick = cargarCatalogo;
      }
    }
  }

  function pintarTodo() {
    if (!pintarTodo.listo) { pintarTodo.listo = true; setTimeout(volverDelLogin, 50); }
    pintarPerchero();
    pintarCategorias();
    pintarGrilla();
    reconciliarCarrito();
    abrirDesdeHash();
  }

  function pintarEsqueletos() {
    $('#perchero').innerHTML = Array.from({ length: 6 }, () => '<div class="prenda"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span>&nbsp;</span></div>').join('');
    $('.perchero').classList.add('cargando');
    $('#grilla').innerHTML = Array.from({ length: 8 }, () => '<div class="tarjeta esqueleto"><div class="tarjeta-foto"></div><p class="tarjeta-nombre">.</p><p class="tarjeta-precio">.</p></div>').join('');
  }

  // Colores de los arcos del perchero (combinan con la paleta de la tienda)
  const TONOS = ['#F4D7DB', '#C7D6AE', '#DCCFEE', '#F7D5BC', '#CFE1EF', '#EDB9C6', '#F2E4B6', '#BFDCCF'];

  function pintarPerchero() {
    const el = $('#perchero');
    const elegidos = st.productos.filter(p => p.imagenes.length).slice(0, 14);
    const prenda = (p, i, copia) => `<a class="prenda" href="#p-${esc(p.id)}" style="--tono:${TONOS[i % TONOS.length]}" ${copia ? 'aria-hidden="true" tabindex="-1"' : ''}>
        <span class="arco"><img src="${esc(p.imagenes[0])}" alt="${copia ? '' : esc(p._nombre)}" referrerpolicy="no-referrer" decoding="async" draggable="false"></span>
        <span class="prenda-nombre">${esc(p._nombre)}</span></a>`;
    // Se repite la tira para que el carrusel gire sin fin
    el.innerHTML = elegidos.map((p, i) => prenda(p, i, false)).join('') + elegidos.map((p, i) => prenda(p, i, true)).join('');
    const per = $('.perchero');
    per.classList.remove('cargando');
    if (!pintarPerchero.yaMecio) { pintarPerchero.yaMecio = true; requestAnimationFrame(() => per.classList.add('mece')); }
    carrusel.iniciar();
  }

  /* ---------- Carrusel del perchero: gira solo, se frena al pasar el mouse, se arrastra ---------- */
  const carrusel = (() => {
    const quieto = matchMedia('(prefers-reduced-motion: reduce)');
    let el, pausa = 0, raf = 0, arrastre = null, movio = false, pos = 0;
    const VEL = 0.45; // píxeles por cuadro
    function mitad() { return el.scrollWidth / 2; }
    function paso() {
      if (!el) return;
      if (!quieto.matches && Date.now() > pausa && !arrastre && el.scrollWidth > el.clientWidth) {
        pos += VEL;
        if (pos >= mitad()) pos -= mitad();
        el.scrollLeft = pos;
      } else pos = el.scrollLeft;
      raf = requestAnimationFrame(paso);
    }
    function frenar(ms) { pausa = Date.now() + (ms || 2500); }
    function iniciar() {
      el = $('#perchero');
      cancelAnimationFrame(raf);
      pos = el.scrollLeft;
      if (!el.dataset.listo) {
        el.dataset.listo = '1';
        el.addEventListener('pointerenter', () => frenar(1e9));
        el.addEventListener('pointerleave', () => frenar(900));
        el.addEventListener('touchstart', () => frenar(3500), { passive: true });
        el.addEventListener('focusin', () => frenar(1e9));
        el.addEventListener('focusout', () => frenar(900));
        el.addEventListener('scroll', () => { if (el.scrollLeft >= mitad()) { el.scrollLeft -= mitad(); } if (el.scrollLeft <= 0 && arrastre) el.scrollLeft += mitad(); }, { passive: true });
        // Arrastrar con el mouse
        el.addEventListener('pointerdown', e => {
          if (e.pointerType !== 'mouse') return;
          arrastre = { x: e.clientX, s: el.scrollLeft }; movio = false;
          el.classList.add('arrastrando');
        });
        window.addEventListener('pointermove', e => {
          if (!arrastre) return;
          const dx = e.clientX - arrastre.x;
          if (Math.abs(dx) > 4) movio = true;
          el.scrollLeft = arrastre.s - dx;
        });
        window.addEventListener('pointerup', () => { if (arrastre) { arrastre = null; el.classList.remove('arrastrando'); pos = el.scrollLeft; } });
        el.addEventListener('click', e => { if (movio) { e.preventDefault(); movio = false; } }, true);
        $$('[data-perchero]').forEach(b => b.addEventListener('click', () => {
          frenar(4000);
          const ancho = (el.querySelector('.prenda') || {}).offsetWidth || 200;
          el.scrollBy({ left: Number(b.dataset.perchero) * (ancho + 20) * 2, behavior: quieto.matches ? 'auto' : 'smooth' });
        }));
      }
      raf = requestAnimationFrame(paso);
    }
    return { iniciar };
  })();

  /* ---------- Brillo mágico que sigue al mouse ---------- */
  function iniciarBrillo() {
    if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const capa = document.createElement('div');
    capa.className = 'brillo-capa';
    capa.setAttribute('aria-hidden', 'true');
    capa.innerHTML = '<div class="brillo"></div>';
    document.body.appendChild(capa);
    document.body.classList.add('cursor-magico');
    const punto = capa.firstChild;
    let x = -100, y = -100, px = -100, py = -100, ultimo = 0, visible = false;
    const INTERACTIVO = 'a, button, [role=button], summary, label.metodo, .tarjeta, .prenda, select';
    const TEXTO = 'input, textarea, [contenteditable]';
    function anfitrion() { // dentro de la ventana abierta, para que se vea por encima
      const host = $$('dialog').filter(d => d.open).pop() || document.body;
      if (capa.parentNode !== host) host.appendChild(capa);
    }
    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY;
      if (!visible) { visible = true; capa.classList.add('visible'); px = x; py = y; }
      const t = e.target;
      punto.classList.toggle('grande', !!(t.closest && t.closest(INTERACTIVO)));
      capa.classList.toggle('en-texto', !!(t.closest && t.closest(TEXTO)));
      const ahora = performance.now();
      if (ahora - ultimo > 38 && !capa.classList.contains('en-texto')) { ultimo = ahora; chispa(x, y); }
    }, { passive: true });
    document.addEventListener('pointerleave', () => { visible = false; capa.classList.remove('visible'); });
    document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') for (let i = 0; i < 6; i++) chispa(x, y, true); });
    function chispa(cx, cy, explota) {
      if (capa.childElementCount > 40) return;
      const c = document.createElement('i');
      c.className = 'chispa';
      const ang = Math.random() * Math.PI * 2, dist = (explota ? 26 : 10) + Math.random() * (explota ? 26 : 14);
      c.style.left = cx + 'px'; c.style.top = cy + 'px';
      c.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      c.style.setProperty('--dy', Math.sin(ang) * dist + (explota ? 0 : 12) + 'px');
      c.style.setProperty('--t', (0.5 + Math.random() * 0.5) + 'em');
      c.style.setProperty('--h', ['#F2C46D', '#F7B7C6', '#FFFFFF', '#E9A3B5'][Math.floor(Math.random() * 4)]);
      capa.appendChild(c);
      setTimeout(() => c.remove(), 800);
    }
    (function mover() {
      px += (x - px) * 0.32; py += (y - py) * 0.32;
      punto.style.transform = `translate(${px}px, ${py}px)`;
      requestAnimationFrame(mover);
    })();
    $$('dialog').forEach(d => { d.addEventListener('close', () => setTimeout(anfitrion)); });
    const abrirOriginal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () { abrirOriginal.call(this); anfitrion(); };
  }

  function pintarCategorias() {
    const cuenta = {};
    st.productos.forEach(p => p.categorias.filter(esPrincipal).forEach(c => { cuenta[c] = (cuenta[c] || 0) + 1; }));
    const cats = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]);
    if (st.filtro !== 'todo' && !cuenta[st.filtro]) st.filtro = 'todo';
    $('#categorias').innerHTML = [`<button class="chip" data-cat="todo" aria-pressed="${st.filtro === 'todo'}">Todo</button>`]
      .concat(cats.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${st.filtro === c}">${esc(etiquetaCategoria(c))}</button>`)).join('');
  }

  function visibles() {
    const q = sinAcentos(st.q).trim();
    return st.productos.filter(p => {
      if (st.filtro !== 'todo' && p.categorias.indexOf(st.filtro) < 0) return false;
      if (!q) return true;
      const texto = sinAcentos([p.nombre, p._cat, p.categorias.join(' '), p._res.colores.join(' ')].join(' '));
      return q.split(/\s+/).every(w => texto.includes(w));
    });
  }

  function pintarGrilla() {
    const lista = visibles();
    $('#grilla').innerHTML = lista.map(tarjetaHtml).join('');
    $('#vacio').hidden = lista.length > 0 || !st.productos.length;
    const n = lista.length;
    $('#resultado').textContent = st.productos.length ? (n === 1 ? '1 producto' : `${n} productos`) : '';
  }

  function tarjetaHtml(p) {
    const r = p._res;
    const fotos = p.imagenes;
    const colores = r.colores.slice(0, 5).map(c => `<i style="background:${colorCss(c)}" title="${esc(nombreLindo(c))}"></i>`).join('');
    const mas = r.colores.length > 5 ? `<small>+${r.colores.length - 5}</small>` : '';
    return `<a class="tarjeta" href="#p-${esc(p.id)}">
      <div class="tarjeta-foto">
        ${fotos[0] ? `<img src="${esc(fotos[0])}" alt="${esc(p._nombre)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
        ${fotos[1] ? `<img class="segunda" src="${esc(fotos[1])}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
        ${r.pack ? '<span class="etiqueta">También por pack</span>' : ''}
      </div>
      <h3 class="tarjeta-nombre">${esc(p._nombre)}</h3>
      <p class="tarjeta-precio">${r.soloPack ? 'Pack x6 ' : ''}${fmt(r.desde)}</p>
      ${r.pack ? `<p class="tarjeta-pack">Pack x6: ${fmt(r.pack)}</p>` : ''}
      ${colores ? `<div class="tarjeta-colores" aria-label="${r.colores.length} colores">${colores}${mas}</div>` : ''}
    </a>`;
  }

  /* ---------- Ficha de producto ---------- */
  function abrirDesdeHash() {
    const m = location.hash.match(/^#p-(.+)$/);
    if (!m || !st.porId[decodeURIComponent(m[1])]) return;
    abrirProducto(st.porId[decodeURIComponent(m[1])]);
  }

  function abrirProducto(p) {
    const tipos = [...new Set(p.variantes.map(v => v.tipo))].sort((a, b) => (a === 'Pack x6') - (b === 'Pack x6'));
    const tipoInicial = tipos.find(t => p.variantes.some(v => v.tipo === t && v.stock)) || tipos[0];
    st.sel = { p, tipos, tipo: tipoInicial, color: null, talle: null, cant: 1 };
    ajustarSeleccion();
    $('#pNombre').textContent = p._nombre;
    $('#pCat').textContent = p._cat;
    $('#pDesc').textContent = p.descripcion || '';
    $('#pDescWrap').hidden = !p.descripcion;
    $('#pAviso').textContent = '';
    $('#pFotos').innerHTML = p.imagenes.map((u, i) => `<img src="${esc(u)}" alt="${esc(p._nombre)}, foto ${i + 1}" referrerpolicy="no-referrer" ${i ? 'loading="lazy"' : ''}>`).join('');
    $('#pPuntos').innerHTML = p.imagenes.length > 1 ? p.imagenes.map((_, i) => `<button type="button" aria-label="Ver foto ${i + 1}" data-foto="${i}" ${i ? '' : 'aria-current="true"'}></button>`).join('') : '';
    $('#pFotos').scrollLeft = 0;
    pintarSeleccion();
    abrir($('#dlgProducto'));
    $('#dlgProducto .hoja-contenido').scrollTop = 0;
  }

  const disponibles = (tipo, color) => st.sel.p.variantes.filter(v => v.tipo === tipo && (color == null || v.color === color));

  function ajustarSeleccion() {
    const s = st.sel;
    const deTipo = disponibles(s.tipo);
    const colores = [...new Set(deTipo.map(v => v.color))];
    if (s.color == null || colores.indexOf(s.color) < 0 || !deTipo.some(v => v.color === s.color && v.stock)) {
      s.color = colores.find(c => deTipo.some(v => v.color === c && v.stock));
      if (s.color === undefined) s.color = colores[0];
    }
    const deColor = disponibles(s.tipo, s.color);
    const talles = [...new Set(deColor.map(v => v.talle))];
    if (s.talle == null || talles.indexOf(s.talle) < 0 || !deColor.some(v => v.talle === s.talle && v.stock)) {
      s.talle = talles.find(t => deColor.some(v => v.talle === t && v.stock));
      if (s.talle === undefined) s.talle = talles[0];
    }
  }

  function varianteSel() {
    const s = st.sel;
    return s.p.variantes.find(v => v.tipo === s.tipo && v.color === s.color && v.talle === s.talle);
  }

  function pintarSeleccion() {
    const s = st.sel;
    const v = varianteSel();
    $('#grpTipo').hidden = s.tipos.length < 2;
    $('#pTipos').innerHTML = s.tipos.map(t => `<button type="button" data-tipo="${esc(t)}" aria-pressed="${t === s.tipo}">${t === 'Pack x6' ? 'Pack x6 prendas' : 'Por unidad'}</button>`).join('');

    const deTipo = disponibles(s.tipo);
    const colores = [...new Set(deTipo.map(x => x.color))];
    $('#grpColor').hidden = !colores.some(Boolean);
    $('#pColorSel').textContent = s.color ? nombreLindo(s.color) : '';
    $('#pColores').innerHTML = colores.filter(Boolean).map(c => {
      const hay = deTipo.some(x => x.color === c && x.stock);
      return `<button type="button" class="pastilla" data-color="${esc(c)}" aria-pressed="${c === s.color}" ${hay ? '' : 'disabled aria-label="' + esc(nombreLindo(c)) + ', sin stock"'}><i style="background:${colorCss(c)}"></i>${esc(nombreLindo(c))}</button>`;
    }).join('');

    const deColor = disponibles(s.tipo, s.color);
    const talles = [...new Set(deColor.map(x => x.talle))];
    $('#grpTalle').hidden = !talles.some(Boolean);
    $('#pTalles').innerHTML = talles.filter(Boolean).map(t => {
      const hay = deColor.some(x => x.talle === t && x.stock);
      return `<button type="button" class="pastilla" data-talle="${esc(t)}" aria-pressed="${t === s.talle}" ${hay ? '' : 'disabled'}>${esc(nombreLindo(t))}</button>`;
    }).join('');

    $('#pPrecio').textContent = v ? fmt(v.precio) : fmt(s.p._res.desde);
    $('#pPorPrenda').textContent = v && v.tipo === 'Pack x6' ? `(${fmt(v.precio / 6)} por prenda)` : '';
    $('#cant').textContent = s.cant;
    const ok = v && v.stock;
    $('#agregar').disabled = !ok;
    $('#agregar').textContent = ok ? 'Agregar al carrito' : 'Sin stock';
    if (v && v.imagen) irAFoto(s.p.imagenes.indexOf(v.imagen));
  }

  function irAFoto(i) {
    if (i < 0) return;
    const cont = $('#pFotos');
    cont.scrollTo({ left: cont.clientWidth * i, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function agregarAlCarrito() {
    const s = st.sel, v = varianteSel();
    if (!v || !v.stock) return;
    const linea = st.carrito.find(l => l.id === v.id);
    if (linea) linea.cantidad = Math.min(20, linea.cantidad + s.cant);
    else st.carrito.push({ id: v.id, pid: s.p.id, cantidad: s.cant });
    guardarCarrito();
    $('#pAviso').textContent = 'Agregado al carrito.';
    tostada('Agregado al carrito', 'Ver carrito', () => { cerrar($('#dlgProducto')); abrirCarrito(); });
  }

  /* ---------- Carrito ---------- */
  function lineasCarrito() {
    return st.carrito.map(l => {
      const x = st.variantes && st.variantes[l.id];
      return x ? { ...l, v: x.v, p: x.p } : null;
    }).filter(Boolean);
  }
  function guardarCarrito() {
    guardar('coquet_carrito', st.carrito);
    const n = st.carrito.reduce((s, l) => s + l.cantidad, 0);
    const c = $('#contador');
    c.hidden = n === 0;
    c.textContent = n;
    c.classList.remove('salta'); void c.offsetWidth; c.classList.add('salta');
    $('#btnCarrito').setAttribute('aria-label', n ? `Carrito, ${n} ${n === 1 ? 'producto' : 'productos'}` : 'Carrito');
    if ($('#dlgCarrito').open) pintarCarrito();
  }
  function reconciliarCarrito() {
    const antes = st.carrito.length;
    st.carrito = st.carrito.filter(l => st.variantes[l.id] && st.variantes[l.id].v.stock);
    if (st.carrito.length < antes) tostada('Quitamos del carrito productos que se agotaron.');
    guardarCarrito();
  }
  const subtotal = () => lineasCarrito().reduce((s, l) => s + l.v.precio * l.cantidad, 0);

  function abrirCarrito() {
    irPaso('carrito');
    abrir($('#dlgCarrito'));
  }

  function irPaso(paso) {
    st.paso = paso;
    $('#pasoCarrito').hidden = paso !== 'carrito';
    $('#pasoCompra').hidden = paso !== 'compra';
    $('#volverCarrito').hidden = paso !== 'compra';
    $('#tituloCarrito').textContent = paso === 'compra' ? 'Envío y pago' : 'Tu carrito';
    $('#notaPago').hidden = paso !== 'compra';
    $('#errorCompra').hidden = true;
    if (paso === 'compra') prepararCompra();
    pintarCarrito();
  }

  function pintarCarrito() {
    const lineas = lineasCarrito();
    $('#carritoVacio').hidden = lineas.length > 0;
    $('#cajonPie').hidden = !lineas.length;
    $('#lineas').innerHTML = lineas.map(l => `<li class="linea">
        <img src="${esc(l.v.imagen || l.p.imagenes[0] || '')}" alt="" referrerpolicy="no-referrer">
        <div>
          <h3>${esc(l.p._nombre)}</h3>
          <p>${esc([l.v.tipo === 'Pack x6' ? 'Pack x6' : '', nombreLindo(l.v.color), l.v.talle ? 'Talle ' + l.v.talle : ''].filter(Boolean).join(', '))}</p>
          <div class="cantidad" aria-label="Cantidad">
            <button type="button" data-linea="${esc(l.id)}" data-delta="-1" aria-label="Restar uno">−</button>
            <output>${l.cantidad}</output>
            <button type="button" data-linea="${esc(l.id)}" data-delta="1" aria-label="Sumar uno">+</button>
          </div>
        </div>
        <div class="linea-precio">${fmt(l.v.precio * l.cantidad)}<button type="button" class="quitar" data-quitar="${esc(l.id)}">Quitar</button></div>
      </li>`).join('');
    const sub = subtotal();
    $('#tSubtotal').textContent = fmt(sub);
    const env = st.paso === 'compra' ? envioActual() : null;
    $('#filaEnvio').hidden = !env;
    if (env) $('#tEnvio').textContent = env.costo == null ? 'A coordinar' : fmt(env.costo);
    $('#tTotal').textContent = fmt(sub + (env && env.costo ? env.costo : 0));
    const btn = $('#btnSeguir');
    const minimo = Number(CFG.MINIMO_COMPRA) || 0;
    const falta = Math.max(0, minimo - sub);
    $('#notaMinimo').hidden = !falta;
    if (falta) $('#notaMinimo').textContent = `La compra mínima es de ${fmt(minimo)}. Te faltan ${fmt(falta)}.`;
    if (falta) { btn.textContent = `Mínimo de compra ${fmt(minimo)}`; btn.disabled = true; }
    else if (st.paso === 'carrito') { btn.textContent = 'Finalizar compra'; btn.disabled = false; }
    else if (!st.sesion) { btn.textContent = 'Ingresá para continuar'; btn.disabled = true; }
    else if (!st.enviando) { btn.textContent = DEMO ? 'Pagar con Mercado Pago (demo)' : 'Pagar con Mercado Pago'; btn.disabled = false; }
  }

  /* ---------- Compra ---------- */
  function zonaDe(provincia) {
    return ((st.cat && st.cat.envios) || []).find(z => z.provincias.indexOf(provincia) >= 0) || null;
  }
  function envioActual() {
    const f = $('#formCompra');
    const prov = f.provincia.value;
    if (!prov) return null;
    const metodo = f.querySelector('input[name=metodo]:checked').value;
    const z = zonaDe(prov);
    return { metodo, costo: z && z[metodo] != null ? z[metodo] : null };
  }
  function prepararCompra() {
    const logueada = !!st.sesion;
    $('#loginCompra').hidden = logueada;
    $('#formCompra').hidden = !logueada;
    if (!logueada) { pintarBotonesGoogle(); return; }
    $('#sesionLinea').innerHTML = `Comprás como <b>${esc(st.sesion.email)}</b>. <button type="button" id="cambiarCuenta">Cambiar</button>`;
    const sel = $('#provincia');
    if (sel.options.length <= 1) {
      sel.insertAdjacentHTML('beforeend', ((st.cat && st.cat.provincias) || []).map(p => `<option>${esc(p)}</option>`).join(''));
    }
    const datos = leer('coquet_datos', {});
    const f = $('#formCompra');
    ['nombre', 'telefono', 'dni', 'provincia', 'direccion', 'ciudad', 'cp'].forEach(k => { if (datos[k] && !f[k].value) f[k].value = datos[k]; });
    if (!f.nombre.value && st.sesion.nombre) f.nombre.value = st.sesion.nombre;
    if (datos.metodo) { const r = f.querySelector(`input[name=metodo][value=${datos.metodo}]`); if (r) r.checked = true; }
    actualizarEnvio();
  }
  function actualizarEnvio() {
    const f = $('#formCompra');
    const z = zonaDe(f.provincia.value);
    const txt = m => !f.provincia.value ? 'Elegí la provincia' : (z && z[m] != null ? fmt(z[m]) : 'Costo a coordinar');
    $('#precioDomicilio').textContent = txt('domicilio');
    $('#precioSucursal').textContent = txt('sucursal');
    const suc = f.querySelector('input[name=metodo]:checked').value === 'sucursal';
    $('#lblDireccion').firstChild.textContent = suc ? 'Sucursal de Correo Argentino que te queda cómoda (opcional)' : 'Calle, número, piso y depto';
    pintarCarrito();
  }
  function validarCompra() {
    const f = $('#formCompra');
    const suc = f.querySelector('input[name=metodo]:checked').value === 'sucursal';
    const req = ['nombre', 'telefono', 'provincia', 'ciudad', 'cp'].concat(suc ? [] : ['direccion']);
    let primero = null;
    ['nombre', 'telefono', 'provincia', 'direccion', 'ciudad', 'cp'].forEach(k => {
      const malo = req.indexOf(k) >= 0 && !String(f[k].value).trim();
      f[k].setAttribute('aria-invalid', malo);
      if (malo && !primero) primero = f[k];
    });
    if (primero) { mostrarError('Completá los datos marcados para poder enviarte el pedido.'); primero.focus(); return null; }
    const datos = { metodo: suc ? 'sucursal' : 'domicilio' };
    ['nombre', 'telefono', 'dni', 'provincia', 'direccion', 'ciudad', 'cp'].forEach(k => { datos[k] = String(f[k].value).trim(); });
    guardar('coquet_datos', datos);
    return datos;
  }
  function mostrarError(msg) { const e = $('#errorCompra'); e.textContent = msg; e.hidden = !msg; }

  async function pagar() {
    if (st.enviando) return;
    const envio = validarCompra();
    if (!envio) return;
    if (sesionVencida()) { cerrarSesion(true); prepararCompra(); pintarCarrito(); mostrarError(''); tostada('Tu sesión venció. Volvé a ingresar.'); return; }
    mostrarError('');
    st.enviando = true;
    const btn = $('#btnSeguir');
    btn.disabled = true;
    btn.innerHTML = '<span class="girando" aria-hidden="true"></span> Preparando el pago…';
    try {
      if (DEMO) {
        await new Promise(r => setTimeout(r, 900));
        cerrar($('#dlgCarrito'));
        mostrarPedido('demo', 'CQDEMO-0001');
        return;
      }
      const r = await post({ action: 'crearPedido', idToken: st.sesion.token, items: st.carrito.map(l => ({ id: l.id, cantidad: l.cantidad })), envio });
      if (r.error) throw new Error(r.error);
      guardar('coquet_ultimo_pedido', r.pedido);
      location.href = r.url;
    } catch (err) {
      mostrarError(err.message || 'No pudimos iniciar el pago. Probá de nuevo.');
    } finally {
      st.enviando = false;
      if (!document.hidden) pintarCarrito();
    }
  }

  async function post(body) {
    const r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
    return r.json();
  }

  /* ---------- Vuelta de Mercado Pago ---------- */
  async function revisarVuelta() {
    const u = new URL(location.href);
    const pedido = u.searchParams.get('pedido');
    if (!pedido) return;
    const pago = u.searchParams.get('payment_id') || u.searchParams.get('collection_id') || '';
    ['pedido', 'payment_id', 'collection_id', 'collection_status', 'status', 'external_reference', 'payment_type', 'merchant_order_id', 'preference_id', 'site_id', 'processing_mode', 'merchant_account_id']
      .forEach(k => u.searchParams.delete(k));
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    mostrarPedido('cargando', pedido);
    try {
      const r = await fetch(`${CFG.API_URL}?action=pedido&id=${encodeURIComponent(pedido)}&payment_id=${encodeURIComponent(pago)}`).then(x => x.json());
      if (r.error) throw new Error(r.error);
      mostrarPedido(r.estado, pedido);
    } catch (_) {
      mostrarPedido('desconocido', pedido);
    }
  }

  function mostrarPedido(estado, id) {
    const sello = $('#pedidoSello');
    let t, txt, s = '', cls = '';
    if (estado === 'cargando') { t = 'Confirmando tu pago…'; txt = 'Esto tarda unos segundos.'; s = '…'; }
    else if (estado === 'demo') { t = 'Así termina la compra'; txt = 'En la tienda real, acá la clienta paga en Mercado Pago (en un pago o en cuotas) y vuelve a esta pantalla con su pedido confirmado.'; s = '✓'; cls = 'ok'; }
    else if (['Pagado', 'Preparando', 'Enviado', 'Entregado'].indexOf(estado) >= 0) { t = '¡Listo, tu compra está confirmada!'; txt = `Pedido ${id}. Te mandamos el detalle por mail y te avisamos cuando salga por Correo Argentino.`; s = '✓'; cls = 'ok'; vaciarCarrito(); }
    else if (estado === 'Pago pendiente') { t = 'Tu pago está en proceso'; txt = `Pedido ${id}. Cuando Mercado Pago lo apruebe te llega un mail de confirmación.`; s = '⏳'; vaciarCarrito(); }
    else if (estado === 'desconocido') { t = 'No pudimos confirmar el pago'; txt = `Pedido ${id}. Revisá tu mail o la sección Mis pedidos en unos minutos.`; s = '?'; }
    else { t = 'El pago no se completó'; txt = 'No se hizo ningún cobro. Tus productos siguen en el carrito para que lo intentes de nuevo.'; s = '×'; cls = 'mal'; }
    sello.textContent = s;
    sello.className = 'sello ' + cls;
    $('#tituloPedido').textContent = t;
    $('#textoPedido').textContent = txt;
    if (!$('#dlgPedido').open) abrir($('#dlgPedido'));
  }
  function vaciarCarrito() { st.carrito = []; guardarCarrito(); }

  /* ---------- Sesión con Google ---------- */
  function decodificarJwt(t) {
    try {
      let b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(atob(b).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
    } catch (_) { return null; }
  }
  function alIngresar(credencial) {
    const d = decodificarJwt(credencial);
    if (!d || !d.email) return;
    st.sesion = { token: credencial, exp: d.exp, email: d.email, nombre: d.name || '', foto: d.picture || '' };
    guardar('coquet_sesion', st.sesion);
    tras_sesion();
    tostada(`Hola, ${(st.sesion.nombre || st.sesion.email).split(' ')[0]}`);
  }
  function sesionVencida() { return !st.sesion || (st.sesion.exp && st.sesion.exp * 1000 < Date.now() + 60000); }
  function cerrarSesion(silencioso) {
    st.sesion = null;
    borrar('coquet_sesion');
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (_) {}
    tras_sesion();
    if (!silencioso) tostada('Cerraste sesión.');
  }
  function tras_sesion() {
    const b = $('#btnCuenta');
    b.textContent = st.sesion ? (st.sesion.nombre || st.sesion.email).split(' ')[0] : 'Ingresar';
    b.setAttribute('aria-label', st.sesion ? 'Tu cuenta' : 'Ingresar con Google');
    if ($('#dlgCarrito').open && st.paso === 'compra') { prepararCompra(); pintarCarrito(); }
    if ($('#dlgCuenta').open) pintarCuenta();
  }

  let googleListo = false;
  function iniciarGoogle() {
    const s = leer('coquet_sesion', null);
    if (s && s.exp * 1000 > Date.now() + 60000) st.sesion = s;
    tras_sesion();
    pintarBotonesGoogle();
    return;
    let intentos = 0;
    (function esperar() {
      if (!(window.google && google.accounts && google.accounts.id)) { if (intentos++ < 100) setTimeout(esperar, 150); return; }
      google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: r => alIngresar(r.credential), cancel_on_tap_outside: true, use_fedcm_for_prompt: true });
      googleListo = true;
      pintarBotonesGoogle();
    })();
  }
  function pintarBotonesGoogle() {
    $$('[data-google-boton]').forEach(el => {
      if (!DEMO && !CFG.GOOGLE_CLIENT_ID) {
        el.innerHTML = '<p class="aviso-chico">Muy pronto vas a poder comprar desde acá. Mientras tanto podés armar tu carrito.</p>';
        return;
      }
      if (DEMO) {
        el.innerHTML = '<button type="button" class="boton secundario google-demo">Continuar con Google (demostración)</button>';
        el.firstChild.onclick = () => {
          const exp = Math.floor(Date.now() / 1000) + 3600;
          st.sesion = { token: 'demo', exp, email: 'clienta@ejemplo.com', nombre: 'Clienta de prueba' };
          guardar('coquet_sesion', st.sesion);
          tras_sesion();
        };
        return;
      }
      el.innerHTML = `<a class="boton principal ancho" href="login.html?volver=${encodeURIComponent(el.dataset.googleBoton || 'inicio')}">Ingresar con Google</a>`;
    });
  }

  function volverDelLogin() {
    const h = location.hash;
    if (h !== '#compra' && h !== '#cuenta') return;
    history.replaceState(null, '', location.pathname + location.search);
    if (h === '#compra' && st.carrito.length) { abrirCarrito(); irPaso('compra'); }
    else if (h === '#cuenta') abrirCuenta();
  }

  /* ---------- Cuenta y mis pedidos ---------- */
  function abrirCuenta() { abrir($('#dlgCuenta')); pintarCuenta(); }
  async function pintarCuenta() {
    const dentro = !!st.sesion;
    $('#cuentaFuera').hidden = dentro;
    $('#cuentaDentro').hidden = !dentro;
    $('#tituloCuenta').textContent = dentro ? 'Mis pedidos' : 'Tu cuenta';
    if (!dentro) { pintarBotonesGoogle(); return; }
    $('#cuentaEmail').textContent = st.sesion.email;
    const cont = $('#misPedidos');
    if (DEMO) { cont.innerHTML = '<p>Todavía no hiciste pedidos.</p>'; return; }
    if (sesionVencida()) { cerrarSesion(true); return; }
    cont.innerHTML = '<p>Buscando tus pedidos…</p>';
    try {
      const r = await post({ action: 'misPedidos', idToken: st.sesion.token });
      if (r.error) throw new Error(r.error);
      cont.innerHTML = r.pedidos.length ? r.pedidos.map(p => `<div class="pedido-mini">
          <b>${esc(p.pedido)}</b> <span class="estado ${esc(String(p.estado).replace(/\s+/g, '-'))}">${esc(p.estado)}</span>
          <p>${esc(p.productos)}</p>
          <p>Total ${fmt(p.total)} · ${new Date(p.fecha).toLocaleDateString('es-AR')}</p>
          ${p.seguimiento ? `<p>Seguimiento Correo Argentino: <b>${esc(p.seguimiento)}</b></p>` : ''}
        </div>`).join('') : '<p>Todavía no hiciste pedidos.</p>';
    } catch (err) { cont.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  }

  /* ---------- Diálogos y avisos ---------- */
  function abrir(d) {
    if (!d.open) d.showModal();
    document.body.classList.add('bloqueado');
  }
  function cerrar(d) { if (d.open) d.close(); }
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cerrar]')) cerrar(d); });
    d.addEventListener('close', () => {
      if (!$$('dialog').some(x => x.open)) document.body.classList.remove('bloqueado');
      if (d.id === 'dlgProducto' && /^#p-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    });
  });

  let tTostada;
  function tostada(msg, accion, fn) {
    const t = $('#tostada');
    // Si hay una ventana abierta, el aviso va adentro para que se vea por encima
    const host = $$('dialog').filter(d => d.open).pop() || document.body;
    if (t.parentNode !== host) host.appendChild(t);
    t.innerHTML =esc(msg) + (accion ? ` <button type="button" class="chip" style="height:30px;margin-left:8px">${esc(accion)}</button>` : '');
    if (accion) t.querySelector('button').onclick = () => { t.hidden = true; fn(); };
    t.hidden = false;
    clearTimeout(tTostada);
    tTostada = setTimeout(() => { t.hidden = true; }, accion ? 4500 : 2800);
  }

  /* ---------- Eventos ---------- */
  window.addEventListener('hashchange', abrirDesdeHash);
  $('#categorias').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    st.filtro = b.dataset.cat;
    $$('#categorias .chip').forEach(c => c.setAttribute('aria-pressed', c === b));
    pintarGrilla();
  });
  $('#btnBuscar').addEventListener('click', () => {
    const f = $('#busqueda');
    f.hidden = !f.hidden;
    $('#btnBuscar').setAttribute('aria-expanded', !f.hidden);
    if (!f.hidden) $('#q').focus();
  });
  $('#busqueda').addEventListener('submit', e => { e.preventDefault(); $('#catalogo').scrollIntoView(); });
  let tq;
  $('#q').addEventListener('input', e => { clearTimeout(tq); tq = setTimeout(() => { st.q = e.target.value; pintarGrilla(); }, 120); });
  $('#limpiarBusqueda').addEventListener('click', () => { st.q = ''; $('#q').value = ''; st.filtro = 'todo'; pintarCategorias(); pintarGrilla(); });

  $('#pTipos').addEventListener('click', e => { const b = e.target.closest('[data-tipo]'); if (!b) return; st.sel.tipo = b.dataset.tipo; ajustarSeleccion(); pintarSeleccion(); });
  $('#pColores').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (!b || b.disabled) return; st.sel.color = b.dataset.color; ajustarSeleccion(); pintarSeleccion(); });
  $('#pTalles').addEventListener('click', e => { const b = e.target.closest('[data-talle]'); if (!b || b.disabled) return; st.sel.talle = b.dataset.talle; pintarSeleccion(); });
  $('#menos').addEventListener('click', () => { st.sel.cant = Math.max(1, st.sel.cant - 1); $('#cant').textContent = st.sel.cant; });
  $('#mas').addEventListener('click', () => { st.sel.cant = Math.min(20, st.sel.cant + 1); $('#cant').textContent = st.sel.cant; });
  $('#agregar').addEventListener('click', agregarAlCarrito);
  $('#pPuntos').addEventListener('click', e => { const b = e.target.closest('[data-foto]'); if (b) irAFoto(Number(b.dataset.foto)); });
  $('#pFotos').addEventListener('scroll', () => {
    const c = $('#pFotos'); const i = Math.round(c.scrollLeft / Math.max(1, c.clientWidth));
    $$('#pPuntos button').forEach((b, k) => b.toggleAttribute('aria-current', k === i));
  }, { passive: true });

  $('#btnCarrito').addEventListener('click', abrirCarrito);
  $('#lineas').addEventListener('click', e => {
    const q = e.target.closest('[data-quitar]');
    const d = e.target.closest('[data-delta]');
    if (q) st.carrito = st.carrito.filter(l => l.id !== q.dataset.quitar);
    else if (d) {
      const l = st.carrito.find(x => x.id === d.dataset.linea);
      if (l) l.cantidad = Math.max(1, Math.min(20, l.cantidad + Number(d.dataset.delta)));
    } else return;
    guardarCarrito();
  });
  $('#btnSeguir').addEventListener('click', () => { if (st.paso === 'carrito') irPaso('compra'); else pagar(); });
  $('#volverCarrito').addEventListener('click', () => irPaso('carrito'));
  $('#formCompra').addEventListener('change', e => { if (e.target.name === 'provincia' || e.target.name === 'metodo') actualizarEnvio(); });
  $('#formCompra').addEventListener('input', e => e.target.removeAttribute('aria-invalid'));
  $('#formCompra').addEventListener('submit', e => { e.preventDefault(); pagar(); });
  $('#pasoCompra').addEventListener('click', e => { if (e.target.id === 'cambiarCuenta') cerrarSesion(); });

  $('#btnCuenta').addEventListener('click', () => { if (!st.sesion && !DEMO) location.href = 'login.html?volver=cuenta'; else abrirCuenta(); });
  $('#linkMisPedidos').addEventListener('click', e => { e.preventDefault(); abrirCuenta(); });
  $('#btnSalir').addEventListener('click', () => cerrarSesion());

  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && !img.dataset.fallo) { img.dataset.fallo = '1'; img.style.visibility = 'hidden'; }
  }, true);
  const barra = $('#barra');
  window.addEventListener('scroll', () => barra.classList.toggle('con-borde', scrollY > 8), { passive: true });

  if (DEMO) document.body.insertAdjacentHTML('afterbegin', '<div class="demo-banda">Modo demostración: productos de ejemplo, los pagos no son reales.</div>');

  /* ---------- Firma que se escribe al entrar al inicio ---------- */
  function escribirFirma() {
    const portada = $('.portada');
    if (!portada) return;
    portada.classList.remove('escribe', 'escrito');
    const arrancar = () => {
      void portada.offsetWidth; // reinicia la animación
      portada.classList.add('escribe');
      setTimeout(() => {
        portada.classList.add('escrito'); portada.classList.remove('escribe');
        const pasada = document.getElementById('firmaPasada');
        try { if (pasada && !matchMedia('(prefers-reduced-motion: reduce)').matches) pasada.beginElement(); } catch (_) {}
      }, 3400);
    };
    const fuente = document.fonts && document.fonts.load ? document.fonts.load('400 1em "Pinyon Script"') : Promise.resolve();
    Promise.race([fuente, new Promise(r => setTimeout(r, 1500))]).then(arrancar, arrancar);
  }
  // Volver al inicio (logo o "volver") vuelve a escribir la firma, sin recargar
  document.addEventListener('click', e => {
    const a = e.target.closest('a.marca');
    if (!a || a.closest('dialog')) return;
    e.preventDefault();
    $$('dialog').forEach(d => d.open && d.close());
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(escribirFirma, 250);
  });
  window.addEventListener('pageshow', e => { if (e.persisted) escribirFirma(); });

  /* ---------- Inicio ---------- */
  escribirFirma();
  guardarCarrito();
  iniciarBrillo();
  iniciarGoogle();
  cargarCatalogo();
  revisarVuelta();
})();
