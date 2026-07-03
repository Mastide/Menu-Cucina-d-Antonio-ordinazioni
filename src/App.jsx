import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

const KITCHEN_CATEGORIES = [
  { itemsKey: "primi_items", hideKey: "primo", label: "Primi" },
  { itemsKey: "secondi_items", hideKey: "secondo", label: "Secondi" },
  { itemsKey: "contorni_items", hideKey: "contorno", label: "Contorni" },
  { itemsKey: "dessert_items", hideKey: "dessert", label: "Dessert" },
];
const BISTROT_CATEGORIES = ["Antipasti", "Piatti", "Bevande"];
const TIME_SLOTS = ["13:10", "13:20", "13:30"];
const BISTROT_MAX = 20;

function formatPrice(n) {
  return `€ ${Number(n || 0).toFixed(2).replace(".", ",")}`;
}

function sendNotification(name) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Nuovo ordine ricevuto", { body: `${name} ha appena prenotato` });
  }
  fetch("https://ntfy.sh/Ordini_Mensa_Antonio_PlusFast", {
    method: "POST",
    headers: { "Title": "Nuovo ordine ricevuto", "Priority": "default", "Tags": "fork_and_knife" },
    body: `${name} ha appena prenotato`,
  }).catch(() => {});
}

function CustomDropdown({ options, value, onChange, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <div ref={ref} style={{ position: "relative", userSelect: "none" }}>
      <div onClick={() => !disabled && setOpen(!open)} style={{ background: "rgba(255,255,255,0.07)", border: `1.5px solid ${open ? "#fff" : "rgba(255,255,255,0.25)"}`, color: disabled ? "#6b8aa8" : "#fff", padding: "10px 14px", fontSize: 14, cursor: disabled ? "not-allowed" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 2 }}>
        <span>{selected ? selected.label : placeholder || "Seleziona..."}</span>
        <span style={{ fontSize: 10, color: "#9bb8d3", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200, background: "#1a3558", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 2, overflow: "hidden" }}>
          {options.map(opt => (
            <div key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }} style={{ padding: "10px 14px", fontSize: 14, cursor: "pointer", color: String(opt.value) === String(value) ? "#fff" : "#9bb8d3", background: String(opt.value) === String(value) ? "rgba(255,255,255,0.12)" : "transparent" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
              onMouseLeave={e => e.currentTarget.style.background = String(opt.value) === String(value) ? "rgba(255,255,255,0.12)" : "transparent"}>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [clientTab, setClientTab] = useState("menu");
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [suspended, setSuspended] = useState(false);
  const [orderForm, setOrderForm] = useState({ name: "", note: "", selectedItems: [] });
  const [orderSent, setOrderSent] = useState(false);
  const [orderError, setOrderError] = useState(false);
  const [lastOrderSummary, setLastOrderSummary] = useState(null);
  const [editingDay, setEditingDay] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [activeDay, setActiveDay] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [adminUser, setAdminUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [newItemInputs, setNewItemInputs] = useState({});
  const [expandedDays, setExpandedDays] = useState({});
  const [editingItem, setEditingItem] = useState(null);
  const [expandedAdmin, setExpandedAdmin] = useState({ asporto: false, bistrot: false });
  const [bistrotMenu, setBistrotMenu] = useState([]);
  const [bistrotBookings, setBistrotBookings] = useState([]);
  const [bistrotSuspended, setBistrotSuspended] = useState(false);
  const [bistrotLocked, setBistrotLocked] = useState(true);
  const [bookingForm, setBookingForm] = useState({ name: "", people: 1, timeSlot: "13:10", note: "" });
  const [bookingSent, setBookingSent] = useState(false);
  const [bookingError, setBookingError] = useState(false);
  const [newBistrotItem, setNewBistrotItem] = useState({ categoria: "Antipasti", nome: "", prezzo: "" });
  const [editingBistrotItem, setEditingBistrotItem] = useState(null);
  const [newBookingCount, setNewBookingCount] = useState(0);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (adminUser && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }, [adminUser]);

  useEffect(() => {
    loadMenu(); loadSuspended(); loadBistrotMenu(); loadBistrotBookings(); loadBistrotSuspended(); loadBistrotLocked();
    supabase.auth.getSession().then(({ data: { session } }) => setAdminUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setAdminUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    supabase.from("orders").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      if (data) { setOrders(data); setLoading(false); setTimeout(() => { initialLoadDone.current = true; }, 500); }
    });
  }, []);

  useEffect(() => {
    const ch = supabase.channel("orders-rt").on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (p) => {
      if (!p.new) return;
      setOrders(prev => [p.new, ...prev]);
      if (initialLoadDone.current) { sendNotification(p.new.name || "Qualcuno"); setNewOrderCount(n => n + 1); }
    }).on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" }, (p) => {
      if (p.old) setOrders(prev => prev.filter(o => o.id !== p.old.id));
    }).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    const ch = supabase.channel("settings-rt").on("postgres_changes", { event: "*", schema: "public", table: "settings" }, (p) => {
      if (p.new?.key === "suspended") setSuspended(p.new.value === "true");
      if (p.new?.key === "bistrot_suspended") setBistrotSuspended(p.new.value === "true");
      if (p.new?.key === "bistrot_locked") setBistrotLocked(p.new.value === "true");
    }).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    const ch = supabase.channel("menu-rt").on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu" }, () => loadMenu()).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    const ch = supabase.channel("bistrot-bookings-rt").on("postgres_changes", { event: "INSERT", schema: "public", table: "bistrot_bookings" }, (p) => {
      if (p.new) { setBistrotBookings(prev => [p.new, ...prev]); setNewBookingCount(n => n + 1); }
    }).on("postgres_changes", { event: "DELETE", schema: "public", table: "bistrot_bookings" }, (p) => {
      if (p.old) setBistrotBookings(prev => prev.filter(b => b.id !== p.old.id));
    }).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  async function loadMenu() {
    const { data } = await supabase.from("menu").select("*").order("id");
    if (data) { setMenu(data); const i = data.findIndex(d => d.is_today); setActiveDay(i >= 0 ? i : 0); }
    setLoading(false);
  }
  async function loadSuspended() {
    const { data } = await supabase.from("settings").select("value").eq("key", "suspended").single();
    if (data) setSuspended(data.value === "true");
  }
  async function loadBistrotMenu() {
    const { data } = await supabase.from("bistrot_menu").select("*").order("sort_order");
    if (data) setBistrotMenu(data);
  }
  async function loadBistrotBookings() {
    const { data } = await supabase.from("bistrot_bookings").select("*").order("created_at", { ascending: false });
    if (data) setBistrotBookings(data);
  }
  async function loadBistrotSuspended() {
    const { data } = await supabase.from("settings").select("value").eq("key", "bistrot_suspended").single();
    if (data) setBistrotSuspended(data.value === "true");
  }
  async function loadBistrotLocked() {
    const { data } = await supabase.from("settings").select("value").eq("key", "bistrot_locked").single();
    if (data) setBistrotLocked(data.value === "true");
  }

  async function handleLogin() {
    setLoginLoading(true); setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email: loginForm.email, password: loginForm.password });
    if (error) { setLoginError("Email o password non corretti."); }
    else { setShowLogin(false); if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); }
    setLoginLoading(false);
  }
  async function handleLogout() { await supabase.auth.signOut(); setNewOrderCount(0); setNewBookingCount(0); }

  function toggleSelectItem(category, nome, prezzo) {
    setOrderForm(f => {
      const exists = f.selectedItems.some(i => i.category === category && i.nome === nome);
      let selectedItems = exists ? f.selectedItems.filter(i => !(i.category === category && i.nome === nome)) : [...f.selectedItems, { category, nome, prezzo }];
      if (!selectedItems.some(i => i.category === "Secondi")) selectedItems = selectedItems.filter(i => i.category !== "Contorni");
      return { ...f, selectedItems };
    });
  }
  function isSelected(category, nome) { return orderForm.selectedItems.some(i => i.category === category && i.nome === nome); }
  const orderTotal = orderForm.selectedItems.reduce((s, i) => s + Number(i.prezzo || 0), 0);
  const nameAlreadyOrdered = orderForm.name.trim().length > 1 && orders.some(o => o.name.trim().toLowerCase() === orderForm.name.trim().toLowerCase());

  async function handleOrder() {
    if (!orderForm.name.trim() || orderForm.selectedItems.length === 0) return;
    setSubmitting(true); setOrderError(false);
    try {
      const { error } = await supabase.from("orders").insert([{ name: orderForm.name, selected_items: orderForm.selectedItems, note: orderForm.note }]);
      if (!error) { setLastOrderSummary({ items: orderForm.selectedItems, total: orderTotal }); setOrderSent(true); setOrderForm({ name: "", note: "", selectedItems: [] }); }
      else setOrderError(true);
    } catch { setOrderError(true); }
    setSubmitting(false);
  }
  async function deleteOrder(id) { await supabase.from("orders").delete().eq("id", id); }
  async function toggleSuspended() {
    const v = (!suspended).toString();
    await supabase.from("settings").update({ value: v }).eq("key", "suspended");
    setSuspended(!suspended);
  }

  const totalPeopleBooked = bistrotBookings.reduce((s, b) => s + (b.people || 0), 0);
  const remainingSpots = BISTROT_MAX - totalPeopleBooked;
  const peopleOptions = Array.from({ length: Math.min(6, Math.max(0, remainingSpots)) }, (_, i) => ({ value: i + 1, label: i === 0 ? "1 persona" : `${i + 1} persone` }));

  async function handleBooking() {
    if (!bookingForm.name.trim()) return;
    setSubmitting(true); setBookingError(false);
    try {
      const { error } = await supabase.from("bistrot_bookings").insert([{ name: bookingForm.name, people: bookingForm.people, time_slot: bookingForm.timeSlot, note: bookingForm.note }]);
      if (!error) { setBookingSent(true); setBookingForm({ name: "", people: 1, timeSlot: "13:10", note: "" }); }
      else setBookingError(true);
    } catch { setBookingError(true); }
    setSubmitting(false);
  }
  async function deleteBistrotBooking(id) { await supabase.from("bistrot_bookings").delete().eq("id", id); }
  async function toggleBistrotSuspended() {
    const v = (!bistrotSuspended).toString();
    await supabase.from("settings").update({ value: v }).eq("key", "bistrot_suspended");
    setBistrotSuspended(!bistrotSuspended);
  }
  async function toggleBistrotLocked() {
    const v = (!bistrotLocked).toString();
    await supabase.from("settings").update({ value: v }).eq("key", "bistrot_locked");
    setBistrotLocked(!bistrotLocked);
  }

  async function addBistrotItem() {
    if (!newBistrotItem.nome.trim()) return;
    const prezzo = parseFloat((newBistrotItem.prezzo || "0").replace(",", ".")) || 0;
    const maxOrder = bistrotMenu.filter(i => i.categoria === newBistrotItem.categoria).reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
    await supabase.from("bistrot_menu").insert([{ categoria: newBistrotItem.categoria, nome: newBistrotItem.nome.trim(), prezzo, sort_order: maxOrder + 1 }]);
    setNewBistrotItem(s => ({ ...s, nome: "", prezzo: "" }));
    loadBistrotMenu();
  }
  async function removeBistrotItem(id) { await supabase.from("bistrot_menu").delete().eq("id", id); loadBistrotMenu(); }
  async function toggleBistrotUnavailable(id, current) { await supabase.from("bistrot_menu").update({ unavailable: !current }).eq("id", id); loadBistrotMenu(); }
  async function saveBistrotItemEdit() {
    if (!editingBistrotItem) return;
    const prezzo = parseFloat((editingBistrotItem.prezzo || "0").toString().replace(",", ".")) || 0;
    await supabase.from("bistrot_menu").update({ nome: editingBistrotItem.nome, prezzo }).eq("id", editingBistrotItem.id);
    setEditingBistrotItem(null); loadBistrotMenu();
  }
  async function updateBistrotPrice(id, val) {
    const prezzo = parseFloat((val || "0").replace(",", ".")) || 0;
    await supabase.from("bistrot_menu").update({ prezzo }).eq("id", id);
    loadBistrotMenu();
  }

  async function setToday(id) {
    await supabase.from("menu").update({ is_today: false }).neq("id", 0);
    await supabase.from("menu").update({ is_today: true }).eq("id", id);
    loadMenu();
  }
  function startEdit(day) { setEditingDay(day.id); setEditForm({ day: day.day, date: day.date }); }
  async function saveEdit() {
    await supabase.from("menu").update({ day: editForm.day, date: editForm.date }).eq("id", editingDay);
    setEditingDay(null); loadMenu();
  }
  async function addItem(dayId, itemsKey, currentItems) {
    const inputKey = `${dayId}_${itemsKey}`;
    const draft = newItemInputs[inputKey] || { nome: "", prezzo: "" };
    if (!draft.nome.trim()) return;
    const prezzo = parseFloat((draft.prezzo || "0").replace(",", ".")) || 0;
    await supabase.from("menu").update({ [itemsKey]: [...(currentItems || []), { nome: draft.nome.trim(), prezzo, unavailable: false }] }).eq("id", dayId);
    setNewItemInputs(s => ({ ...s, [inputKey]: { nome: "", prezzo: "" } })); loadMenu();
  }
  async function removeItem(dayId, itemsKey, currentItems, index) {
    await supabase.from("menu").update({ [itemsKey]: currentItems.filter((_, i) => i !== index) }).eq("id", dayId); loadMenu();
  }
  async function toggleItemUnavailable(dayId, itemsKey, currentItems, index) {
    await supabase.from("menu").update({ [itemsKey]: currentItems.map((it, i) => i === index ? { ...it, unavailable: !it.unavailable } : it) }).eq("id", dayId); loadMenu();
  }
  async function updateItemPrice(dayId, itemsKey, currentItems, index, val) {
    const prezzo = parseFloat((val || "0").replace(",", ".")) || 0;
    await supabase.from("menu").update({ [itemsKey]: currentItems.map((it, i) => i === index ? { ...it, prezzo } : it) }).eq("id", dayId); loadMenu();
  }
  async function saveItemEdit(dayId, itemsKey, currentItems, index) {
    if (!editingItem) return;
    const prezzo = parseFloat((editingItem.prezzo || "0").toString().replace(",", ".")) || 0;
    await supabase.from("menu").update({ [itemsKey]: currentItems.map((it, i) => i === index ? { ...it, nome: editingItem.nome, prezzo } : it) }).eq("id", dayId);
    setEditingItem(null); loadMenu();
  }
  async function toggleCategoryHidden(dayId, hideKey, currentHidden) {
    let h = [...(currentHidden || [])];
    h = h.includes(hideKey) ? h.filter(f => f !== hideKey) : [...h, hideKey];
    await supabase.from("menu").update({ hidden_fields: h }).eq("id", dayId); loadMenu();
  }
  function toggleDayExpanded(dayId) { setExpandedDays(prev => ({ ...prev, [dayId]: !isDayExpanded(dayId) })); }
  function isDayExpanded(dayId) {
    const day = menu.find(d => d.id === dayId);
    return expandedDays[dayId] !== undefined ? expandedDays[dayId] : !!day?.is_today;
  }
  function toggleAdminSection(s) { setExpandedAdmin(prev => ({ ...prev, [s]: !prev[s] })); }

  const today = menu.find(d => d.is_today) || menu[0];
  const todayHidden = today?.hidden_fields || [];
  const todayUnavailable = today?.unavailable_fields || [];
  const visibleFields = KITCHEN_CATEGORIES.filter(f => !todayHidden.includes(f.hideKey));
  function availableItems(day, itemsKey) { return (day?.[itemsKey] || []).filter(it => !it.unavailable); }

  const tallyOrders = (() => {
    const t = {};
    orders.forEach(o => (o.selected_items || []).forEach(it => {
      const k = `${it.category}::${it.nome}`;
      if (!t[k]) t[k] = { category: it.category, nome: it.nome, count: 0 };
      t[k].count++;
    }));
    return Object.values(t).sort((a, b) => b.count - a.count);
  })();

  if (loading) return (
    <div style={{ fontFamily: "'Antonio', sans-serif", minHeight: "100vh", background: "url('/Sfondo.jpg') center center / cover fixed", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#9bb8d3", fontSize: 14, letterSpacing: 1 }}>Caricamento...</div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Antonio', sans-serif", minHeight: "100vh", background: "url('/Sfondo.jpg') center center / cover fixed" }}>
      <style>{`
        @font-face { font-family: 'Antonio'; src: url('/Antonio.TTF') format('truetype'); font-weight: 100 900; font-style: normal; }
        @font-face { font-family: 'Nickainley'; src: url('/Nickainley.OTF') format('opentype'); font-weight: normal; font-style: normal; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: url('/Sfondo.jpg') center center / cover fixed; }
        .fade-in { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .btn-primary { background: #fff; color: #1c3c5e; border: none; padding: 13px 28px; font-family: 'Antonio', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; letter-spacing: 0.5px; transition: all 0.2s; border-radius: 2px; }
        .btn-primary:hover { background: #e8eef4; }
        .btn-primary:disabled { background: #6b8aa8; color: #cdd9e4; cursor: not-allowed; }
        .btn-danger { background: rgba(180,70,70,0.25); color: #f0a0a0; border: 1px solid rgba(180,70,70,0.4); padding: 8px 18px; font-family: 'Antonio', sans-serif; font-size: 13px; cursor: pointer; transition: all 0.2s; border-radius: 2px; }
        .btn-danger:hover { background: rgba(180,70,70,0.4); }
        .btn-ghost { background: transparent; border: 1.5px solid rgba(255,255,255,0.4); color: #fff; padding: 10px 22px; font-family: 'Antonio', sans-serif; font-size: 13px; cursor: pointer; transition: all 0.2s; border-radius: 2px; }
        .btn-ghost:hover { background: rgba(255,255,255,0.1); }
        input[type=text], input[type=email], input[type=password], input[type=number], textarea { font-family: 'Antonio', sans-serif; border: 1.5px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.07); color: #fff; padding: 10px 14px; font-size: 14px; outline: none; transition: border 0.2s; width: 100%; border-radius: 2px; }
        input::placeholder, textarea::placeholder { color: #6b8aa8; }
        input:focus, textarea:focus { border-color: #fff; }
        .tag { display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; border-radius: 2px; }
        .divider-line { height: 1px; background: rgba(255,255,255,0.2); margin: 28px 0; }
        .day-tab { padding: 8px 16px; font-family: 'Antonio', sans-serif; font-size: 13px; cursor: pointer; border: none; background: transparent; transition: all 0.2s; border-bottom: 2px solid transparent; color: #7f9cb8; }
        .day-tab.active { color: #fff; border-bottom: 2px solid #fff; font-weight: 500; }
        .day-tab:hover:not(.active) { color: #cdd9e4; }
        .order-row { background: rgba(255,255,255,0.06); padding: 14px 18px; margin-bottom: 10px; border-left: 3px solid #fff; border-radius: 2px; }
        .suspended-banner { background: rgba(180,70,70,0.85); color: white; text-align: center; padding: 12px; font-family: 'Antonio', sans-serif; font-size: 13px; letter-spacing: 0.5px; }
        .badge { background: #fff; color: #1c3c5e; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; font-family: 'Antonio', sans-serif; font-weight: 700; }
        .field-control-btn { border: none; padding: 4px 10px; font-family: 'Antonio', sans-serif; font-size: 10px; font-weight: 500; letter-spacing: 0.5px; cursor: pointer; transition: all 0.15s; border-radius: 2px; }
        .script-title { font-family: 'Nickainley', cursive; font-weight: normal; color: #fff; }
        .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
        .item-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; margin-bottom: 4px; background: rgba(255,255,255,0.04); border-radius: 2px; gap: 8px; }
        .price-input { width: 64px !important; padding: 4px 6px !important; font-size: 12px !important; text-align: right; }
        .app-main { padding: 40px 24px; }
        .app-header-inner { padding: 0 32px; }
        .hero-title { font-size: 48px; }
        .menu-today-grid { grid-template-columns: repeat(2, 1fr); gap: 14px; }
        .menu-week-grid { grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .admin-cat-grid { grid-template-columns: repeat(2, 1fr); gap: 14px; }
        @media (max-width: 640px) {
          .app-main { padding: 24px 14px; }
          .app-header-inner { padding: 0 16px; height: auto !important; flex-wrap: wrap; gap: 10px; padding-top: 10px; padding-bottom: 10px; }
          .hero-title { font-size: 32px !important; }
          .menu-today-grid { grid-template-columns: 1fr; }
          .menu-week-grid { grid-template-columns: repeat(2, 1fr); }
          .admin-cat-grid { grid-template-columns: 1fr; }
          .item-row { flex-wrap: wrap; }
          .order-card-padding { padding: 20px 18px !important; }
        }
      `}</style>

      {showLogin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="fade-in" style={{ background: "#1c3c5e", border: "1px solid rgba(255,255,255,0.15)", padding: "40px", width: 360, maxWidth: "90vw" }}>
            <h2 className="script-title" style={{ fontSize: 30, marginBottom: 4 }}>Accesso Admin</h2>
            <p style={{ fontSize: 13, color: "#7f9cb8", marginBottom: 24 }}>Area riservata</p>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Email</label>
              <input type="email" value={loginForm.email} onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))} onKeyDown={e => e.key === "Enter" && handleLogin()} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Password</label>
              <input type="password" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} onKeyDown={e => e.key === "Enter" && handleLogin()} />
            </div>
            {loginError && <div style={{ fontSize: 13, color: "#f0a0a0", marginBottom: 16 }}>{loginError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-primary" onClick={handleLogin} disabled={loginLoading}>{loginLoading ? "Accesso..." : "Accedi"}</button>
              <button className="btn-ghost" onClick={() => { setShowLogin(false); setLoginError(""); }}>Annulla</button>
            </div>
          </div>
        </div>
      )}

      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", background: "rgba(12,30,60,0.6)" }}>
        <div className="app-header-inner" style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1 className="script-title" style={{ fontSize: 26 }}>EngineerEat</h1>
            <span style={{ color: "#7f9cb8", fontSize: 11, letterSpacing: 2 }}>ORDINAZIONI</span>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="day-tab" onClick={() => setClientTab("menu")} style={{ color: clientTab === "menu" && !adminUser ? "#fff" : "#7f9cb8", borderBottomColor: clientTab === "menu" && !adminUser ? "#fff" : "transparent" }}>Menu & Ordini</button>
            <button className="day-tab" onClick={() => setClientTab("bistrot")} style={{ color: clientTab === "bistrot" && !adminUser ? "#fff" : "#7f9cb8", borderBottomColor: clientTab === "bistrot" && !adminUser ? "#fff" : "transparent" }}>Bistrot</button>
            {adminUser ? (
              <>
                <button className="day-tab" onClick={() => setClientTab("admin")} style={{ color: clientTab === "admin" ? "#fff" : "#7f9cb8", borderBottomColor: clientTab === "admin" ? "#fff" : "transparent", display: "flex", alignItems: "center" }}>
                  Admin ⚙{(newOrderCount + newBookingCount) > 0 && <span className="badge">{newOrderCount + newBookingCount}</span>}
                </button>
                <button onClick={handleLogout} style={{ marginLeft: 8, background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "#9bb8d3", padding: "4px 12px", fontSize: 11, cursor: "pointer", fontFamily: "'Antonio', sans-serif" }}>Esci</button>
              </>
            ) : (
              <button onClick={() => setShowLogin(true)} style={{ background: "transparent", border: "none", color: "#5b7a9a", fontSize: 12, cursor: "pointer", padding: "4px 8px", fontFamily: "'Antonio', sans-serif" }}>⚙</button>
            )}
          </div>
        </div>
      </header>

      {suspended && clientTab === "menu" && <div className="suspended-banner">ORDINAZIONI SOSPESE — La cucina non accetta nuove prenotazioni al momento</div>}
      {bistrotSuspended && clientTab === "bistrot" && <div className="suspended-banner">PRENOTAZIONI BISTROT SOSPESE</div>}

      <main className="app-main" style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* ---- MENU & ORDINI ---- */}
        {clientTab === "menu" && today && (
          <div className="fade-in">
            <div style={{ background: "rgba(192,160,80,0.12)", border: "1px solid rgba(192,160,80,0.3)", padding: "10px 18px", marginBottom: 28, textAlign: "center", fontSize: 12, color: "#d8be7a" }}>
              Ordina entro le ore 12:00 per garantirti la disponibilità dei piatti
            </div>
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <span style={{ fontSize: 11, letterSpacing: 3, color: "#7f9cb8", textTransform: "uppercase" }}>{today.day} · {today.date}</span>
              <h2 className="script-title hero-title" style={{ marginTop: 6 }}>Menù del giorno</h2>
            </div>
            <div className="menu-today-grid" style={{ display: "grid", marginBottom: 40 }}>
              {visibleFields.map(({ itemsKey, hideKey, label }) => {
                const avail = availableItems(today, itemsKey);
                return (
                  <div key={itemsKey} className="card" style={{ padding: "20px 24px" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, color: "#7f9cb8", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
                    {avail.length === 0 ? <div style={{ fontSize: 13, color: "#b08080", fontStyle: "italic" }}>Non disponibile</div> : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {avail.map(it => (
                          <div key={it.nome} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                            <span style={{ fontSize: 15, fontWeight: 500, color: "#fff" }}>{it.nome}</span>
                            <span style={{ fontSize: 13, color: "#9bb8d3", whiteSpace: "nowrap" }}>{formatPrice(it.prezzo)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="divider-line" />
            <h3 className="script-title" style={{ fontSize: 28, marginBottom: 18, textAlign: "center" }}>Menù della settimana</h3>
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.15)", display: "flex", marginBottom: 20, overflowX: "auto", justifyContent: "center" }}>
              {menu.map((d, i) => (
                <button key={d.id} className={`day-tab ${activeDay === i ? "active" : ""}`} onClick={() => setActiveDay(i)}>
                  {d.day}{d.is_today && <span style={{ marginLeft: 4, color: "#fff" }}>•</span>}
                </button>
              ))}
            </div>
            {menu[activeDay] && (
              <div className="menu-week-grid" style={{ display: "grid", marginBottom: 40 }}>
                {KITCHEN_CATEGORIES.filter(c => !(menu[activeDay].hidden_fields || []).includes(c.hideKey)).map(({ itemsKey, label }) => {
                  const avail = availableItems(menu[activeDay], itemsKey);
                  return (
                    <div key={itemsKey} className="card" style={{ padding: "14px 16px" }}>
                      <div style={{ fontSize: 10, letterSpacing: 1.5, color: "#7f9cb8", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                      {avail.length === 0 ? <div style={{ fontSize: 12, color: "#b08080", fontStyle: "italic" }}>Non disponibile</div> : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {avail.map(it => (
                            <div key={it.nome} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 500, color: "#fff" }}>{it.nome}</span>
                              <span style={{ fontSize: 11, color: "#9bb8d3", whiteSpace: "nowrap" }}>{formatPrice(it.prezzo)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="divider-line" />
            <h3 className="script-title" style={{ fontSize: 28, marginBottom: 8, textAlign: "center" }}>{suspended ? "Ordinazioni chiuse" : "Prenota il tuo pasto"}</h3>
            {suspended ? (
              <div style={{ background: "rgba(180,70,70,0.15)", border: "1px solid rgba(180,70,70,0.3)", padding: "16px 20px", fontSize: 14, color: "#f0a0a0", textAlign: "center" }}>Le ordinazioni sono temporaneamente sospese.</div>
            ) : orderSent ? (
              <div className="fade-in card" style={{ padding: "24px", textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Prenotazione inviata</div>
                <div style={{ fontSize: 13, color: "#9bb8d3", marginBottom: 18 }}>Il tuo ordine è stato ricevuto. Buon appetito!</div>
                {lastOrderSummary?.items?.length > 0 && (
                  <div style={{ textAlign: "left", background: "rgba(0,0,0,0.15)", padding: "14px 18px", marginBottom: 4 }}>
                    {lastOrderSummary.items.map((it, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#fff", padding: "3px 0" }}>
                        <span>{it.nome} <span style={{ color: "#7f9cb8", fontSize: 11 }}>({it.category})</span></span>
                        <span style={{ color: "#9bb8d3" }}>{formatPrice(it.prezzo)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, color: "#fff", borderTop: "1px solid rgba(255,255,255,0.15)", marginTop: 8, paddingTop: 8 }}>
                      <span>Totale</span><span>{formatPrice(lastOrderSummary.total)}</span>
                    </div>
                  </div>
                )}
                <button className="btn-ghost" style={{ marginTop: 16, fontSize: 12 }} onClick={() => setOrderSent(false)}>Nuovo ordine</button>
              </div>
            ) : (
              <div className="card order-card-padding" style={{ padding: "28px 32px", marginTop: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Nome e cognome *</label>
                  <input type="text" placeholder="Es. Marco Bianchi" value={orderForm.name} onChange={e => setOrderForm(f => ({ ...f, name: e.target.value }))} style={{ maxWidth: 320 }} />
                  {nameAlreadyOrdered && <div style={{ fontSize: 12, color: "#d8be7a", marginTop: 6 }}>Risulta già un ordine con questo nome. Se procedi viene aggiunto un secondo ordine.</div>}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 12 }}>Selezione *</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {KITCHEN_CATEGORIES.filter(c => !todayHidden.includes(c.hideKey)).map(c => {
                      const avail = availableItems(today, c.itemsKey);
                      if (avail.length === 0) return null;
                      const isContorni = c.label === "Contorni";
                      const hasSecondo = orderForm.selectedItems.some(i => i.category === "Secondi");
                      const locked = isContorni && !hasSecondo;
                      return (
                        <div key={c.itemsKey}>
                          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#7f9cb8", textTransform: "uppercase", marginBottom: 8 }}>{c.label}</div>
                          {locked && <div style={{ fontSize: 12, color: "#7f9cb8", fontStyle: "italic", marginBottom: 8 }}>Seleziona un secondo per poter scegliere il contorno</div>}
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {avail.map(it => {
                              const checked = isSelected(c.label, it.nome);
                              return (
                                <div key={it.nome} onClick={() => !locked && toggleSelectItem(c.label, it.nome, it.prezzo)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: locked ? "not-allowed" : "pointer", fontSize: 14, opacity: locked ? 0.4 : 1 }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <span style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${checked ? "#fff" : "rgba(255,255,255,0.45)"}`, background: checked ? "#fff" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
                                      {checked && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.2L4.8 9L10 3" stroke="#1c3c5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                    </span>
                                    <span style={{ fontWeight: 500, color: "#fff" }}>{it.nome}</span>
                                  </span>
                                  <span style={{ color: "#9bb8d3", fontSize: 13 }}>{formatPrice(it.prezzo)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {orderForm.selectedItems.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.15)", marginBottom: 16 }}>
                    <span style={{ fontSize: 13, color: "#9bb8d3" }}>Totale</span>
                    <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>{formatPrice(orderTotal)}</span>
                  </div>
                )}
                <div style={{ marginBottom: 22 }}>
                  <label style={{ fontSize: 12, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Note (facoltativo)</label>
                  <textarea placeholder="Allergie, intolleranze, preferenze..." value={orderForm.note} onChange={e => setOrderForm(f => ({ ...f, note: e.target.value }))} style={{ resize: "vertical", minHeight: 70, maxWidth: 400 }} />
                </div>
                <div style={{ fontSize: 11, color: "#7f9cb8", marginBottom: 14, fontStyle: "italic" }}>Ricorda: ordina entro le ore 12:00 per garantirti la disponibilità.</div>
                {orderError && <div style={{ background: "rgba(180,70,70,0.15)", border: "1px solid rgba(180,70,70,0.3)", padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#f0a0a0" }}>Qualcosa è andato storto. Controlla la connessione e riprova.</div>}
                <button className="btn-primary" onClick={handleOrder} disabled={submitting}>{submitting ? "Invio in corso..." : orderError ? "Riprova" : "Invia prenotazione"}</button>
              </div>
            )}
          </div>
        )}

        {/* ---- BISTROT ---- */}
        {clientTab === "bistrot" && (
          <div className="fade-in">
            <div style={{ textAlign: "center", padding: "48px 24px 36px" }}>
              <div style={{ fontSize: 11, letterSpacing: 6, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 12 }}>Prossimamente</div>
              <h2 className="script-title" style={{ fontSize: 72, lineHeight: 1, marginBottom: 16, textTransform: "uppercase" }}>Coming Soon</h2>
              <div style={{ height: 1, background: "rgba(255,255,255,0.2)", maxWidth: 200, margin: "0 auto" }} />
            </div>
            <div className="card" style={{ padding: "28px 32px", marginBottom: 32 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 2, color: "#c0392b", textTransform: "uppercase", marginBottom: 8 }}>Bistrot EngineerEat</div>
              <h2 className="script-title hero-title" style={{ marginBottom: 12, textTransform: "uppercase" }}>Stacca davvero la spina.</h2>
              <p style={{ fontSize: 14, color: "#9bb8d3", lineHeight: 1.75, maxWidth: 620 }}>
                Niente scrivania, niente schermo — solo un tavolo apparecchiato, un calice di vino o una bibita fresca e il tempo per respirare. Il Bistrot è il nostro modo di dirti che una pausa vera vale quanto un'ottima riunione. Prenota il tuo posto, scegli dal menù dedicato e concediti una mezzora che fa bene all'umore e alla giornata.
              </p>
            </div>

            {!bistrotLocked && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div className="card" style={{ padding: "24px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 18 }}>Prenota un tavolo</div>
                {bistrotSuspended ? (
                  <div style={{ background: "rgba(180,70,70,0.15)", border: "1px solid rgba(180,70,70,0.3)", padding: "20px", textAlign: "center", fontSize: 14, color: "#f0a0a0" }}>Le prenotazioni sono temporaneamente sospese.</div>
                ) : remainingSpots <= 0 ? (
                  <div style={{ background: "rgba(180,70,70,0.15)", border: "1px solid rgba(180,70,70,0.3)", padding: "20px", textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#f0a0a0", marginBottom: 6 }}>Prenotazioni esaurite</div>
                    <div style={{ fontSize: 13, color: "#c08080" }}>Tutti i posti per oggi sono stati prenotati. Riprova domani.</div>
                  </div>
                ) : bookingSent ? (
                  <div className="fade-in" style={{ textAlign: "center", padding: "20px 0" }}>
                    <div style={{ fontSize: 17, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Prenotazione confermata</div>
                    <div style={{ fontSize: 13, color: "#9bb8d3", marginBottom: 16 }}>Ti aspettiamo al Bistrot. Buon appetito!</div>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setBookingSent(false)}>Nuova prenotazione</button>
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 11, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Nome e cognome *</label>
                      <input type="text" placeholder="Es. Marco Bianchi" value={bookingForm.name} onChange={e => setBookingForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 11, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Numero di persone *</label>
                      <CustomDropdown options={peopleOptions} value={bookingForm.people} onChange={v => setBookingForm(f => ({ ...f, people: Number(v) }))} />
                      {remainingSpots < 6 && remainingSpots > 0 && <div style={{ fontSize: 11, color: "#d8be7a", marginTop: 5 }}>Posti limitati — disponibile solo per piccoli gruppi.</div>}
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 11, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Orario *</label>
                      <CustomDropdown options={TIME_SLOTS.map(t => ({ value: t, label: t }))} value={bookingForm.timeSlot} onChange={v => setBookingForm(f => ({ ...f, timeSlot: v }))} />
                    </div>
                    <div style={{ marginBottom: 20 }}>
                      <label style={{ fontSize: 11, letterSpacing: 1, color: "#9bb8d3", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Note (facoltativo)</label>
                      <textarea placeholder="Allergie, occasioni speciali..." value={bookingForm.note} onChange={e => setBookingForm(f => ({ ...f, note: e.target.value }))} style={{ resize: "vertical", minHeight: 60 }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#7f9cb8", marginBottom: 14, fontStyle: "italic" }}>Prenota entro le 11:30 per garantirti il posto.</div>
                    {bookingError && <div style={{ background: "rgba(180,70,70,0.15)", border: "1px solid rgba(180,70,70,0.3)", padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#f0a0a0" }}>Qualcosa è andato storto. Riprova.</div>}
                    <button className="btn-primary" style={{ width: "100%" }} onClick={handleBooking} disabled={submitting || peopleOptions.length === 0}>{submitting ? "Invio..." : "Prenota il tavolo"}</button>
                  </div>
                )}
              </div>

              <div className="card" style={{ padding: "24px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 18 }}>Menù Bistrot</div>
                {BISTROT_CATEGORIES.map(cat => {
                  const items = bistrotMenu.filter(i => i.categoria === cat && !i.unavailable);
                  if (items.length === 0) return null;
                  return (
                    <div key={cat} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 10, letterSpacing: 2, color: "#7f9cb8", textTransform: "uppercase", marginBottom: 8 }}>{cat}</div>
                      {items.map(it => (
                        <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "5px 0", borderBottom: "0.5px solid rgba(255,255,255,0.08)" }}>
                          <span style={{ color: "#fff" }}>{it.nome}</span>
                          <span style={{ color: "#9bb8d3" }}>{formatPrice(it.prezzo)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>
        )}

        {/* ---- ADMIN ---- */}
        {clientTab === "admin" && adminUser && (
          <div className="fade-in">
            <h2 className="script-title" style={{ fontSize: 32, marginBottom: 6 }}>Pannello Admin</h2>
            <p style={{ fontSize: 13, color: "#7f9cb8", marginBottom: 28 }}>Seleziona una sezione per espanderla</p>

            {/* ACCORDION: ORDINAZIONI ASPORTO */}
            <div className="card" style={{ marginBottom: 12, overflow: "hidden" }}>
              <div onClick={() => { toggleAdminSection("asporto"); setNewOrderCount(0); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 12, color: "#7f9cb8", display: "inline-block", transform: expandedAdmin.asporto ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Ordinazioni Asporto</div>
                    <div style={{ fontSize: 12, color: "#7f9cb8", marginTop: 2 }}>Ordini ricevuti · Sospensione · Gestione menù settimanale</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                  {orders.length > 0 && <span className="tag" style={{ background: "rgba(255,255,255,0.9)", color: "#1c3c5e", fontSize: 10 }}>{orders.length} ordini</span>}
                  <button onClick={toggleSuspended} style={{ padding: "8px 18px", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: suspended ? "rgba(80,150,80,0.85)" : "rgba(180,70,70,0.85)", color: "white", borderRadius: 2, fontFamily: "'Antonio', sans-serif" }}>
                    {suspended ? "Riapri" : "Sospendi"}
                  </button>
                </div>
              </div>

              {expandedAdmin.asporto && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "20px 22px" }}>
                  {tallyOrders.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 12 }}>Riepilogo cucina</div>
                      <div style={{ background: "rgba(0,0,0,0.15)", padding: "12px 16px", borderRadius: 4, marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {tallyOrders.map((t, i) => (
                          <span key={i} style={{ fontSize: 13, color: "#fff" }}>{t.nome} <span style={{ color: "#9bb8d3" }}>× {t.count}</span></span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 12 }}>Ordini ricevuti</div>
                  {orders.length === 0 ? (
                    <div style={{ padding: "16px", fontSize: 14, color: "#7f9cb8" }}>Nessun ordine ancora.</div>
                  ) : orders.map(o => (
                    <div key={o.id} className="order-row fade-in">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 15, color: "#fff" }}>{o.name}</span>
                            <span style={{ fontSize: 11, color: "#7f9cb8" }}>{new Date(o.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
                            {o.selected_items?.length > 0 && <span style={{ fontSize: 12, color: "#9bb8d3", marginLeft: "auto" }}>{formatPrice(o.selected_items.reduce((s, i) => s + Number(i.prezzo || 0), 0))}</span>}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: o.note ? 8 : 0 }}>
                            {(o.selected_items?.length > 0) ? o.selected_items.map((it, idx) => (
                              <span key={idx} className="tag" style={{ background: "rgba(255,255,255,0.12)", color: "#cfe0ee" }}>{it.category}: {it.nome} ({formatPrice(it.prezzo)})</span>
                            )) : (
                              <>
                                {o.primo && <span className="tag" style={{ background: "rgba(255,255,255,0.12)", color: "#cfe0ee" }}>Primo</span>}
                                {o.secondo && <span className="tag" style={{ background: "rgba(255,255,255,0.12)", color: "#cfe0ee" }}>Secondo</span>}
                                {o.contorno && <span className="tag" style={{ background: "rgba(255,255,255,0.12)", color: "#cfe0ee" }}>Contorno</span>}
                                {o.dessert && <span className="tag" style={{ background: "rgba(255,255,255,0.12)", color: "#cfe0ee" }}>Dessert</span>}
                              </>
                            )}
                          </div>
                          {o.note && <div style={{ fontSize: 12, color: "#7f9cb8", fontStyle: "italic" }}>"{o.note}"</div>}
                        </div>
                        <button className="btn-danger" onClick={() => deleteOrder(o.id)} style={{ flexShrink: 0, fontSize: 12, padding: "6px 14px" }}>Rimuovi</button>
                      </div>
                    </div>
                  ))}

                  <div className="divider-line" />
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 4 }}>Gestione menù settimanale</div>
                  <p style={{ fontSize: 12, color: "#7f9cb8", marginBottom: 16 }}>Aggiungi quanti piatti vuoi per ogni categoria, con prezzo, e segnali come non disponibili o eliminali.</p>
                  {menu.map(day => {
                    const expanded = isDayExpanded(day.id);
                    const totalItems = KITCHEN_CATEGORIES.reduce((s, c) => s + (day[c.itemsKey] || []).length, 0);
                    return (
                      <div key={day.id} className="card" style={{ padding: "16px 20px", marginBottom: 10, borderLeft: `3px solid ${day.is_today ? "#fff" : "rgba(255,255,255,0.2)"}` }}>
                        {editingDay === day.id ? (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: "#fff" }}>Modifica giorno</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 10 }}>
                              <div><label style={{ fontSize: 11, color: "#9bb8d3", display: "block", marginBottom: 4 }}>Giorno</label><input type="text" value={editForm.day || ""} onChange={e => setEditForm(f => ({ ...f, day: e.target.value }))} /></div>
                              <div><label style={{ fontSize: 11, color: "#9bb8d3", display: "block", marginBottom: 4 }}>Data</label><input type="text" value={editForm.date || ""} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} /></div>
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="btn-primary" style={{ fontSize: 12, padding: "8px 18px" }} onClick={saveEdit}>Salva</button>
                              <button className="btn-ghost" style={{ fontSize: 12, padding: "8px 18px" }} onClick={() => setEditingDay(null)}>Annulla</button>
                            </div>
                          </div>
                        ) : (
                          <div onClick={() => toggleDayExpanded(day.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: expanded ? 16 : 0, cursor: "pointer" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontSize: 12, color: "#7f9cb8", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", display: "inline-block" }}>▶</span>
                              <span style={{ fontWeight: 600, fontSize: 16, color: "#fff" }}>{day.day} {day.date}</span>
                              {day.is_today && <span className="tag" style={{ background: "rgba(255,255,255,0.9)", color: "#1c3c5e", fontSize: 10 }}>Oggi</span>}
                              {!expanded && <span style={{ fontSize: 11, color: "#5b7a9a" }}>{totalItems} {totalItems === 1 ? "piatto" : "piatti"}</span>}
                            </div>
                            <div style={{ display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}>
                              {!day.is_today && <button className="btn-ghost" style={{ fontSize: 11, padding: "6px 14px" }} onClick={() => setToday(day.id)}>Imposta oggi</button>}
                              <button className="btn-ghost" style={{ fontSize: 11, padding: "6px 14px" }} onClick={() => startEdit(day)}>Modifica giorno</button>
                            </div>
                          </div>
                        )}
                        {expanded && (
                          <div className="admin-cat-grid" style={{ display: "grid" }}>
                            {KITCHEN_CATEGORIES.map(c => {
                              const items = day[c.itemsKey] || [];
                              const isHidden = (day.hidden_fields || []).includes(c.hideKey);
                              const inputKey = `${day.id}_${c.itemsKey}`;
                              const draft = newItemInputs[inputKey] || { nome: "", prezzo: "" };
                              return (
                                <div key={c.itemsKey} style={{ background: "rgba(255,255,255,0.03)", padding: "12px 14px", opacity: isHidden ? 0.5 : 1 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: "#9bb8d3", textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</span>
                                    <button onClick={() => toggleCategoryHidden(day.id, c.hideKey, day.hidden_fields)} style={{ background: "transparent", border: "none", color: isHidden ? "#8fcf9f" : "#e09a9a", fontSize: 10, cursor: "pointer" }}>
                                      {isHidden ? "Mostra" : "Nascondi"}
                                    </button>
                                  </div>
                                  {items.length === 0 && <div style={{ fontSize: 12, color: "#5b7a9a", fontStyle: "italic", marginBottom: 8 }}>Nessun piatto inserito</div>}
                                  {items.map((it, idx) => {
                                    const isEditingThis = editingItem?.dayId === day.id && editingItem?.itemsKey === c.itemsKey && editingItem?.index === idx;
                                    return isEditingThis ? (
                                      <div key={idx} className="item-row" style={{ flexWrap: "wrap", gap: 6 }}>
                                        <input type="text" value={editingItem.nome} onChange={e => setEditingItem(s => ({ ...s, nome: e.target.value }))} style={{ fontSize: 13, padding: "5px 8px", flex: 2, minWidth: 120 }} autoFocus />
                                        <span style={{ fontSize: 12, color: "#7f9cb8" }}>€</span>
                                        <input type="text" value={editingItem.prezzo} onChange={e => setEditingItem(s => ({ ...s, prezzo: e.target.value }))} onKeyDown={e => e.key === "Enter" && saveItemEdit(day.id, c.itemsKey, items, idx)} style={{ fontSize: 13, padding: "5px 8px", width: 64, textAlign: "right" }} />
                                        <div style={{ display: "flex", gap: 4 }}>
                                          <button className="field-control-btn" onClick={() => saveItemEdit(day.id, c.itemsKey, items, idx)} style={{ background: "rgba(90,154,106,0.2)", color: "#8fcf9f" }}>Salva</button>
                                          <button className="field-control-btn" onClick={() => setEditingItem(null)} style={{ background: "rgba(255,255,255,0.08)", color: "#9bb8d3" }}>Annulla</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div key={idx} className="item-row">
                                        <span style={{ fontSize: 13, color: it.unavailable ? "#6b7d8e" : "#fff", textDecoration: it.unavailable ? "line-through" : "none", flex: 1 }}>{it.nome}</span>
                                        <span style={{ fontSize: 12, color: "#7f9cb8" }}>€</span>
                                        <input type="text" inputMode="decimal" className="price-input" defaultValue={Number(it.prezzo || 0).toFixed(2)} onBlur={e => updateItemPrice(day.id, c.itemsKey, items, idx, e.target.value)} />
                                        <div style={{ display: "flex", gap: 4 }}>
                                          <button className="field-control-btn" onClick={() => setEditingItem({ dayId: day.id, itemsKey: c.itemsKey, index: idx, nome: it.nome, prezzo: Number(it.prezzo || 0).toFixed(2) })} style={{ background: "rgba(255,255,255,0.08)", color: "#9bb8d3" }}>Modifica</button>
                                          <button className="field-control-btn" onClick={() => toggleItemUnavailable(day.id, c.itemsKey, items, idx)} style={{ background: it.unavailable ? "rgba(90,154,106,0.2)" : "rgba(192,160,80,0.2)", color: it.unavailable ? "#8fcf9f" : "#d8be7a" }}>{it.unavailable ? "Disponibile" : "Esaurito"}</button>
                                          <button className="field-control-btn" onClick={() => removeItem(day.id, c.itemsKey, items, idx)} style={{ background: "rgba(180,70,70,0.2)", color: "#e09a9a" }}>✕</button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                    <input type="text" placeholder="Nuovo piatto..." value={draft.nome} onChange={e => setNewItemInputs(s => ({ ...s, [inputKey]: { ...draft, nome: e.target.value } }))} onKeyDown={e => e.key === "Enter" && addItem(day.id, c.itemsKey, items)} style={{ fontSize: 12, padding: "7px 10px", flex: 2 }} />
                                    <input type="text" placeholder="€" inputMode="decimal" value={draft.prezzo} onChange={e => setNewItemInputs(s => ({ ...s, [inputKey]: { ...draft, prezzo: e.target.value } }))} style={{ fontSize: 12, padding: "7px 10px", flex: 1, textAlign: "right" }} />
                                    <button className="btn-ghost" style={{ fontSize: 11, padding: "7px 12px", whiteSpace: "nowrap" }} onClick={() => addItem(day.id, c.itemsKey, items)}>+ Aggiungi</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ACCORDION: PRENOTAZIONI BISTROT */}
            <div className="card" style={{ overflow: "hidden" }}>
              <div onClick={() => { toggleAdminSection("bistrot"); setNewBookingCount(0); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", cursor: "pointer", userSelect: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 12, color: "#7f9cb8", display: "inline-block", transform: expandedAdmin.bistrot ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Prenotazioni Bistrot{newBookingCount > 0 && <span className="badge">{newBookingCount}</span>}</div>
                    <div style={{ fontSize: 12, color: "#7f9cb8", marginTop: 2 }}>Prenotazioni tavoli · Sospensione · Gestione menù Bistrot</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                  <span className="tag" style={{ background: "rgba(255,255,255,0.9)", color: "#1c3c5e", fontSize: 10 }}>{totalPeopleBooked} / {BISTROT_MAX} posti</span>
                  <button onClick={toggleBistrotLocked} style={{ padding: "8px 18px", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: bistrotLocked ? "rgba(80,150,80,0.85)" : "rgba(120,80,180,0.85)", color: "white", borderRadius: 2, fontFamily: "'Antonio', sans-serif" }}>
                    {bistrotLocked ? "Sblocca tab" : "Blocca tab"}
                  </button>
                  <button onClick={toggleBistrotSuspended} style={{ padding: "8px 18px", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: bistrotSuspended ? "rgba(80,150,80,0.85)" : "rgba(180,70,70,0.85)", color: "white", borderRadius: 2, fontFamily: "'Antonio', sans-serif" }}>
                    {bistrotSuspended ? "Riapri" : "Sospendi"}
                  </button>
                </div>
              </div>

              {expandedAdmin.bistrot && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "20px 22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 12 }}>Prenotazioni ricevute</div>
                  {bistrotBookings.length === 0 ? (
                    <div style={{ padding: "16px", fontSize: 14, color: "#7f9cb8", marginBottom: 20 }}>Nessuna prenotazione ancora.</div>
                  ) : (
                    <div style={{ marginBottom: 20 }}>
                      {bistrotBookings.map(b => (
                        <div key={b.id} className="order-row fade-in">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                                <span style={{ fontWeight: 600, fontSize: 15, color: "#fff" }}>{b.name}</span>
                                <span style={{ fontSize: 11, color: "#7f9cb8" }}>{new Date(b.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <span className="tag" style={{ background: "rgba(255,255,255,0.12)", color: "#cfe0ee" }}>{b.people} {b.people === 1 ? "persona" : "persone"}</span>
                                <span className="tag" style={{ background: "rgba(255,255,255,0.12)", color: "#cfe0ee" }}>{b.time_slot}</span>
                              </div>
                              {b.note && <div style={{ fontSize: 12, color: "#7f9cb8", fontStyle: "italic", marginTop: 6 }}>"{b.note}"</div>}
                            </div>
                            <button className="btn-danger" onClick={() => deleteBistrotBooking(b.id)} style={{ flexShrink: 0, fontSize: 12, padding: "6px 14px" }}>Rimuovi</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="divider-line" />
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: "#9bb8d3", textTransform: "uppercase", marginBottom: 16 }}>Gestione menù Bistrot</div>

                  {BISTROT_CATEGORIES.map(cat => {
                    const items = bistrotMenu.filter(i => i.categoria === cat);
                    return (
                      <div key={cat} style={{ background: "rgba(255,255,255,0.03)", padding: "14px 16px", marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#9bb8d3", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{cat}</div>
                        {items.length === 0 && <div style={{ fontSize: 12, color: "#5b7a9a", fontStyle: "italic", marginBottom: 8 }}>Nessuna voce inserita</div>}
                        {items.map(it => {
                          const isEditingThis = editingBistrotItem?.id === it.id;
                          return isEditingThis ? (
                            <div key={it.id} className="item-row" style={{ flexWrap: "wrap", gap: 6 }}>
                              <input type="text" value={editingBistrotItem.nome} onChange={e => setEditingBistrotItem(s => ({ ...s, nome: e.target.value }))} style={{ fontSize: 13, padding: "5px 8px", flex: 2, minWidth: 120 }} autoFocus />
                              <span style={{ fontSize: 12, color: "#7f9cb8" }}>€</span>
                              <input type="text" value={editingBistrotItem.prezzo} onChange={e => setEditingBistrotItem(s => ({ ...s, prezzo: e.target.value }))} onKeyDown={e => e.key === "Enter" && saveBistrotItemEdit()} style={{ fontSize: 13, padding: "5px 8px", width: 64, textAlign: "right" }} />
                              <div style={{ display: "flex", gap: 4 }}>
                                <button className="field-control-btn" onClick={saveBistrotItemEdit} style={{ background: "rgba(90,154,106,0.2)", color: "#8fcf9f" }}>Salva</button>
                                <button className="field-control-btn" onClick={() => setEditingBistrotItem(null)} style={{ background: "rgba(255,255,255,0.08)", color: "#9bb8d3" }}>Annulla</button>
                              </div>
                            </div>
                          ) : (
                            <div key={it.id} className="item-row">
                              <span style={{ fontSize: 13, color: it.unavailable ? "#6b7d8e" : "#fff", textDecoration: it.unavailable ? "line-through" : "none", flex: 1 }}>{it.nome}</span>
                              <span style={{ fontSize: 12, color: "#7f9cb8" }}>€</span>
                              <input type="text" inputMode="decimal" className="price-input" defaultValue={Number(it.prezzo || 0).toFixed(2)} onBlur={e => updateBistrotPrice(it.id, e.target.value)} />
                              <div style={{ display: "flex", gap: 4 }}>
                                <button className="field-control-btn" onClick={() => setEditingBistrotItem({ id: it.id, nome: it.nome, prezzo: Number(it.prezzo || 0).toFixed(2) })} style={{ background: "rgba(255,255,255,0.08)", color: "#9bb8d3" }}>Modifica</button>
                                <button className="field-control-btn" onClick={() => toggleBistrotUnavailable(it.id, it.unavailable)} style={{ background: it.unavailable ? "rgba(90,154,106,0.2)" : "rgba(192,160,80,0.2)", color: it.unavailable ? "#8fcf9f" : "#d8be7a" }}>{it.unavailable ? "Disponibile" : "Nascondi"}</button>
                                <button className="field-control-btn" onClick={() => removeBistrotItem(it.id)} style={{ background: "rgba(180,70,70,0.2)", color: "#e09a9a" }}>✕</button>
                              </div>
                            </div>
                          );
                        })}
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                          <input type="text" placeholder="Nuova voce..." value={newBistrotItem.categoria === cat ? newBistrotItem.nome : ""} onChange={e => setNewBistrotItem({ categoria: cat, nome: e.target.value, prezzo: newBistrotItem.categoria === cat ? newBistrotItem.prezzo : "" })} onKeyDown={e => e.key === "Enter" && newBistrotItem.categoria === cat && addBistrotItem()} style={{ fontSize: 12, padding: "7px 10px", flex: 2 }} />
                          <input type="text" placeholder="€" inputMode="decimal" value={newBistrotItem.categoria === cat ? newBistrotItem.prezzo : ""} onChange={e => setNewBistrotItem(s => ({ ...s, categoria: cat, prezzo: e.target.value }))} style={{ fontSize: 12, padding: "7px 10px", flex: 1, textAlign: "right" }} />
                          <button className="btn-ghost" style={{ fontSize: 11, padding: "7px 12px", whiteSpace: "nowrap" }} onClick={() => { setNewBistrotItem(s => ({ ...s, categoria: cat })); addBistrotItem(); }}>+ Aggiungi</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
