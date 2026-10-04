// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE FIREBASE — completá con los datos de tu proyecto.
// Firebase Console → Configuración del proyecto → Tus apps → App web (</>)
// Estos valores NO son secretos: la seguridad real está en firestore.rules.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "PEGAR_AQUI",
  authDomain: "PEGAR_AQUI.firebaseapp.com",
  projectId: "PEGAR_AQUI",
  storageBucket: "PEGAR_AQUI.appspot.com", // no se usa (las imágenes están en el repo)
  messagingSenderId: "PEGAR_AQUI",
  appId: "PEGAR_AQUI"
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
