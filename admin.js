/* Coquette — panel de administración */
(() => {
  'use strict';
  const CFG = window.COQUET_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const fmt = n => n === '' || n == null ? '—' : '$' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { token: null, email: '', pedidos: [], estados: [], filtro: 'activos', q: '', pubs: null, filtroPub: 'Pendiente', qPub: '' };
  const ACTIVOS = ['Pagado', 'Preparando', 'Revisar pago', 'Pago pendiente'];

  function tostada(msg) {
    const t = $('#tostada');
    t.textContent = msg; t.hidden = false;
    clearTimeout(tostada.t); tostada.t = setTimeout(() => { t.hidden = true; }, 3000);
  }

  async function post(body) {
    if (DEMO) return demo(body);
    const r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    return r.json();
  }

  /* ---------- Ingreso ---------- */
  function decodificar(t) {
    try { let b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return JSON.parse(atob(b)); } catch (_) { return null; }
  }
  async function ingresar(token) {
    const d = DEMO ? { email: 'luzaquino84@gmail.com', exp: Date.now() / 1000 + 3600 } : decodificar(token);
    if (!d) return;
    st.token = token; st.email = d.email; st.exp = d.exp;
    try { sessionStorage.setItem('coquet_admin', JSON.stringify({ token, email: d.email, exp: d.exp })); } catch (_) {}
    const ok = await cargar();
    if (!ok) return;
    $('#ingreso').hidden = true;
    $('#panel').hidden = false;
    $('#adminEmail').textContent = st.email;
    $('#btnSalir').hidden = false;
    cargarPublicaciones(true);
  }
  function salir() {
    try { sessionStorage.removeItem('coquet_admin'); localStorage.removeItem('coquet_admin_desde_tienda'); } catch (_) {}
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (_) {}
    location.reload();
  }
  function error(msg) { const e = $('#errorIngreso'); if (!e) return; e.textContent = msg; e.hidden = !msg; }

  function iniciar() {
    let ses = null;
    try { ses = JSON.parse(sessionStorage.getItem('coquet_admin')); } catch (_) {}
    if (!ses || ses.exp * 1000 < Date.now() + 60000) { try { ses = JSON.parse(localStorage.getItem('coquet_admin_desde_tienda')); } catch (_) {} }
    if (ses && ses.exp * 1000 > Date.now() + 60000) {
      // Ya venía con sesión: mostramos "Entrando…" en vez del botón de Google
      $('#ingreso').innerHTML = '<p class="entrando">Entrando a tu panel…</p>';
      ingresar(ses.token).then(() => { if ($('#panel').hidden) location.reload(); }, () => location.reload());
      return;
    }
    if (DEMO || !CFG.GOOGLE_CLIENT_ID) {
      $('#googleAdmin').innerHTML = '<button class="boton principal">Entrar al panel de demostración</button>';
      $('#googleAdmin button').onclick = () => ingresar('demo');
      return;
    }
    let n = 0;
    (function esperar() {
      if (!(window.google && google.accounts && google.accounts.id)) { if (n++ < 100) setTimeout(esperar, 150); return; }
      google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: r => ingresar(r.credential) });
      google.accounts.id.renderButton($('#googleAdmin'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es-419' });
    })();
  }

  /* ---------- Pedidos ---------- */
  async function cargar() {
    if (!DEMO && st.exp * 1000 < Date.now() + 30000) { error('Tu sesión venció. Volvé a ingresar.'); $('#panel').hidden = true; $('#ingreso').hidden = false; return false; }
    $('#lista').innerHTML = '<p>Cargando pedidos…</p>';
    try {
      const r = await post({ action: 'admin', op: 'pedidos', idToken: st.token });
      if (r.error) throw new Error(r.error);
      st.pedidos = r.pedidos; st.estados = r.estados;
      error('');
      pintar();
      return true;
    } catch (e) {
      error(e.message);
      $('#lista').innerHTML = '';
      try { sessionStorage.removeItem('coquet_admin'); localStorage.removeItem('coquet_admin_desde_tienda'); } catch (_) {}
      return false;
    }
  }

  function pintar() {
    const ps = st.pedidos;
    const mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
    const pagos = ps.filter(p => ['Pagado', 'Preparando', 'Enviado', 'Entregado'].indexOf(p.estado) >= 0);
    const delMes = pagos.filter(p => new Date(p.fecha) >= mes);
    const porPreparar = ps.filter(p => p.estado === 'Pagado' || p.estado === 'Preparando').length;
    $('#resumen').innerHTML = `
      <div class="destacado"><b>${porPreparar}</b><span>Para preparar y enviar</span></div>
      <div><b>${fmt(delMes.reduce((s, p) => s + Number(p.total || 0), 0))}</b><span>Vendido este mes (${delMes.length} pedidos)</span></div>
      <div><b>${ps.filter(p => p.estado === 'Revisar pago').length}</b><span>Pagos para revisar</span></div>`;

    const cuenta = e => e === 'activos' ? ps.filter(p => ACTIVOS.indexOf(p.estado) >= 0).length : e === 'todos' ? ps.length : ps.filter(p => p.estado === e).length;
    const filtros = ['activos', 'todos'].concat(st.estados.filter(e => cuenta(e)));
    const nombre = e => e === 'activos' ? 'Para atender' : e === 'todos' ? 'Todos' : e;
    $('#filtros').innerHTML = filtros.map(e => `<button class="chip" data-f="${esc(e)}" aria-pressed="${st.filtro === e}">${esc(nombre(e))}<span>${cuenta(e)}</span></button>`).join('');

    const q = st.q.toLowerCase().trim();
    const lista = ps.filter(p => {
      if (st.filtro === 'activos' && ACTIVOS.indexOf(p.estado) < 0) return false;
      if (st.filtro !== 'activos' && st.filtro !== 'todos' && p.estado !== st.filtro) return false;
      return !q || [p.pedido, p.cliente, p.email, p.telefono].join(' ').toLowerCase().includes(q);
    });
    $('#lista').innerHTML = lista.length ? lista.map(tarjeta).join('') : '<div class="vacio"><p>No hay pedidos en esta vista.</p></div>';
  }

  function tarjeta(p) {
    const fecha = new Date(p.fecha);
    const items = (p.items || []).map(l => `<li>
        <img src="${esc(l.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span>${l.cantidad}× ${esc(l.nombre)}<small>${esc(l.detalle)}</small>${l.link ? `<a href="${esc(l.link)}" target="_blank" rel="noopener">Comprar en Armony</a>` : ''}</span>
        <b>${fmt(l.precio * l.cantidad)}</b></li>`).join('');
    const direccion = [p.direccion, p.ciudad, p.provincia, p.cp ? 'CP ' + p.cp : ''].filter(Boolean).join(', ');
    const opciones = st.estados.map(e => `<option ${e === p.estado ? 'selected' : ''}>${esc(e)}</option>`).join('');
    return `<details class="pedido" data-id="${esc(p.pedido)}">
      <summary>
        <span><span class="pedido-id">${esc(p.pedido)}</span> <span class="estado ${esc(String(p.estado).replace(/\s+/g, '-'))}">${esc(p.estado)}</span></span>
        <span class="pedido-total">${fmt(p.total)}</span>
        <span class="pedido-quien">${esc(p.cliente)} · ${fecha.toLocaleDateString('es-AR')} ${fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="pedido-quien" style="text-align:right">${esc(p.provincia)}</span>
      </summary>
      <div class="pedido-cuerpo">
        <h3>Productos</h3>
        <ul class="items">${items}</ul>
        <dl class="datos" style="margin-top:10px">
          <dt>Productos</dt><dd>${fmt(p.subtotal)}</dd>
          <dt>Envío</dt><dd>${p.costoEnvio === '' ? 'A coordinar' : fmt(p.costoEnvio)}</dd>
          <dt>Total</dt><dd><b>${fmt(p.total)}</b></dd>
        </dl>
        <h3>Clienta y envío</h3>
        <dl class="datos">
          <dt>Nombre</dt><dd>${esc(p.cliente)}${p.dni ? ' · DNI ' + esc(p.dni) : ''}</dd>
          <dt>Email</dt><dd><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></dd>
          <dt>Teléfono</dt><dd><a href="https://wa.me/${esc(String(p.telefono).replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(p.telefono)}</a></dd>
          <dt>Envío</dt><dd>${esc(p.envio)}</dd>
          <dt>Dirección</dt><dd>${esc(direccion)}</dd>
          <dt>Mercado Pago</dt><dd>${p.pagoMP ? 'Pago n° ' + esc(p.pagoMP) + ' (' + esc(p.estadoMP) + ')' : 'Sin pago todavía'}</dd>
        </dl>
        <form class="acciones" data-form="${esc(p.pedido)}">
          <label>Estado<select name="estado">${opciones}</select></label>
          <label>N° de seguimiento Correo Argentino<input name="seguimiento" value="${esc(p.seguimiento)}" autocomplete="off"></label>
          <label class="ancha">Notas internas<textarea name="notas">${esc(p.notas)}</textarea></label>
          <div class="fila ancha">
            <button class="boton principal" type="submit">Guardar cambios</button>
            <button class="boton secundario" type="button" data-copiar>Copiar datos de envío</button>
          </div>
          <small class="ancha">Al pasar el pedido a "Enviado" le llega un mail a la clienta con el número de seguimiento.</small>
        </form>
      </div>
    </details>`;
  }

  async function guardarPedido(form) {
    const id = form.dataset.form;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Guardando…';
    const datos = { estado: form.estado.value, seguimiento: form.seguimiento.value, notas: form.notas.value };
    if (datos.estado === 'Enviado' && !datos.seguimiento.trim() && !confirmar(form)) { btn.disabled = false; btn.textContent = 'Guardar cambios'; return; }
    try {
      const r = await post(Object.assign({ action: 'admin', op: 'actualizar', idToken: st.token, pedido: id }, datos));
      if (r.error) throw new Error(r.error);
      Object.assign(st.pedidos.find(p => p.pedido === id), datos);
      tostada(r.avisoEnviado ? 'Guardado. Le avisamos a la clienta por mail.' : 'Guardado.');
      pintar();
      const abierto = document.querySelector(`.pedido[data-id="${CSS.escape(id)}"]`);
      if (abierto) abierto.open = true;
    } catch (e) {
      tostada(e.message);
      btn.disabled = false; btn.textContent = 'Guardar cambios';
    }
  }
  function confirmar(form) {
    if (form.dataset.avisado) return true;
    form.dataset.avisado = '1';
    tostada('Falta el número de seguimiento. Tocá Guardar otra vez para enviar igual.');
    return false;
  }

  /* ---------- Publicaciones ---------- */
  const TIENDA_URL = (CFG.SITE_URL || 'https://coquette.novafamilymarket.com/').replace(/\/?$/, '/');
  async function cargarPublicaciones(silencioso) {
    if (!silencioso) $('#listaPub').innerHTML = '<p>Cargando productos…</p>';
    try {
      const r = await post({ action: 'admin', op: 'publicaciones', idToken: st.token });
      if (r.error) throw new Error(r.error);
      st.pubs = r.productos;
      const n = st.pubs.filter(p => p.estado === 'Pendiente').length;
      $('#nPendientes').hidden = !n; $('#nPendientes').textContent = n;
      pintarPublicaciones();
    } catch (e) { if (!silencioso) $('#listaPub').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  const rango = (a, b) => a === b ? fmt(a) : `${fmt(a)} a ${fmt(b)}`;
  const NOMBRE_TIPO = { 'Unidad': 'Por unidad', 'Promo x3': 'Promo x3', 'Pack x6': 'Pack x6' };
  function pintarPublicaciones() {
    if (!st.pubs) return;
    const ps = st.pubs;
    const grupos = { Pendiente: p => p.estado === 'Pendiente', avisos: p => p.avisos.length > 0, Publicado: p => p.estado === 'Publicado', Oculto: p => p.estado === 'Oculto', todos: () => true };
    const nombres = { Pendiente: 'Para revisar', avisos: '⚠️ Con avisos', Publicado: 'Publicados', Oculto: 'Ocultos', todos: 'Todos' };
    $('#filtrosPub').innerHTML = Object.keys(grupos).map(k => `<button class="chip" data-fp="${k}" aria-pressed="${st.filtroPub === k}">${nombres[k]}<span>${ps.filter(grupos[k]).length}</span></button>`).join('');
    const q = st.qPub.toLowerCase().trim();
    const lista = ps.filter(grupos[st.filtroPub]).filter(p => !q || p.nombre.toLowerCase().includes(q));
    $('#listaPub').innerHTML = lista.length ? lista.map(pubHtml).join('') : `<div class="vacio"><p>${st.filtroPub === 'Pendiente' ? 'No hay productos esperando. Cuando Armony publique algo nuevo, aparece acá.' : 'No hay productos en esta vista.'}</p></div>`;
  }
  function pubHtml(p) {
    const precios = Object.keys(p.tipos).sort((a, b) => ['Unidad', 'Promo x3', 'Pack x6'].indexOf(a) - ['Unidad', 'Promo x3', 'Pack x6'].indexOf(b)).map(t => {
      const x = p.tipos[t];
      return `<li><b>${esc(NOMBRE_TIPO[t] || t)}</b> ${rango(x.min, x.max)} <small>costo ${rango(x.costoMin, x.costoMax)}</small></li>`;
    }).join('');
    const avisos = p.avisos.length ? `<div class="pub-aviso"><b>⚠️ ${p.avisos.length === 1 ? '1 variante con precio dudoso' : p.avisos.length + ' variantes con precio dudoso'}</b> (no se venden hasta que se corrija)
        <ul>${p.avisos.slice(0, 12).map(a => `<li>${esc(a.variante)} · costo ${fmt(a.costo)} — ${esc(a.motivo)}</li>`).join('')}${p.avisos.length > 12 ? `<li>…y ${p.avisos.length - 12} más</li>` : ''}</ul></div>` : '';
    const etiqueta = { Pendiente: 'Para revisar', Publicado: 'Publicado', Oculto: 'Oculto' }[p.estado] || p.estado;
    const botones = [
      p.estado !== 'Publicado' ? `<button class="boton principal" data-pub="${esc(p.id)}" data-estado="Publicado">Publicar en la tienda</button>` : '',
      p.estado !== 'Oculto' ? `<button class="boton secundario" data-pub="${esc(p.id)}" data-estado="Oculto">${p.estado === 'Publicado' ? 'Ocultar de la tienda' : 'No publicar'}</button>` : ''
    ].join('');
    return `<article class="pub ${esc(p.estado)}">
        <img class="pub-foto" src="${esc(p.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="pub-info">
          <div class="pub-cabeza"><h3>${esc(p.nombre)}</h3><span class="estado pub-${esc(p.estado)}">${esc(etiqueta)}</span></div>
          <p class="pub-meta">${esc(p.categoria)} · ${p.conStock} de ${p.variantes} variantes con stock${p.detectado ? ' · llegó el ' + new Date(p.detectado).toLocaleDateString('es-AR') : ''}</p>
          <ul class="pub-precios">${precios || '<li>Sin precios válidos todavía</li>'}</ul>
          ${avisos}
          <p class="pub-links"><a href="${esc(p.link)}" target="_blank" rel="noopener">Ver publicación original en Armony ↗</a>${p.estado === 'Publicado' ? ` · <a href="${TIENDA_URL}#p-${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Ver en mi tienda ↗</a>` : ''}</p>
          <div class="pub-botones">${botones}</div>
        </div>
      </article>`;
  }
  async function cambiarPublicacion(btn) {
    const id = btn.dataset.pub, estado = btn.dataset.estado;
    btn.disabled = true;
    try {
      const r = await post({ action: 'admin', op: 'publicar', idToken: st.token, pid: id, estado });
      if (r.error) throw new Error(r.error);
      st.pubs.find(p => p.id === id).estado = estado;
      const n = st.pubs.filter(p => p.estado === 'Pendiente').length;
      $('#nPendientes').hidden = !n; $('#nPendientes').textContent = n;
      tostada(estado === 'Publicado' ? 'Publicado: ya se ve en la tienda.' : 'Listo: no se muestra en la tienda.');
      pintarPublicaciones();
    } catch (e) { tostada(e.message); btn.disabled = false; }
  }
  function verVista(v) {
    $$('.pestanas [data-vista]').forEach(b => b.setAttribute('aria-pressed', b.dataset.vista === v));
    $('#vistaPedidos').hidden = v !== 'pedidos';
    $('#vistaPublicaciones').hidden = v !== 'publicaciones';
    if (v === 'publicaciones' && !st.pubs) cargarPublicaciones();
  }

  /* ---------- Eventos ---------- */
  $$('.pestanas [data-vista]').forEach(b => b.addEventListener('click', () => verVista(b.dataset.vista)));
  $('#filtrosPub').addEventListener('click', e => { const b = e.target.closest('[data-fp]'); if (b) { st.filtroPub = b.dataset.fp; pintarPublicaciones(); } });
  $('#buscarPub').addEventListener('input', e => { st.qPub = e.target.value; pintarPublicaciones(); });
  $('#btnRecargarPub').addEventListener('click', () => cargarPublicaciones());
  $('#listaPub').addEventListener('click', e => { const b = e.target.closest('[data-pub]'); if (b) cambiarPublicacion(b); });
  $('#filtros').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { st.filtro = b.dataset.f; pintar(); } });
  $('#buscar').addEventListener('input', e => { st.q = e.target.value; pintar(); });
  $('#btnRecargar').addEventListener('click', cargar);
  $('#btnSalir').addEventListener('click', salir);
  $('#lista').addEventListener('submit', e => { e.preventDefault(); guardarPedido(e.target); });
  $('#lista').addEventListener('click', async e => {
    if (!e.target.closest('[data-copiar]')) return;
    const id = e.target.closest('form').dataset.form;
    const p = st.pedidos.find(x => x.pedido === id);
    const txt = [p.cliente, p.dni ? 'DNI ' + p.dni : '', p.telefono, p.envio, p.direccion, `${p.ciudad}, ${p.provincia}`, 'CP ' + p.cp].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(txt); tostada('Datos copiados.'); } catch (_) { tostada('No se pudo copiar.'); }
  });

  /* ---------- Datos de demostración ---------- */
  function demo(b) {
    if (b.op === 'publicar') return Promise.resolve({ ok: true });
    if (b.op === 'publicaciones') {
      const img = 'https://armonyfabricantes.com.ar/wp-content/uploads/2026/10/WhatsApp-Image-2026-10-09-at-15.04.43-2-600x800.jpeg';
      return Promise.resolve({ productos: [
        { id: '9001', nombre: 'VESTIDO PUCCA', categoria: 'VESTIDOS', link: 'https://armonyfabricantes.com.ar/', imagen: img, estado: 'Pendiente', detectado: new Date().toISOString(), variantes: 18, conStock: 18, tipos: { 'Unidad': { min: 35000, max: 35000, costoMin: 14000, costoMax: 14000 }, 'Pack x6': { min: 168000, max: 168000, costoMin: 84000, costoMax: 84000 } }, avisos: [] },
        { id: '9002', nombre: 'VESTIDO CORTO LISBOA LISO', categoria: 'VESTIDOS', link: 'https://armonyfabricantes.com.ar/', imagen: img, estado: 'Pendiente', detectado: new Date().toISOString(), variantes: 27, conStock: 27, tipos: { 'Unidad': { min: 41000, max: 41000, costoMin: 16400, costoMax: 16400 }, 'Pack x6': { min: 196800, max: 196800, costoMin: 98400, costoMax: 98400 } }, avisos: [{ variante: 'Blanco / 4 / Unidad: x6 Surtidas', costo: 16400, motivo: 'Precio muy distinto al resto (Pack x6: $16400 y lo normal es $98400)' }] },
        { id: '9003', nombre: 'BLUSA CANDELA LISO', categoria: 'CAMISAS | BLUSAS | BODYS', link: 'https://armonyfabricantes.com.ar/', imagen: img, estado: 'Publicado', detectado: '', variantes: 6, conStock: 4, tipos: { 'Unidad': { min: 22250, max: 22250, costoMin: 8900, costoMax: 8900 } }, avisos: [] }
      ] });
    }
    if (b.op === 'actualizar') return Promise.resolve({ ok: true, avisoEnviado: b.estado === 'Enviado' });
    const img = 'https://armonyfabricantes.com.ar/wp-content/uploads/2026/10/WhatsApp-Image-2026-10-09-at-15.04.43-2-600x800.jpeg';
    const hoy = Date.now();
    const p = (id, estado, cliente, prov, total, dias, items) => ({ pedido: id, estado, cliente, email: cliente.split(' ')[0].toLowerCase() + '@gmail.com', telefono: '11 5555-0000', dni: '30111222', envio: 'Correo Argentino a domicilio', direccion: 'Av. Siempreviva 742', ciudad: 'Lanús', provincia: prov, cp: '1824', subtotal: total - 6500, costoEnvio: 6500, total, fecha: new Date(hoy - dias * 864e5).toISOString(), pagoMP: '1234567890', estadoMP: 'approved / accredited', seguimiento: '', notas: '', items });
    return Promise.resolve({
      estados: ['Esperando pago', 'Pago pendiente', 'Pagado', 'Preparando', 'Enviado', 'Entregado', 'Pago rechazado', 'Cancelado', 'Revisar pago'],
      pedidos: [
        p('CQ261103-AB12', 'Pagado', 'Martina López', 'Buenos Aires (GBA)', 76500, 0, [{ nombre: 'VESTIDO SOPHIE LISO', detalle: 'Unidad · Negro · Único', cantidad: 2, precio: 35000, imagen: img, link: 'https://armonyfabricantes.com.ar/tienda/' }]),
        p('CQ261102-ZX9P', 'Preparando', 'Carla Gómez', 'CABA', 169700, 1, [{ nombre: 'CONJUNTO CARIBE LISO', detalle: 'Pack x6 · Negro · 2', cantidad: 1, precio: 163200, imagen: img, link: 'https://armonyfabricantes.com.ar/tienda/' }]),
        p('CQ261030-MM3Q', 'Enviado', 'Sofía Díaz', 'Córdoba', 41500, 4, [{ nombre: 'BLUSA CANDELA LISO', detalle: 'Unidad · Blanco · Único', cantidad: 1, precio: 22250, imagen: img, link: '' }])
      ]
    });
  }

  if (DEMO) document.body.insertAdjacentHTML('afterbegin', '<div class="demo-banda">Modo demostración: pedidos de ejemplo.</div>');
  iniciar();
})();
