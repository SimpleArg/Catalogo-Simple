// ═══════════════════════════════════════════════════════════════
//  Simple — Cosmética Natural · app.js
//  Carrito + catálogo dinámico desde Firestore + panel de administración.
//  Se carga como módulo ES (<script type="module">), por eso las
//  funciones que el HTML llama con onclick se exponen en `window`.
// ═══════════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, where, onSnapshot, addDoc, setDoc, updateDoc,
  deleteDoc, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, STORE } from "./firebase-config.js";
import { SEED_PRODUCTS, SEED_PROMOS } from "./seed-data.js";

// ── ESTADO GLOBAL ───────────────────────────────────────────────
let cart = [];              // [{ id, name, price, qty }]
let products = [];          // productos recibidos de Firestore (con su id de documento)
let promos = [];            // promos recibidas de Firestore
let isAdmin = false;        // true cuando hay una sesión de Firebase Auth iniciada
let activeFilter = "all";   // filtro actual del nav
let adminTab = "products";  // pestaña del panel admin
let unsubs = [];            // listeners de Firestore activos (para cancelarlos al cambiar de modo)
let db = null, auth = null; // se inicializan si la config de Firebase está completa

const $ = (id) => document.getElementById(id);

// ── UTILIDADES ──────────────────────────────────────────────────
// Escapa texto antes de meterlo en HTML: ahora el contenido lo carga un admin, así que no se confía en él.
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
const toInt = (v) => parseInt(String(v).replace(/\D/g, ""), 10) || 0;   // "12.000" → 12000
const catLabel = (v) => (STORE.categories.find((c) => c.value === v) || { label: v }).label;
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name || a.title).localeCompare(String(b.name || b.title));

// ═══════════════════════════════════════════════════════════════
//  CARRITO (misma lógica de antes; ahora los ítems se identifican por id, no por nombre)
// ═══════════════════════════════════════════════════════════════
function addToCart(id, name, price) {
  const existing = cart.find((i) => i.id === id);
  if (existing) existing.qty++;
  else cart.push({ id, name, price, qty: 1 });
  updateCartUI();
  showToast("✓ " + name.split(" ").slice(0, 3).join(" ") + " agregado");
}

function updateCartUI() {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  $("cartCount").textContent = cart.reduce((s, i) => s + i.qty, 0);
  $("cartTotal").textContent = money(total);
  const itemsEl = $("cartItems");
  if (cart.length === 0) {
    itemsEl.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px 0;font-size:.9rem;">Tu carrito está vacío 🛍️</div>';
    return;
  }
  const qtyBtn = "width:26px;height:26px;border-radius:50%;border:1.5px solid var(--pink-mid);background:white;cursor:pointer;font-size:.9rem;display:flex;align-items:center;justify-content:center;color:var(--pink-btn);";
  itemsEl.innerHTML = cart.map((item, idx) => `
    <div style="display:flex;align-items:center;gap:12px;background:var(--pink);border-radius:12px;padding:12px 14px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:.82rem;font-weight:600;color:var(--dark);line-height:1.3;">${esc(item.name)}</div>
        <div style="font-size:.75rem;color:var(--muted);">${money(item.price)} c/u</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button data-action="qty" data-idx="${idx}" data-d="-1" style="${qtyBtn}">−</button>
        <span style="font-weight:700;font-size:.88rem;color:var(--dark);min-width:16px;text-align:center;">${item.qty}</span>
        <button data-action="qty" data-idx="${idx}" data-d="1" style="${qtyBtn}">+</button>
      </div>
      <div style="font-weight:700;font-size:.88rem;color:var(--pink-btn);min-width:55px;text-align:right;">${money(item.price * item.qty)}</div>
    </div>`).join("");
}

function changeQty(idx, delta) {
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  updateCartUI();
}

// Funciones llamadas desde onclick="" en index.html → hay que colgarlas de window
window.clearCart = () => { cart = []; updateCartUI(); };
window.toggleCart = () => {
  const m = $("cartModal");
  m.style.display = m.style.display === "none" ? "block" : "none";
  if (m.style.display === "block") updateCartUI();
};
window.closeCartOutside = (e) => { if (e.target === $("cartModal")) window.toggleCart(); };
window.checkout = () => {
  if (cart.length === 0) return;
  const msg = "¡Hola! Me gustaría encargar:%0A%0A" +
    cart.map((i) => `• ${i.name} x${i.qty} — ${money(i.price * i.qty)}`).join("%0A") +
    "%0A%0A*Total: " + money(cart.reduce((s, i) => s + i.price * i.qty, 0)) + "*";
  window.open(`https://wa.me/${STORE.whatsappPedidos}?text=${msg}`, "_blank");
};

// ── TOAST ───────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ═══════════════════════════════════════════════════════════════
//  RENDER DEL CATÁLOGO (genera exactamente el mismo HTML/clases que antes)
// ═══════════════════════════════════════════════════════════════
// Barra de acciones sobre cada tarjeta/promo: solo existe si el admin inició sesión
function adminBar(kind, item) {
  if (!isAdmin) return "";
  const d = `data-kind="${kind}" data-id="${item.id}"`;
  return `<div class="card-admin">
    <button class="a-btn" data-action="edit" ${d}>✏️ Editar</button>
    <button class="a-btn ${item.visible ? "" : "on"}" data-action="toggle-visible" ${d}>${item.visible ? "🙈 Ocultar" : "👁 Mostrar"}</button>
    <button class="a-btn danger" data-action="delete" ${d}>🗑</button></div>`;
}

// Precio que se muestra en el pie de la tarjeta
function priceHTML(p) {
  if (!p.variants?.length) return `${money(p.price)}`;
  const prices = p.variants.map((v) => v.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  return min === max ? `${money(min)} <small>${esc(p.priceNote || "c/u")}</small>` : `Desde ${money(min)}`;
}

function productCardHTML(p) {
  const isFamily = p.variants?.length > 0;
  const variants = isFamily ? `
    <button class="variants-toggle" data-action="toggle-variants">Ver variantes (${p.variants.length}) <span class="arrow">▼</span></button>
    <div class="variants-list">${p.variants.map((v, i) => `
      <div class="variant-row"><span class="variant-row-name">${esc(v.name)}</span><span class="variant-row-price">${money(v.price)}</span>
      <button class="btn-variant-add" data-action="add" data-id="${p.id}~${i}" data-name="${esc(p.name + " — " + v.name)}" data-price="${v.price}">+</button></div>`).join("")}
    </div>` : "";
  const footer = isFamily
    ? `<div class="card-footer"><div class="card-price">${priceHTML(p)}</div></div>`
    : `<div class="card-footer"><div class="card-price">${priceHTML(p)}</div>
       <button class="btn-add" data-action="add" data-id="${p.id}" data-name="${esc(p.name)}" data-price="${p.price}">Agregar</button></div>`;
  return `
  <div class="product-card ${isFamily ? "family-card" : ""} ${p.visible ? "" : "is-hidden"}">
    <div class="card-img">
      <img src="${esc(p.img)}" alt="${esc(p.name)}" data-emoji="${esc(p.emoji || "🌿")}" data-label="${esc(p.emojiLabel || p.name)}" />
      <span class="card-badge">${esc(catLabel(p.category))}</span>
    </div>
    <div class="card-body">
      <div class="card-name">${esc(p.name)} ${p.size ? `<small style="font-size:.75rem;font-weight:400;">${esc(p.size)}</small>` : ""}</div>
      <div class="card-desc">${esc(p.desc)}</div>
      ${p.indications ? `<div class="card-ingredients"><strong>${esc(p.indicationsLabel || "Indicaciones")}</strong> ${esc(p.indications)}</div>` : ""}
      ${variants}
    </div>
    ${footer}${adminBar("product", p)}
  </div>`;
}

function promoHTML(pr) {
  return `
  <div class="promo-banner ${pr.visible ? "" : "is-hidden"}" data-section="promo">
    <div class="promo-card">
      <div class="promo-left">
        <span class="promo-tag">${esc(pr.tag)}</span>
        <div class="promo-title">${esc(pr.title).replace(/\n/g, "<br>")}</div>
        <div class="promo-subtitle">${esc(pr.subtitle)}</div>
        <div class="promo-products">${esc(pr.detail)}</div>
      </div>
      <div class="promo-badge">
        <div class="promo-pct">${esc(pr.pct)}</div>
        <div class="promo-off">${esc(pr.pctLabel)}</div>
        <div class="card-footer"><div class="card-price">${money(pr.price)} 🏷️</div>
          <button class="btn-add" data-action="add" data-id="promo~${pr.id}" data-name="${esc(pr.cartName || pr.title)}" data-price="${pr.price}">Agregar</button></div>
      </div>
    </div>
    ${adminBar("promo", pr)}
  </div>`;
}

function render() {
  // Los visibles siempre; los ocultos solo llegan a `products` si el admin está logueado (lo filtra la query)
  const prods = [...products].sort(byOrder), prs = [...promos].sort(byOrder);

  // Nav: Todos + categorías con productos + Promos
  const cats = STORE.categories.filter((c) => isAdmin || prods.some((p) => p.category === c.value));
  $("navFilters").innerHTML =
    `<button class="nav-btn" data-filter="all">Todos</button>` +
    cats.map((c) => `<button class="nav-btn" data-filter="${c.value}">${esc(c.label)}</button>`).join("") +
    (prs.length ? `<button class="nav-btn" data-filter="promo">🏷️ Promos</button>` : "");

  $("promoContainer").innerHTML = prs.map(promoHTML).join("");

  $("catalog").innerHTML = cats.map((c) => {
    const items = prods.filter((p) => p.category === c.value);
    return `<section class="catalog-section" data-section="${c.value}">
      <div class="section-header"><h2 class="section-title"><em>${esc(c.label)}</em> </h2>
      <span class="section-count">${items.length} ${items.length === 1 ? "producto" : "productos"}</span></div>
      <div class="product-grid">${items.map(productCardHTML).join("")}</div></section>`;
  }).join("");

  $("catalogStatus").classList.toggle("hidden", prods.length > 0);
  if (!prods.length) $("catalogStatus").textContent = db ? "Todavía no hay productos para mostrar." : "Falta completar js/firebase-config.js";
  applyFilter();
  if (isAdmin) renderAdminPanel();
}

// Aplica el filtro del nav mostrando/ocultando con la clase .hidden (igual que antes)
function applyFilter() {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.filter === activeFilter));
  document.querySelectorAll("[data-section]").forEach((el) =>
    el.classList.toggle("hidden", activeFilter !== "all" && el.dataset.section !== activeFilter));
}

// Si una imagen no carga, se reemplaza por el recuadro con emoji (como el onerror original)
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG" || !img.dataset.emoji) return;
  const ph = document.createElement("div");
  ph.className = "card-img-placeholder";
  ph.innerHTML = `<span>${esc(img.dataset.emoji)}</span>${esc(img.dataset.label)}`;
  img.replaceWith(ph);
}, true); // "capture": los errores de carga de imágenes no burbujean

// ═══════════════════════════════════════════════════════════════
//  FIRESTORE: suscripción en tiempo real
// ═══════════════════════════════════════════════════════════════
// Público: solo documentos con visible == true (lo exigen las reglas de seguridad).
// Admin: todos los documentos.
function subscribe() {
  unsubs.forEach((u) => u());
  unsubs = [];
  ["products", "promos"].forEach((name) => {
    const ref = isAdmin ? collection(db, name) : query(collection(db, name), where("visible", "==", true));
    unsubs.push(onSnapshot(ref, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (name === "products") products = list; else promos = list;
      render();
    }, (err) => {
      console.error("Firestore:", err);
      $("catalogStatus").classList.remove("hidden");
      $("catalogStatus").textContent = "No se pudo cargar el catálogo (revisá reglas y configuración de Firebase).";
    }));
  });
}

// ═══════════════════════════════════════════════════════════════
//  PANEL DE ADMINISTRACIÓN
// ═══════════════════════════════════════════════════════════════
function renderAdminPanel() {
  const panel = $("adminPanel");
  if (!db) { panel.innerHTML = "<p>Completá <b>js/firebase-config.js</b> para activar el panel.</p>"; return; }

  // — Sin sesión: formulario de login —
  if (!isAdmin) {
    panel.innerHTML = `<h3>Acceso administrador</h3>
      <form id="loginForm">
        <label class="a-field">Email<input type="email" id="admEmail" required autocomplete="username" /></label>
        <label class="a-field">Contraseña<input type="password" id="admPass" required autocomplete="current-password" /></label>
        <button class="a-btn main" type="submit">Ingresar</button>
        <div class="a-msg" id="loginMsg"></div>
      </form>`;
    return;
  }

  // — Con sesión: listados + acciones —
  const isProd = adminTab === "products";
  const items = (isProd ? [...products] : [...promos]).sort(byOrder);
  const empty = !products.length && !promos.length;
  panel.innerHTML = `<h3>Panel de administración</h3>
    <div class="admin-bar">
      <button class="a-btn ${isProd ? "on" : ""}" data-action="tab" data-tab="products">Productos (${products.length})</button>
      <button class="a-btn ${isProd ? "" : "on"}" data-action="tab" data-tab="promos">Promos (${promos.length})</button>
      <span class="grow"></span>
      <button class="a-btn main" data-action="new" data-kind="${isProd ? "product" : "promo"}">＋ Nuevo</button>
      <button class="a-btn" data-action="logout">Salir</button>
    </div>
    ${empty ? `<div class="admin-bar"><button class="a-btn main" data-action="seed">⬆ Cargar catálogo inicial (${SEED_PRODUCTS.length} productos)</button></div>` : ""}
    <div class="a-list">${items.map((it) => `
      <div class="a-item ${it.visible ? "" : "off"}">
        <div class="t">${esc(isProd ? it.name : it.title).replace(/\n/g, " ")}
          <small>${isProd ? esc(catLabel(it.category)) + (it.variants?.length ? ` · ${it.variants.length} variantes` : " · " + money(it.price)) : money(it.price)}${it.visible ? "" : " · OCULTO"}</small></div>
        <button class="a-btn" data-action="edit" data-kind="${isProd ? "product" : "promo"}" data-id="${it.id}">✏️</button>
        <button class="a-btn ${it.visible ? "" : "on"}" data-action="toggle-visible" data-kind="${isProd ? "product" : "promo"}" data-id="${it.id}">${it.visible ? "🙈" : "👁"}</button>
        <button class="a-btn danger" data-action="delete" data-kind="${isProd ? "product" : "promo"}" data-id="${it.id}">🗑</button>
      </div>`).join("") || "<p style='color:var(--muted);font-size:.85rem'>No hay elementos.</p>"}</div>`;
}

// ── Editor (modal) ───────────────────────────────────────────────
const field = (label, name, val = "", extra = "") =>
  `<label class="a-field">${label}<input name="${name}" value="${esc(val)}" ${extra} /></label>`;

function variantRow(v = { name: "", price: "" }) {
  return `<div class="v-row"><input class="vn" placeholder="Nombre de la variante" value="${esc(v.name)}" />
    <input class="vp" placeholder="Precio" inputmode="numeric" value="${v.price}" />
    <button type="button" class="a-btn danger" data-action="rm-variant">✕</button></div>`;
}

function openEditor(kind, item) {
  const isProd = kind === "product";
  const it = item || (isProd
    ? { category: STORE.categories[0].value, indicationsLabel: "Indicaciones", visible: true, variants: [], order: (Math.max(0, ...products.map((p) => p.order || 0)) + 10) }
    : { tag: "✨ Oferta especial", pctLabel: "de descuento", visible: true, order: (Math.max(0, ...promos.map((p) => p.order || 0)) + 10) });
  const common = `
    <label class="a-field">Visibilidad<select name="visible"><option value="true" ${it.visible ? "selected" : ""}>Visible</option><option value="false" ${it.visible ? "" : "selected"}>Oculto</option></select></label>`;
  const body = isProd ? `
    ${field("Nombre *", "name", it.name, "required")}
    <div class="a-row">
      <label class="a-field">Categoría<select name="category">${STORE.categories.map((c) => `<option value="${c.value}" ${c.value === it.category ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
      ${field("Tamaño (ej. 125 cc)", "size", it.size)}
    </div>
    <label class="a-field">Descripción<textarea name="desc" rows="2">${esc(it.desc)}</textarea></label>
    <div class="a-row">${field("Título del detalle", "indicationsLabel", it.indicationsLabel)}${field("Imagen (ruta en el repo)", "img", it.img)}</div>
    <label class="a-field">Detalle (indicaciones / ingredientes)<textarea name="indications" rows="2">${esc(it.indications)}</textarea></label>
    <div class="a-row">${field("Emoji de respaldo", "emoji", it.emoji)}${field("Texto de respaldo", "emojiLabel", it.emojiLabel)}</div>
    <div class="a-row">${field("Precio (si NO tiene variantes)", "price", it.price || "", 'inputmode="numeric"')}${field("Nota de precio (ej. c/u)", "priceNote", it.priceNote)}</div>
    <div class="a-field">Variantes (si hay al menos una, el producto pasa a ser una familia)
      <div id="variantRows">${(it.variants || []).map(variantRow).join("")}</div>
      <button type="button" class="a-btn" data-action="add-variant">＋ Agregar variante</button></div>`
  : `
    ${field("Etiqueta", "tag", it.tag)}
    <label class="a-field">Título * (Enter = salto de línea)<textarea name="title" rows="2" required>${esc(it.title)}</textarea></label>
    ${field("Subtítulo", "subtitle", it.subtitle)}
    ${field("Detalle de productos", "detail", it.detail)}
    <div class="a-row">${field("Porcentaje (ej. 25%)", "pct", it.pct)}${field("Texto del porcentaje", "pctLabel", it.pctLabel)}</div>
    <div class="a-row">${field("Precio final *", "price", it.price || "", 'inputmode="numeric" required')}${field("Nombre en el carrito", "cartName", it.cartName)}</div>`;
  $("editorBox").innerHTML = `<h3 style="font-family:'Playfair Display',serif;color:var(--pink-btn);margin-bottom:14px">${item ? "Editar" : "Nuevo"} ${isProd ? "producto" : "promo"}</h3>
    <form id="editorForm" data-kind="${kind}" data-id="${item?.id || ""}">
      ${body}
      <div class="a-row">${common}${field("Orden (menor = primero)", "order", it.order ?? 0, 'inputmode="numeric"')}</div>
      <div class="admin-bar"><button class="a-btn main" type="submit">Guardar</button>
      <button type="button" class="a-btn" data-action="close-editor">Cancelar</button></div>
      <div class="a-msg" id="editorMsg"></div></form>`;
  $("editorModal").classList.remove("hidden");
}

// Lee el formulario y guarda en Firestore (crea o actualiza)
async function saveEditor(form) {
  const kind = form.dataset.kind, id = form.dataset.id, f = new FormData(form);
  const g = (k) => (f.get(k) ?? "").toString().trim();
  let data;
  if (kind === "product") {
    const variants = [...form.querySelectorAll(".v-row")]
      .map((r) => ({ name: r.querySelector(".vn").value.trim(), price: toInt(r.querySelector(".vp").value) }))
      .filter((v) => v.name);
    data = { name: g("name"), category: g("category"), size: g("size"), desc: g("desc"), indicationsLabel: g("indicationsLabel"),
      indications: g("indications"), img: g("img"), emoji: g("emoji") || "🌿", emojiLabel: g("emojiLabel") || g("name"),
      price: variants.length ? 0 : toInt(g("price")), priceNote: g("priceNote"), variants };
  } else {
    data = { tag: g("tag"), title: g("title"), subtitle: g("subtitle"), detail: g("detail"), pct: g("pct"),
      pctLabel: g("pctLabel"), price: toInt(g("price")), cartName: g("cartName") };
  }
  data.visible = g("visible") === "true";
  data.order = toInt(g("order"));
  const col = kind === "product" ? "products" : "promos";
  try {
    if (id) await setDoc(doc(db, col, id), data); else await addDoc(collection(db, col), data);
    $("editorModal").classList.add("hidden");
    showToast("✓ Guardado");
  } catch (err) {
    console.error(err);
    $("editorMsg").textContent = "No se pudo guardar: " + err.message;
  }
}

// Sube el catálogo extraído del HTML original (solo si la base está vacía)
async function seedCatalog() {
  if (!confirm("Se cargarán los productos y promos iniciales en Firestore. ¿Continuar?")) return;
  const batch = writeBatch(db); // un lote único (hasta 500 operaciones; aquí hay ~40)
  SEED_PRODUCTS.forEach((p) => batch.set(doc(collection(db, "products")), p));
  SEED_PROMOS.forEach((p) => batch.set(doc(collection(db, "promos")), p));
  try { await batch.commit(); showToast("✓ Catálogo cargado"); }
  catch (err) { alert("Error al cargar: " + err.message); }
}

// ═══════════════════════════════════════════════════════════════
//  EVENTOS (delegación: un solo listener para todos los botones dinámicos)
// ═══════════════════════════════════════════════════════════════
document.addEventListener("click", async (e) => {
  // Filtro del nav
  const navBtn = e.target.closest(".nav-btn");
  if (navBtn) { activeFilter = navBtn.dataset.filter; applyFilter(); return; }

  const el = e.target.closest("[data-action]");
  if (!el) return;
  const { action, kind, id } = el.dataset;
  const col = kind === "product" ? "products" : "promos";
  const find = () => (kind === "product" ? products : promos).find((x) => x.id === id);

  switch (action) {
    case "add": addToCart(el.dataset.id, el.dataset.name, Number(el.dataset.price)); break;
    case "qty": changeQty(Number(el.dataset.idx), Number(el.dataset.d)); break;
    case "toggle-variants": el.classList.toggle("open"); el.nextElementSibling.classList.toggle("open"); break;
    case "tab": adminTab = el.dataset.tab; renderAdminPanel(); break;
    case "new": openEditor(kind, null); break;
    case "edit": openEditor(kind, find()); break;
    case "close-editor": $("editorModal").classList.add("hidden"); break;
    case "add-variant": $("variantRows").insertAdjacentHTML("beforeend", variantRow()); break;
    case "rm-variant": el.closest(".v-row").remove(); break;
    case "toggle-visible": { const it = find(); if (it) await updateDoc(doc(db, col, id), { visible: !it.visible }); break; }
    case "delete": { const it = find(); if (it && confirm(`¿Borrar "${(it.name || it.title).replace(/\n/g, " ")}"? No se puede deshacer.`)) await deleteDoc(doc(db, col, id)); break; }
    case "seed": seedCatalog(); break;
    case "logout": signOut(auth); break;
  }
});

// Envío de formularios (login y editor)
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "editorForm") return saveEditor(e.target);
  if (e.target.id === "loginForm") {
    try { await signInWithEmailAndPassword(auth, $("admEmail").value, $("admPass").value); }
    catch { $("loginMsg").textContent = "Email o contraseña incorrectos."; }
  }
});

// Cerrar el editor al hacer clic fuera de la caja
$("editorModal").addEventListener("click", (e) => { if (e.target.id === "editorModal") $("editorModal").classList.add("hidden"); });
// Mostrar/ocultar el panel desde el footer
$("adminToggle").addEventListener("click", () => { $("adminPanel").classList.toggle("hidden"); renderAdminPanel(); });

// ═══════════════════════════════════════════════════════════════
//  ARRANQUE
// ═══════════════════════════════════════════════════════════════
updateCartUI();
if (firebaseConfig.apiKey.startsWith("PEGAR")) {
  // Config sin completar: la página carga igual pero avisa
  render();
} else {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  // Cada vez que cambia la sesión se re-suscribe: admin ve todo, público solo lo visible.
  // Ojo: esto es solo UI; quien realmente puede escribir lo decide firestore.rules.
  onAuthStateChanged(auth, (user) => { isAdmin = !!user; subscribe(); renderAdminPanel(); });
}
