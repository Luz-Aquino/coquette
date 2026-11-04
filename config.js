// Configuración de la tienda Coquette.
// Mientras API_URL esté vacío, la tienda funciona en "modo demostración" con productos de ejemplo.
window.COQUET_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxpAf2FKmJu0FpBbGN6KoljtPITXbsZ19OX9TSSCHSaha3sPOckiwKLU6Yed5q6zi_-/exec',          // URL de la app web de Apps Script (termina en /exec)
  GOOGLE_CLIENT_ID: '468284812442-1lkcvjgo52rjcknkrf53p07t41vi69t9.apps.googleusercontent.com', // ID de cliente OAuth de Google (termina en .apps.googleusercontent.com)
  NOMBRE: 'Coquette',
  MINIMO_COMPRA: 100000, // compra mínima en productos (sin envío)
  WHATSAPP: '', // ← cuando tengas la línea, poné acá el número y aparece el botón. Número con código de país, ej: '5491122334455'. Vacío = sin botón
  DESCUENTO: { CODIGO: 'HOLA10', PORCENTAJE: 10 }, // solo para mostrar; el servidor es quien lo valida
  // Dueña de la tienda (email guardado como huella SHA-256, así no queda público): ve su panel y no tiene carrito
  DUENA_HASH: ['2cda54c204274cbec75542edf76aa0a34397423b52e086ad6a92ed739a83c7a0'],
  CONTACTO_EMAIL: 'hola.novafamilymarket@gmail.com',
  FACEBOOK: '',  // usuario o página, ej: 'coquette.nfm' (vacío = logo sin link)
  INSTAGRAM: '', // usuario sin @, ej: 'coquette.nfm' (vacío = logo sin link)
  TIKTOK: '',    // usuario sin @
  CAMBIOS_DIAS: 5 // días para cambios desde que recibe el pedido (0 = no se muestra)
};
