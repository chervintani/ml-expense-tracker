// Frontend logic for the Smart Expense Tracker.
// Served same-origin from Laravel's public/ dir, so the API base is relative.
"use strict";

const API_BASE = "/api";

// Each category owns one color token (--cat-<slug> in styles.css) and one icon
// (#i-<slug> in index.html), reused everywhere it appears.
const CATEGORY_SLUGS = {
  Food: "food",
  Transport: "transport",
  Utilities: "utilities",
  Shopping: "shopping",
  Bills: "bills",
  Other: "other",
  Uncategorized: "uncategorized",
};
const slugFor = (name) => CATEGORY_SLUGS[name] || "other";

// Populated from GET /api/categories; fallback covers the offline case.
let CATEGORIES = ["Bills", "Food", "Other", "Shopping", "Transport", "Utilities"];

const state = {
  expenses: [],     // loaded rows, newest first
  pagesLoaded: 0,
  lastPage: 1,
  total: 0,
  summary: null,
  category: null,   // category filter (null = all)
  flaggedOnly: false,
  query: "",
  flashId: null,    // row to highlight on the next render
  shownTotal: 0,    // value currently drawn in the hero (for the count-up)
};

const $ = (selector) => document.querySelector(selector);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const pesoCompactFormat = new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", notation: "compact", maximumFractionDigits: 1,
});
const percentFormat = new Intl.NumberFormat("en-PH", { style: "percent", maximumFractionDigits: 1 });

const peso = (n) => pesoFormat.format(Number(n) || 0);
const pct = (ratio) => percentFormat.format(Number.isFinite(ratio) ? ratio : 0);
// Floor, so a 99.96% prediction never reads as a flat 100%.
const confidencePct = (c) => pct(Math.floor(c * 1000) / 1000);
const count = (n) => Number(n).toLocaleString("en-PH");
const plural = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`;
const categoryOf = (e) => e.predicted_category || "Uncategorized";
// The ML fallback stores confidence 0; a real top prediction is always > 0.
const hasModelScore = (e) => e.prediction_confidence > 0;

function formatDate(value) {
  // Laravel sends microseconds; trim to milliseconds so every browser parses it.
  const d = new Date(String(value).replace(/(\.\d{3})\d+/, "$1"));
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-PH", opts);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

// Small element builder. Children that are strings become text nodes, so API
// data is never parsed as HTML.
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  fill(node, ...children);
  return node;
}

// replaceChildren() stringifies null/false ("null"), so drop them first.
function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

const SVG_NS = "http://www.w3.org/2000/svg";
function icon(name, extraClass = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `icon ${extraClass}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const catStyle = (name, extra = {}) => ({ "--c": `var(--cat-${slugFor(name)})`, ...extra });

function avatar(name, size = "") {
  return h("span", { class: `avatar ${size}`.trim(), style: catStyle(name) }, icon(slugFor(name)));
}

function emptyBlock(iconName, title, text, action) {
  return h("div", { class: "empty" },
    h("span", { class: "empty-icon" }, icon(iconName)),
    h("p", { class: "empty-title" }, title),
    h("p", { class: "empty-text" }, text),
    action,
  );
}

// Re-rendering replaces buttons; put keyboard focus back on the button with the
// same data-key (or the fallback key, if that button no longer exists) so
// keyboard users keep their place.
function keepFocus(container, render, fallbackKey) {
  const active = document.activeElement;
  const key = container.contains(active) ? active.dataset.key : undefined;
  render();
  if (key === undefined) return;
  const find = (k) => container.querySelector(`[data-key="${CSS.escape(k)}"]`);
  (find(key) || (fallbackKey && find(fallbackKey(key))))?.focus({ preventScroll: true });
}

function toast(message, tone = "success") {
  const node = h("div", { class: `toast toast-${tone}` },
    icon(tone === "error" ? "alert" : "check-circle"),
    h("span", {}, message));
  $("#toasts").append(node);
  setTimeout(() => {
    node.classList.add("leaving");
    setTimeout(() => node.remove(), 260);
  }, tone === "error" ? 6000 : 3200);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try { const body = await res.json(); if (body.message) detail = body.message; } catch (_) { /* not JSON */ }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

async function loadCategories() {
  try {
    const cats = await api("/categories");
    if (Array.isArray(cats) && cats.length) CATEGORIES = cats.map((c) => c.name);
  } catch (_) { /* keep fallback list */ }
}

const HEALTH_TEXT = {
  ok: ["Model online", "ML service is up: new expenses are categorized automatically"],
  down: ["Model offline", "ML service is unreachable: new expenses are saved as Uncategorized"],
  error: ["API offline", "Can't reach the Laravel API"],
};

async function checkHealth() {
  let status = "error";
  try {
    const res = await api("/health");
    status = res.ml === "ok" ? "ok" : "down";
  } catch (_) { /* API unreachable */ }
  const pill = $("#ml-status");
  pill.dataset.state = status;
  pill.querySelector(".label").textContent = HEALTH_TEXT[status][0];
  pill.title = HEALTH_TEXT[status][1];
  pill.setAttribute("aria-label", HEALTH_TEXT[status][0]);
}

// ---------------------------------------------------------------------------
// Overview (hero + KPIs), breakdown and filters — all driven by the summary
// ---------------------------------------------------------------------------

async function loadSummary() {
  try {
    state.summary = await api("/dashboard/summary");
  } catch (err) {
    if (!state.summary) {
      $("#hero-value").textContent = "—";
      $("#hero-value-sr").textContent = "Unavailable";
      $("#breakdown").replaceChildren(h("li", {},
        emptyBlock("alert", "Summary unavailable", err.message)));
    }
    return;
  }
  renderOverview();
  renderBreakdown();
  renderFilters();
}

function renderOverview() {
  const cats = state.summary.categories || [];
  const total = Number(state.summary.total_spend) || 0;
  const expenseCount = cats.reduce((n, c) => n + c.count, 0);
  const outliers = state.summary.outlier_count || 0;

  countTo(total);
  $("#hero-count").textContent = plural(expenseCount, "expense", "expenses");
  $("#hero-cats").textContent = plural(cats.length, "category", "categories");

  const top = cats[0];
  const topTile = $("#kpi-top");
  topTile.querySelector(".kpi-value").textContent = top ? top.category : "—";
  topTile.querySelector(".kpi-sub").textContent = top
    ? `${peso(top.total)} · ${pct(top.total / total)} of spend`
    : "Nothing logged yet";
  topTile.querySelector(".kpi-icon").replaceChildren(top ? avatar(top.category) : icon("trending"));

  const avgTile = $("#kpi-avg");
  avgTile.querySelector(".kpi-value").textContent = expenseCount ? peso(total / expenseCount) : "—";
  avgTile.querySelector(".kpi-sub").textContent = expenseCount ? "per expense" : "Nothing logged yet";

  const outlierTile = $("#kpi-outliers");
  outlierTile.dataset.state = outliers ? "alert" : "clear";
  outlierTile.disabled = !outliers && !state.flaggedOnly;
  outlierTile.setAttribute("aria-pressed", String(state.flaggedOnly));
  outlierTile.title = outliers ? (state.flaggedOnly ? "Show all expenses" : "Show only flagged expenses") : "";
  outlierTile.querySelector(".kpi-value").textContent = count(outliers);
  outlierTile.querySelector(".kpi-sub").textContent = outliers
    ? (state.flaggedOnly ? "Showing flagged only" : "Needs review")
    : "Nothing unusual";
  outlierTile.querySelector(".kpi-icon").replaceChildren(icon(outliers ? "alert" : "check-circle"));
}

let countFrame = 0;
function countTo(target) {
  const from = state.shownTotal;
  state.shownTotal = target;
  $("#hero-value-sr").textContent = peso(target);
  cancelAnimationFrame(countFrame);
  if (reducedMotion.matches || from === target) {
    drawHeroValue(target);
    return;
  }
  const start = performance.now();
  const duration = 900;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    drawHeroValue(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) countFrame = requestAnimationFrame(step);
  };
  countFrame = requestAnimationFrame(step);
}

function drawHeroValue(n) {
  const el = $("#hero-value");
  if (n >= 1e7) {
    el.textContent = pesoCompactFormat.format(n);
    return;
  }
  const parts = pesoFormat.formatToParts(n);
  const pick = (...types) => parts.filter((p) => types.includes(p.type)).map((p) => p.value).join("");
  el.replaceChildren(
    h("span", { class: "cur" }, pick("currency")),
    pick("integer", "group"),
    h("span", { class: "dec" }, pick("decimal", "fraction")),
  );
}

let breakdownAnimated = false;
function renderBreakdown() {
  if (!state.summary) return;
  const list = $("#breakdown");
  const cats = state.summary.categories || [];
  const total = cats.reduce((n, c) => n + c.total, 0);

  $("#clear-category").hidden = !state.category;
  list.classList.toggle("has-active", Boolean(state.category));
  list.classList.toggle("animate", !breakdownAnimated && cats.length > 0);
  if (cats.length) breakdownAnimated = true;

  if (!cats.length) {
    list.replaceChildren(h("li", {},
      emptyBlock("bars", "No spending yet", "Your category breakdown appears after the first expense.")));
    return;
  }

  keepFocus(list, () => list.replaceChildren(...cats.map((c, i) => {
    const share = total ? c.total / total : 0;
    const active = state.category === c.category;
    return h("li", {},
      h("button", {
        type: "button",
        class: "cat-row",
        "data-key": c.category,
        "aria-pressed": String(active),
        title: active ? "Show all categories" : `Show only ${c.category}`,
        style: catStyle(c.category, { "--i": String(i) }),
        onclick: () => setCategory(active ? null : c.category),
      },
        avatar(c.category),
        h("span", { class: "cat-row-body" },
          h("span", { class: "cat-row-line" },
            h("span", { class: "cat-row-name" }, c.category),
            h("span", { class: "cat-row-amount" }, peso(c.total))),
          h("span", { class: "bar", "aria-hidden": "true" },
            h("span", { class: "bar-fill", style: { "--w": `${(share * 100).toFixed(2)}%` } })),
          h("span", { class: "cat-row-line sub" },
            h("span", {}, `${plural(c.count, "expense", "expenses")} · avg ${peso(c.total / c.count)}`),
            h("span", {}, pct(share))),
        ),
      ),
    );
  })));
}

function renderFilters() {
  const bar = $("#filters");
  const names = (state.summary?.categories || []).map((c) => c.category);
  if (state.category && !names.includes(state.category)) names.push(state.category);
  const outliers = state.summary?.outlier_count || 0;

  keepFocus(bar, () => fill(bar,
    h("button", {
      type: "button", class: "filter-chip", "data-key": "__all",
      "aria-pressed": String(!state.category && !state.flaggedOnly),
      onclick: showAll,
    }, "All"),
    ...names.map((name) => h("button", {
      type: "button", class: "filter-chip", "data-key": name,
      "aria-pressed": String(state.category === name),
      style: catStyle(name),
      onclick: () => setCategory(state.category === name ? null : name),
    }, h("span", { class: "dot" }), name)),
    outliers || state.flaggedOnly
      ? h("button", {
        type: "button", class: "filter-chip", "data-key": "__flagged",
        "aria-pressed": String(state.flaggedOnly),
        onclick: () => setFlagged(!state.flaggedOnly),
      }, icon("alert"), `Flagged · ${count(outliers)}`)
      : null,
  ));
}

function setCategory(name) {
  state.category = name;
  renderBreakdown();
  renderFilters();
  renderExpenses();
}

function setFlagged(on) {
  state.flaggedOnly = on;
  if (state.summary) renderOverview();
  renderFilters();
  renderExpenses();
}

// "All" chip: drop the category/flagged filters but keep the search text.
function showAll() {
  state.flaggedOnly = false;
  if (state.summary) renderOverview();
  setCategory(null);
}

function clearFilters() {
  state.query = "";
  $("#search").value = "";
  showAll();
}

// ---------------------------------------------------------------------------
// Expense list
// ---------------------------------------------------------------------------

// Fetch pages 1..n (in parallel) and merge them. Used for the first load and
// for refreshes after an add/delete, so "Load more" progress is kept.
async function loadExpenses({ pages = Math.max(1, state.pagesLoaded) } = {}) {
  try {
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) => api(`/expenses?page=${i + 1}`)));
    const seen = new Set();
    const rows = [];
    for (const page of results) {
      for (const e of page.data || []) {
        if (!seen.has(e.id)) { seen.add(e.id); rows.push(e); }
      }
    }
    const last = results[results.length - 1];
    state.expenses = rows;
    state.lastPage = last.last_page || 1;
    state.total = last.total ?? rows.length;
    state.pagesLoaded = Math.min(pages, state.lastPage);
    renderExpenses();
  } catch (err) {
    if (state.pagesLoaded) {
      toast(`Couldn't refresh expenses: ${err.message}`, "error");
      return;
    }
    $("#expense-table").hidden = true;
    const empty = $("#empty-state");
    empty.hidden = false;
    empty.replaceChildren(emptyBlock("alert", "Couldn't load expenses", err.message,
      h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => loadExpenses({ pages: 1 }) },
        icon("refresh"), "Try again")));
  }
}

async function loadMore() {
  const btn = $("#load-more");
  btn.disabled = true;
  try {
    const page = await api(`/expenses?page=${state.pagesLoaded + 1}`);
    const known = new Set(state.expenses.map((e) => e.id));
    state.expenses.push(...(page.data || []).filter((e) => !known.has(e.id)));
    state.pagesLoaded += 1;
    state.lastPage = page.last_page || state.lastPage;
    state.total = page.total ?? state.total;
    renderExpenses();
  } catch (err) {
    toast(`Couldn't load more: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

function visibleExpenses() {
  const q = state.query.trim().toLowerCase();
  return state.expenses.filter((e) =>
    (!state.category || categoryOf(e) === state.category) &&
    (!state.flaggedOnly || e.is_outlier) &&
    (!q || e.description.toLowerCase().includes(q) || categoryOf(e).toLowerCase().includes(q)));
}

let rowsAnimated = false;
function renderExpenses() {
  const rows = visibleExpenses();
  const filtered = Boolean(state.category || state.flaggedOnly || state.query.trim());
  const tbody = $("#expense-rows");

  tbody.classList.toggle("animate", !rowsAnimated);
  rowsAnimated = true;
  // If a row's confirm button vanished (row is now verified), land on its chip.
  keepFocus(tbody, () => tbody.replaceChildren(...rows.map(renderRow)),
    (key) => key.replace(/:.*/, ":chip"));
  state.flashId = null;

  $("#expense-table").hidden = rows.length === 0;
  const empty = $("#empty-state");
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    const more = state.pagesLoaded < state.lastPage;
    empty.replaceChildren(filtered
      ? emptyBlock("search", "No matching expenses",
        more ? "Nothing in the loaded expenses matches. Load more, or clear the filters."
          : "Try another search, or clear the filters.",
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: clearFilters }, "Clear filters"))
      : emptyBlock("inbox", "No expenses yet", "Add your first one and the model will categorize it instantly."));
  }

  $("#expense-count").textContent = count(state.total);
  const loaded = state.expenses.length;
  $("#list-meta").textContent = filtered
    ? `${plural(rows.length, "match", "matches")} in ${count(loaded)} loaded`
    : loaded ? `Showing ${count(loaded)} of ${count(state.total)}` : "";
  $("#load-more").hidden = state.pagesLoaded >= state.lastPage;
}

function renderRow(e, index) {
  const cat = categoryOf(e);
  const uncategorized = cat === "Uncategorized";
  const confirmed = e.status === "confirmed";
  const classes = [e.is_outlier && "is-outlier", e.id === state.flashId && "is-new"].filter(Boolean).join(" ");

  const tr = h("tr", {
    class: classes || null,
    "data-id": String(e.id),
    style: { "--i": String(Math.min(index, 12)) },
  });

  const expenseCell = h("td", { class: "cell-expense" },
    h("div", { class: "expense-main" },
      avatar(cat),
      h("div", { class: "expense-text" },
        h("span", { class: "expense-desc" }, e.description),
        h("span", { class: "row-meta" }, formatDate(e.created_at)),
        e.is_outlier
          ? h("span", { class: "row-reason" }, icon("alert"),
            h("span", {}, e.outlier_reason || "Unusually large for this category"))
          : null,
      ),
    ),
  );

  const tag = confirmed
    ? h("span", { class: "tag tag-verified", title: "Confirmed by you" }, icon("check-circle"), "Verified")
    : uncategorized
      ? h("span", { class: "tag tag-missing" }, icon("alert"), "Needs a category")
      : h("span", { class: "tag tag-ai", title: "Predicted by the model, not yet confirmed" }, icon("sparkles"), "AI guess");

  const categoryCell = h("td", { class: "cell-category" },
    h("div", { class: "cat-cell" },
      h("button", {
        type: "button",
        class: `chip${uncategorized ? " is-empty" : ""}`,
        "data-key": `${e.id}:chip`,
        style: catStyle(cat),
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        "aria-label": `${cat}: change category for ${e.description}`,
        onclick: (ev) => openCategoryMenu(ev.currentTarget, e),
      }, h("span", { class: "dot" }), cat, icon("chevron")),
      tag,
    ),
  );

  const confidenceCell = h("td", { class: "cell-confidence" },
    hasModelScore(e)
      ? confidenceMeter(e.prediction_confidence)
      : h("span", { class: "confidence-muted", title: "Not scored by the model" }, "—"));

  const amountCell = h("td", { class: "cell-amount num" },
    h("div", { class: "amount-cell" },
      h("span", { class: "amount" }, peso(e.amount)),
      e.is_outlier ? h("span", { class: "pill pill-crit" }, icon("alert"), "Outlier") : null,
    ),
  );

  const actions = h("div", { class: "row-actions" });
  if (!confirmed && !uncategorized) {
    actions.append(h("button", {
      type: "button",
      class: "icon-btn sm good",
      "data-key": `${e.id}:confirm`,
      title: `Looks right: confirm ${cat}`,
      "aria-label": `Confirm ${cat} for ${e.description}`,
      onclick: () => confirmExpense(e, cat),
    }, icon("check")));
  }
  actions.append(h("button", {
    type: "button",
    class: "icon-btn sm danger",
    "data-key": `${e.id}:delete`,
    title: "Delete",
    "aria-label": `Delete ${e.description}`,
    onclick: () => deleteExpense(e),
  }, icon("trash")));

  tr.append(expenseCell, categoryCell, confidenceCell, amountCell,
    h("td", { class: "cell-actions" }, actions));
  return tr;
}

function confidenceMeter(confidence, { label = false } = {}) {
  const low = confidence < 0.6;
  const value = confidencePct(confidence);
  const meter = h("span", { class: "meter", "aria-hidden": "true" },
    h("span", { class: "meter-fill", style: { "--w": `${Math.max(2, confidence * 100)}%` } }));
  const text = low ? `${value} · low` : value;
  return h("div", { class: `confidence${low ? " low" : ""}`, title: low ? "Low confidence: worth a check" : null },
    label
      ? h("span", { class: "confidence-line" }, h("span", {}, "Model confidence"), h("strong", {}, text))
      : null,
    meter,
    label ? null : h("span", { class: "confidence-value" }, text),
  );
}

// ---------------------------------------------------------------------------
// Category menu (shared popover)
// ---------------------------------------------------------------------------

const menu = $("#cat-menu");
let menuAnchor = null;

function openCategoryMenu(anchor, expense) {
  if (menuAnchor === anchor) { closeMenu(); return; }
  closeMenu();
  const current = categoryOf(expense);
  menu.replaceChildren(
    h("p", { class: "menu-title", "aria-hidden": "true" }, "Set category"),
    ...CATEGORIES.map((name) => h("button", {
      type: "button",
      class: "menu-item",
      role: "menuitemradio",
      tabindex: "-1",
      "aria-checked": String(name === current),
      onclick: () => { closeMenu({ restoreFocus: true }); confirmExpense(expense, name); },
    }, avatar(name, "xs"), h("span", {}, name), name === current ? icon("check", "menu-check") : null)),
  );
  menu.hidden = false;
  menuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");

  // Below the anchor if it fits, otherwise above; clamped to the viewport.
  const r = anchor.getBoundingClientRect();
  const { offsetWidth: w, offsetHeight: mh } = menu;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  const target = menu.querySelector('[aria-checked="true"]') || menu.querySelector(".menu-item");
  target?.focus({ preventScroll: true });
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!menuAnchor) return;
  const anchor = menuAnchor;
  menuAnchor = null;
  menu.hidden = true;
  anchor.setAttribute("aria-expanded", "false");
  if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
}

menu.addEventListener("keydown", (ev) => {
  const items = [...menu.querySelectorAll(".menu-item")];
  const i = items.indexOf(document.activeElement);
  const move = (to) => { ev.preventDefault(); items[(to + items.length) % items.length].focus(); };
  if (ev.key === "ArrowDown") move(i + 1);
  else if (ev.key === "ArrowUp") move(i - 1);
  else if (ev.key === "Home") move(0);
  else if (ev.key === "End") move(items.length - 1);
  else if (ev.key === "Escape" || ev.key === "Tab") { ev.preventDefault(); closeMenu({ restoreFocus: true }); }
});
document.addEventListener("pointerdown", (ev) => {
  if (menuAnchor && !menu.contains(ev.target) && !menuAnchor.contains(ev.target)) closeMenu();
});
window.addEventListener("resize", () => closeMenu());
document.addEventListener("scroll", (ev) => { if (!menu.contains(ev.target)) closeMenu(); }, true);

// ---------------------------------------------------------------------------
// Actions: confirm, delete, add
// ---------------------------------------------------------------------------

async function confirmExpense(expense, category) {
  const previous = categoryOf(expense);
  try {
    const updated = await api(`/expenses/${expense.id}/confirm`, {
      method: "PATCH",
      body: JSON.stringify({ category }),
    });
    state.expenses = state.expenses.map((e) => (e.id === updated.id ? updated : e));
    renderExpenses();
    if (predictionId === updated.id) showPrediction(updated, { animate: false });
    toast(category === previous ? `Confirmed as ${category}` : `Moved to ${category}`);
    loadSummary();
  } catch (err) {
    toast(`Couldn't save: ${err.message}`, "error");
  }
}

function confirmDialog(title, body) {
  const dialog = $("#confirm-dialog");
  if (typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  $("#dialog-title").textContent = title;
  $("#dialog-body").textContent = body;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}
// A click that lands on the dialog element itself is a click on the backdrop.
$("#confirm-dialog").addEventListener("click", (ev) => {
  if (ev.target === ev.currentTarget) ev.currentTarget.close("cancel");
});

async function deleteExpense(expense) {
  const ok = await confirmDialog("Delete this expense?",
    `“${expense.description}” (${peso(expense.amount)}) will be removed from your dashboard.`);
  if (!ok) return;
  try {
    await api(`/expenses/${expense.id}`, { method: "DELETE" });
    document.querySelector(`#expense-rows tr[data-id="${expense.id}"]`)?.classList.add("removing");
    if (predictionId === expense.id) hidePrediction();
    await Promise.all([loadExpenses(), loadSummary(), sleep(200)]);
    // The focused delete button went away with its row.
    if (!document.activeElement || document.activeElement === document.body) {
      $("#expenses-title").focus({ preventScroll: true });
    }
    toast("Expense deleted");
  } catch (err) {
    toast(`Couldn't delete: ${err.message}`, "error");
  }
}

const panel = $("#prediction");
let predictionId = null;

function showPrediction(e, { animate = true } = {}) {
  const cat = categoryOf(e);
  const fallback = cat === "Uncategorized";
  const confirmed = e.status === "confirmed";
  predictionId = e.id;

  panel.style.setProperty("--c", `var(--cat-${slugFor(cat)})`);
  keepFocus(panel, () => fill(panel,
    h("div", { class: "prediction-head" },
      avatar(cat, "lg"),
      h("div", { class: "prediction-text" },
        h("p", { class: "prediction-kicker" },
          fallback ? "Saved without a category" : confirmed ? "Confirmed as" : "Categorized as"),
        h("p", { class: "prediction-title" }, cat),
        h("p", { class: "prediction-desc" }, `${e.description} · ${peso(e.amount)}`),
      ),
      h("button", {
        type: "button", class: "icon-btn sm", "data-key": "dismiss", "aria-label": "Dismiss",
        onclick: hidePrediction,
      }, icon("x")),
    ),
    fallback
      ? h("div", { class: "alert neutral" }, icon("uncategorized"),
        h("div", {}, h("strong", {}, "The model didn't respond"),
          h("span", {}, "The expense is saved. Pick its category below.")))
      : hasModelScore(e) ? confidenceMeter(e.prediction_confidence, { label: true }) : null,
    e.is_outlier
      ? h("div", { class: "alert" }, icon("alert"),
        h("div", {}, h("strong", {}, "Unusually large expense"),
          h("span", {}, e.outlier_reason || `Much higher than your usual ${cat} spend.`)))
      : null,
    h("div", { class: "prediction-actions" },
      confirmed
        ? h("span", { class: "tag tag-verified" }, icon("check-circle"), "Verified")
        : fallback ? null : h("button", {
          type: "button", class: "btn btn-good btn-sm", "data-key": "confirm",
          onclick: () => confirmExpense(e, cat),
        }, icon("check"), "Looks right"),
      h("button", {
        type: "button", class: "btn btn-ghost btn-sm", "data-key": "change",
        "aria-haspopup": "menu", "aria-expanded": "false",
        onclick: (ev) => openCategoryMenu(ev.currentTarget, e),
      }, fallback ? "Choose category" : "Change", icon("chevron")),
    ),
  ), () => "change");
  panel.hidden = false;
  panel.classList.remove("pop");
  if (animate) {
    void panel.offsetWidth; // restart the entrance animation
    panel.classList.add("pop");
  }
}

function hidePrediction() {
  panel.hidden = true;
  predictionId = null;
}

function setBusy(busy) {
  const btn = $("#submit-btn");
  btn.disabled = busy;
  btn.classList.toggle("is-busy", busy);
  btn.querySelector(".btn-label").textContent = busy ? "Categorizing…" : "Add & categorize";
}

$("#expense-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget;
  const description = $("#description").value.trim();
  const amount = $("#amount").value;
  const status = $("#form-status");
  if (!description || amount === "") return;

  setBusy(true);
  status.replaceChildren();
  try {
    const created = await api("/expenses", {
      method: "POST",
      body: JSON.stringify({ description, amount: Number(amount) }),
    });
    form.reset();
    state.flashId = created.id;
    showPrediction(created);
    await Promise.all([loadExpenses(), loadSummary()]);
    if (categoryOf(created) === "Uncategorized") checkHealth();
  } catch (err) {
    status.replaceChildren(icon("alert"), h("span", {}, err.message));
  } finally {
    setBusy(false);
    $("#description").focus();
  }
});

for (const btn of document.querySelectorAll(".suggestion")) {
  btn.addEventListener("click", () => {
    $("#description").value = btn.textContent;
    $("#amount").value = btn.dataset.amount;
    $("#amount").focus();
  });
}

$("#load-more").addEventListener("click", loadMore);
$("#clear-category").addEventListener("click", () => setCategory(null));
$("#kpi-outliers").addEventListener("click", () => {
  setFlagged(!state.flaggedOnly);
  if (state.flaggedOnly) $(".expenses-card").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
});

$("#search").addEventListener("input", (ev) => {
  state.query = ev.target.value;
  renderExpenses();
});

// "/" jumps to search, unless the user is typing somewhere.
document.addEventListener("keydown", (ev) => {
  const typing = ev.target instanceof Element && ev.target.matches("input, textarea, select, [contenteditable]");
  if (ev.key === "/" && !typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    ev.preventDefault();
    $("#search").focus();
  }
});

// ---------------------------------------------------------------------------
// Theme + greeting
// ---------------------------------------------------------------------------

// The page opens in light mode (data-theme="light" in index.html); the toggle
// switches themes for the current visit only.
const root = document.documentElement;
const activeTheme = () => (root.dataset.theme === "dark" ? "dark" : "light");

function syncThemeButton() {
  const dark = activeTheme() === "dark";
  const btn = $("#theme-toggle");
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  btn.replaceChildren(icon(dark ? "sun" : "moon"));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  $('meta[name="theme-color"]').setAttribute("content", dark ? "#090b13" : "#f5f6fb");
}

$("#theme-toggle").addEventListener("click", () => {
  root.dataset.theme = activeTheme() === "dark" ? "light" : "dark";
  syncThemeButton();
});

function renderGreeting() {
  const now = new Date();
  const hour = now.getHours();
  $("#greeting").textContent = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  $("#today").textContent = now.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async () => {
  renderGreeting();
  syncThemeButton();
  checkHealth();
  setInterval(() => { if (!document.hidden) checkHealth(); }, 30000);
  await loadCategories();
  await Promise.all([loadExpenses({ pages: 1 }), loadSummary()]);
})();
