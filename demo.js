// Catálogo de ejemplo para el "modo demostración" (cuando config.js no tiene API_URL).
// La tienda real lee los productos de la planilla.
(function () {
  const U = 'https://armonyfabricantes.com.ar/wp-content/uploads/';
  const base = [
    ['VESTIDO SOPHIE LISO', 'VESTIDOS, Largos', 14000, 0, ['Negro', 'Beige claro', 'Verde pistacho', 'Rojo'], ['Único'], ['2026/10/WhatsApp-Image-2026-10-09-at-15.04.43-2-600x800.jpeg', '2026/10/WhatsApp-Image-2026-10-07-at-09.29.15-2-600x800.jpeg']],
    ['CONJUNTO CARIBE LISO', 'CONJUNTOS | ENTERIZOS', 13600, 81600, ['Negro', 'Blanco', 'Rosa'], ['1', '2', '3'], ['2026/10/WhatsApp-Image-2026-10-29-at-14.59.58-1-601x800.jpeg', '2026/10/WhatsApp-Image-2026-10-29-at-16.15.16-608x800.jpeg']],
    ['BLUSA CANDELA LISO', 'CAMISAS | BLUSAS | BODYS', 8900, 0, ['Blanco', 'Celeste', 'Lila'], ['Único'], ['2026/10/WhatsApp-Image-2026-10-01-at-17.37.08-2-1067x800.jpeg', '2026/10/WhatsApp-Image-2026-10-28-at-11.21.18-1-450x800.jpeg']],
    ['VESTIDO LONDRES ALGODON', 'VESTIDOS, Largos', 21000, 0, ['Marron', 'Marron claro', 'Negro'], ['Único'], ['2026/10/WhatsApp-Image-2026-10-16-at-08.49.15-1-600x800.jpeg', '2026/10/WhatsApp-Image-2026-10-15-at-09.47.45-600x800.jpeg']],
    ['VESTIDO CORTO LAURA', 'VESTIDOS, Cortos', 13200, 79200, ['Negro', 'Bordo', 'Verde'], ['1', '2'], ['2026/08/ChatGPT-Image-24-ago-2026-11_48_23-618x800.png', '2026/08/WhatsApp-Image-2026-08-24-at-10.17.28-600x800.jpeg']],
    ['BLUSA PERLARY LISO', 'CAMISAS | BLUSAS | BODYS', 9300, 0, ['Blanco', 'Negro', 'Beige'], ['Único'], ['2026/10/WhatsApp-Image-2026-09-18-at-08.51.16-1-1066x800.jpeg', '2026/10/WhatsApp-Image-2026-10-27-at-16.37.08-3-603x800.jpeg']],
    ['CONJUNTO GISEL', 'CONJUNTOS | ENTERIZOS', 11900, 71400, ['Negro', 'Gris', 'Rosa'], ['1', '2', '3'], ['2026/10/WhatsApp-Image-2026-10-29-at-14.58.41-580x800.jpeg', '2026/10/WhatsApp-Image-2026-10-29-at-11.43.19-605x800.jpeg']],
    ['BLUSA PERLARY COLORIDA', 'CAMISAS | BLUSAS | BODYS', 7900, 47400, ['Amarillo', 'Rosa', 'Celeste'], ['Único'], ['2026/08/WhatsApp-Image-2026-08-24-at-11.10.37-600x800.jpeg', '2026/08/be2d8b6e-5e72-41ac-bc2a-7215384cf792-615x800.jpg']],
    ['BLUSA LIBERTY', 'CAMISAS | BLUSAS | BODYS', 11800, 70800, ['Blanco', 'Negro'], ['1', '2'], ['2026/09/0f6a31c5-9eb6-42f7-baa8-8a2f2ce8bd23-608x800.jpg', '2026/09/b63fbf5d-1e97-4f56-bbe5-b4f5c713ce93-622x800.jpg']],
    ['VESTIDO LISBOA LARGO', 'VESTIDOS, Largos', 16400, 98400, ['Beige oscuro', 'Verde pistacho', 'Rojo', 'Amarillo'], ['2', '3'], ['2026/10/WhatsApp-Image-2026-10-31-at-15.33.17-1-600x800.jpeg', '2026/10/WhatsApp-Image-2026-10-31-at-11.50.53-1-605x800.jpeg']],
    ['VESTIDO VENECIA ESTAMPADO', 'VESTIDOS, Cortos', 15700, 94200, ['Estampado azul', 'Estampado rosa'], ['Único'], ['2026/10/WhatsApp-Image-2026-10-30-at-13.12.10-601x800.jpeg', '2026/10/WhatsApp-Image-2026-10-31-at-15.08.27-601x800.jpeg']],
    ['BLUSA CARMELIA', 'CAMISAS | BLUSAS | BODYS', 11000, 66000, ['Blanco', 'Rosa', 'Celeste'], ['Único'], ['2026/10/WhatsApp-Image-2026-10-31-at-13.39.25-600x800.jpeg', '2026/10/WhatsApp-Image-2026-10-31-at-11.50.26-604x800.jpeg']],
    ['CONJUNTO BILBOA LISO', 'CONJUNTOS | ENTERIZOS', 13800, 82800, ['Negro', 'Beige'], ['1', '2'], ['2026/10/WhatsApp-Image-2026-10-30-at-13.00.50-1-601x800.jpeg', '2026/10/WhatsApp-Image-2026-10-30-at-11.55.38-603x800.jpeg']],
    ['CONJUNTO DULCE', 'CONJUNTOS | ENTERIZOS', 14100, 84600, ['Rosa', 'Lila', 'Verde agua'], ['Único'], ['2026/10/WhatsApp-Image-2026-10-30-at-13.00.46-533x800.jpeg', '2026/10/WhatsApp-Image-2026-10-30-at-14.05.21-1-600x800.jpeg']],
    ['SWEATER MILÁN', 'SWEATER', 12900, 77400, ['Crema', 'Gris', 'Negro'], ['Único'], ['2026/10/WhatsApp-Image-2026-09-29-at-19.46.43-2-601x800.jpeg', '2026/10/WhatsApp-Image-2026-10-30-at-13.15.13-602x800.jpeg']],
    ['PANTALÓN PALAZZO', 'POLLERAS | PANTALONES | SHORT', 12500, 0, ['Negro', 'Beige', 'Blanco'], ['1', '2', '3'], ['2026/10/WhatsApp-Image-2026-10-31-at-11.54.26-600x800.jpeg', '2026/10/WhatsApp-Image-2026-10-31-at-11.49.11-600x800.jpeg']]
  ];
  let n = 1000;
  const productos = base.map(([nombre, cat, unidad, pack, colores, talles, fotos], k) => {
    const variantes = [];
    colores.forEach((color, ci) => talles.forEach((talle, ti) => {
      variantes.push({ id: String(n++), color, talle, tipo: 'Unidad', precio: unidad * 2.5, stock: !(k % 5 === 1 && ci === 0 && ti === 0), imagen: U + fotos[ci % fotos.length] });
      if (pack) variantes.push({ id: String(n++), color, talle, tipo: 'Pack x6', precio: pack * 2, stock: true, imagen: U + fotos[ci % fotos.length] });
    }));
    return {
      id: String(500 + k), nombre,
      categorias: cat.split(',').map(s => s.trim()),
      descripcion: 'Tela: Cey (no arruga)\nTalle: según la tabla del producto\nConsultanos por medidas.',
      imagenes: fotos.map(f => U + f),
      variantes
    };
  });
  window.COQUET_DEMO = {
    tienda: 'Coquette', cuotas: 12,
    provincias: ['CABA', 'Buenos Aires (GBA)', 'Buenos Aires (interior)', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'],
    envios: [
      { zona: 'AMBA', provincias: ['CABA', 'Buenos Aires (GBA)'], domicilio: 6500, sucursal: 4800 },
      { zona: 'Centro', provincias: ['Córdoba', 'Santa Fe', 'Entre Ríos', 'La Pampa'], domicilio: 8900, sucursal: 6700 }
    ],
    productos,
    actualizado: new Date().toISOString()
  };
})();
