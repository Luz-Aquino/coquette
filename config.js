// Configuración de la tienda Coquette.
// Mientras API_URL esté vacío, la tienda funciona en "modo demostración" con productos de ejemplo.
window.COQUET_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxpAf2FKmJu0FpBbGN6KoljtPITXbsZ19OX9TSSCHSaha3sPOckiwKLU6Yed5q6zi_-/exec',          // URL de la app web de Apps Script (termina en /exec)
  GOOGLE_CLIENT_ID: '468284812442-1lkcvjgo52rjcknkrf53p07t41vi69t9.apps.googleusercontent.com', // ID de cliente OAuth de Google (termina en .apps.googleusercontent.com)
  NOMBRE: 'Coquette',
  MINIMO_COMPRA: 100000, // compra mínima en productos (sin envío)
  WHATSAPP: '', // ← cuando tengas la línea, poné acá el número y aparece el botón. Número con código de país, ej: '5491122334455'. Vacío = sin botón
  DESCUENTO: { CODIGO: 'HOLA10', PORCENTAJE: 10 }, // solo para mostrar; el servidor es quien lo valida
  CONTACTO_EMAIL: 'hola.novafamilymarket@gmail.com',
  INSTAGRAM: '', // usuario sin @, ej: 'coquette.nfm' (vacío = no se muestra)
  TIKTOK: '',    // usuario sin @
  CAMBIOS_DIAS: 5 // días para cambios desde que recibe el pedido (0 = no se muestra)
};
