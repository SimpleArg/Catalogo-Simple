// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE FIREBASE — completá con los datos de tu proyecto.
// Firebase Console → Configuración del proyecto → Tus apps → App web (</>)
// Estos valores NO son secretos: la seguridad real está en firestore.rules.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyAXT7FmKCtzeRusx5i8NIYGiQAFey3Vsdw",
    authDomain: "catalogo-3eacb.firebaseapp.com",
    projectId: "catalogo-3eacb",
    storageBucket: "catalogo-3eacb.firebasestorage.app",
    messagingSenderId: "422329615022",
    appId: "1:422329615022:web:1a19f806a15f2a18b2a33f"
};

// Datos de la tienda en un solo lugar
export const STORE = {
  whatsappPedidos: "5493434747844",   // número que recibe el pedido del carrito (checkout)
  // Categorías del nav, en orden. "value" es el identificador guardado en cada producto.
  categories: [
    { value: "cabello",    label: "Cabello" },
    { value: "rostro",     label: "Rostro" },
    { value: "cuerpo",     label: "Cuerpo" },
    { value: "maquillaje", label: "Maquillaje" },
    { value: "otros",      label: "Otros" }
  ]
};
