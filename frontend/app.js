// Frontend logic for the Smart Expense Tracker.
// Served same-origin from Laravel's public/ dir, so the API base is relative.
const API_BASE = "/api";

const CATEGORY_COLORS = {
  Food: "#e8590c", Transport: "#1c7ed6", Utilities: "#2f9e44",
  Shopping: "#9c36b5", Bills: "#e03131", Other: "#868e96",
  Uncategorized: "#adb5bd",
};

// Populated from GET /api/categories; fallback covers the offline case.
let CATEGORIES = ["Food", "Transport", "Utilities", "Shopping", "Bills", "Other"];

const peso = (n) =>
  "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function api(path, options) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try { const body = await res.json(); if (body.message) detail = body.message; } catch (_) {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function badge(category, confirmed) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
  const chip = `<span class="badge" style="background:${color}">${escapeHtml(category || "Uncategorized")}</span>`;
  return chip + (confirmed ? ' <span class="confirmed" title="Confirmed by user">✓</span>' : "");
}

async function loadCategories() {
  try {
    const cats = await api("/categories");
    if (Array.isArray(cats) && cats.length) CATEGORIES = cats.map((c) => c.name);
  } catch (_) { /* keep fallback list */ }
}

async function checkHealth() {
  const el = document.getElementById("ml-status");
  try {
    const h = await api("/health");
    el.textContent = `API: ${h.api} · ML service: ${h.ml}`;
    el.style.color = h.ml === "ok" ? "var(--muted)" : "#e03131";
  } catch (_) { el.textContent = ""; }
}

function renderRow(e) {
  const tr = document.createElement("tr");
  if (e.is_outlier) tr.classList.add("outlier");

  const conf = e.prediction_confidence != null ? Math.round(e.prediction_confidence * 100) + "%" : "—";
  const cat = e.predicted_category || "Uncategorized";
  const confirmed = e.status === "confirmed";
  const flag = e.is_outlier
    ? `<span class="flag" title="${escapeHtml(e.outlier_reason || "")}">⚠ outlier</span>`
    : "";

  tr.innerHTML =
    `<td>${escapeHtml(e.description)}</td>` +
    `<td>${peso(e.amount)}</td>` +
    `<td>${badge(cat, confirmed)}</td>` +
    `<td>${conf}</td>` +
    `<td>${flag}</td>` +
    `<td>${formatDate(e.created_at)}</td>` +
    `<td class="actions"></td>`;

  const wrap = document.createElement("div");
  wrap.className = "action-wrap";

  const select = document.createElement("select");
  for (const name of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === cat) opt.selected = true;
    select.appendChild(opt);
  }

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.className = "btn-save";
  saveBtn.onclick = () => confirmExpense(e.id, select.value);

  const delBtn = document.createElement("button");
  delBtn.textContent = "✕";
  delBtn.className = "btn-del";
  delBtn.title = "Delete";
  delBtn.onclick = () => deleteExpense(e.id);

  wrap.append(select, saveBtn, delBtn);
  tr.querySelector(".actions").appendChild(wrap);
  return tr;
}

async function loadExpenses() {
  const tbody = document.getElementById("expense-rows");
  const empty = document.getElementById("empty-state");
  try {
    const res = await api("/expenses");
    const expenses = res.data || res; // paginated -> { data: [...] }
    tbody.innerHTML = "";
    empty.style.display = expenses.length ? "none" : "block";
    for (const e of expenses) tbody.appendChild(renderRow(e));
  } catch (err) {
    empty.style.display = "block";
    empty.textContent = "Could not load expenses: " + err.message;
  }
}

async function loadSummary() {
  const el = document.getElementById("summary");
  try {
    const summary = await api("/dashboard/summary");
    const cats = summary.categories || [];
    if (!cats.length) { el.innerHTML = '<p class="status">No spending yet.</p>'; return; }
    const max = Math.max(1, ...cats.map((c) => Number(c.total)));
    el.innerHTML = cats.map((c) =>
      `<div class="bar-row">` +
        `<span class="bar-label">${escapeHtml(c.category)}</span>` +
        `<span class="bar-track"><span class="bar-fill" style="width:${(Number(c.total) / max) * 100}%;background:${CATEGORY_COLORS[c.category] || CATEGORY_COLORS.Other}"></span></span>` +
        `<span class="bar-value">${peso(c.total)}</span>` +
      `</div>`
    ).join("") +
      `<p class="outlier-count">Flagged outliers: <strong>${summary.outlier_count ?? 0}</strong></p>`;
  } catch (err) {
    el.innerHTML = `<p class="status">Summary unavailable: ${escapeHtml(err.message)}</p>`;
  }
}

async function confirmExpense(id, category) {
  try {
    await api(`/expenses/${id}/confirm`, { method: "PATCH", body: JSON.stringify({ category }) });
    await Promise.all([loadExpenses(), loadSummary()]);
  } catch (err) {
    alert("Could not save: " + err.message);
  }
}

async function deleteExpense(id) {
  if (!window.confirm("Delete this expense?")) return;
  try {
    await api(`/expenses/${id}`, { method: "DELETE" });
    await Promise.all([loadExpenses(), loadSummary()]);
  } catch (err) {
    alert("Could not delete: " + err.message);
  }
}

document.getElementById("expense-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const description = document.getElementById("description").value.trim();
  const amount = document.getElementById("amount").value;
  const status = document.getElementById("form-status");
  const btn = document.getElementById("submit-btn");
  if (!description || amount === "") return;
  btn.disabled = true;
  status.textContent = "Categorizing…";
  try {
    await api("/expenses", {
      method: "POST",
      body: JSON.stringify({ description, amount: Number(amount) }),
    });
    document.getElementById("expense-form").reset();
    status.textContent = "";
    await Promise.all([loadExpenses(), loadSummary()]);
  } catch (err) {
    status.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
    document.getElementById("description").focus();
  }
});

(async () => {
  await loadCategories();
  loadExpenses();
  loadSummary();
  checkHealth();
})();
