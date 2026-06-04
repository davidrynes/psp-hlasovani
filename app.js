"use strict";

// Barvy klubů podle zkratky z otevřených dat PSP (10. období).
const KLUB_COLORS = {
  "ANO2011": "#0a318b",
  "ODS": "#0073cf",
  "SPD": "#1b6ec2",
  "STAN": "#e2001a",
  "Piráti": "#000000",
  "KDU-ČSL": "#f7b500",
  "TOP09": "#7d3f98",
  "Moto": "#2b2b2b",
  "MS": "#c0392b",
};
const FALLBACK_COLORS = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#64748b"];
function klubColor(zkr, i) {
  return KLUB_COLORS[zkr] || FALLBACK_COLORS[(i || 0) % FALLBACK_COLORS.length];
}
function pctColor(p) { return p >= 80 ? "var(--good)" : p >= 55 ? "var(--warn)" : "var(--bad)"; }
function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
const PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50"><rect width="40" height="50" fill="#e7e9ee"/><circle cx="20" cy="19" r="9" fill="#c4c8d0"/><rect x="7" y="32" width="26" height="18" rx="9" fill="#c4c8d0"/></svg>');

const state = { data: null, klub: "", q: "", onlyActive: true, sort: "pct_hlasoval", dir: -1 };
const $ = id => document.getElementById(id);

fetch("data/poslanci.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(init)
  .catch(err => {
    $("subtitle").textContent = "Nepodařilo se načíst data (" + err + "). Spusťte scraper: python3 scraper/scrape.py";
  });

function init(data) {
  // přiřaď index barvy klubu podle pořadí
  const order = {}; data.kluby.forEach((k, i) => order[k.zkratka] = i);
  data.poslanci.forEach(p => p._ci = order[p.klub] ?? 0);
  state.data = data;

  const d = new Date(data.generated_at);
  $("subtitle").innerHTML =
    `Poslanecká sněmovna, <b>${data.term.cislo}. volební období</b> &nbsp;·&nbsp; ` +
    `<b>${data.votings_valid.toLocaleString("cs")}</b> platných jmenovitých hlasování &nbsp;·&nbsp; ` +
    `data k <b>${d.toLocaleDateString("cs")}</b>`;
  $("freshness").innerHTML =
    `Aktualizováno ${d.toLocaleString("cs")}. Čísla mohou být mírně nižší než web PSP o právě probíhající (neuzavřenou) schůzi.`;

  renderKpis();
  renderClubs();
  buildKlubSelect();
  bindControls();
  render();
}

function activeList() {
  let list = state.data.poslanci.slice();
  if (state.onlyActive) list = list.filter(p => p.aktivni);
  return list;
}

function renderKpis() {
  const list = activeList();
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const byHl = list.slice().sort((a, b) => b.stats.pct_hlasoval - a.stats.pct_hlasoval);
  const worst = list.slice().sort((a, b) => b.stats.pct_neprihlasen - a.stats.pct_neprihlasen)[0];
  const top = byHl[0];
  const kpis = [
    { label: "Poslanců", value: state.data.pocet_aktivnich, hint: `z ${state.data.pocet_poslancu} v období (vč. náhradníků)` },
    { label: "Hlasování", value: state.data.votings_valid.toLocaleString("cs"), hint: "platných jmenovitých" },
    { label: "Průměrná účast", value: avg(list.map(p => p.stats.pct_hlasoval)).toFixed(1) + " %", hint: "podíl odhlasovaných" },
    { label: "Nejvyšší účast", value: top ? top.stats.pct_hlasoval.toFixed(1) + " %" : "–", hint: top ? top.name : "" },
    { label: "Nejvíc absencí", value: worst ? worst.stats.pct_neprihlasen.toFixed(1) + " %" : "–", hint: worst ? worst.name + " (nepřihlášen)" : "" },
  ];
  $("kpis").innerHTML = kpis.map(k =>
    `<div class="kpi"><div class="label">${k.label}</div><div class="value">${k.value}</div><div class="hint">${esc(k.hint)}</div></div>`
  ).join("");
}

function renderClubs() {
  const cg = $("clubgrid");
  const max = Math.max(...state.data.kluby.map(k => k.avg_hlasoval), 100);
  cg.innerHTML = state.data.kluby.map((k, i) => {
    const c = klubColor(k.zkratka, i);
    const w = (k.avg_hlasoval / max * 100).toFixed(1);
    const dim = state.klub && state.klub !== k.zkratka ? " dim" : "";
    return `<div class="clubrow${dim}" data-klub="${esc(k.zkratka)}">
      <div class="cname"><span class="dot" style="background:${c}"></span>${esc(k.zkratka)} <span style="color:var(--muted);font-weight:400">· ${k.count}</span></div>
      <div class="bartrack"><div class="barfill" style="width:${w}%;background:${c}"></div></div>
      <div class="pct">${k.avg_hlasoval.toFixed(1)}</div>
    </div>`;
  }).join("");
  cg.querySelectorAll(".clubrow").forEach(el => el.onclick = () => {
    const z = el.dataset.klub;
    state.klub = state.klub === z ? "" : z;
    $("klubSelect").value = state.klub;
    renderClubs(); render();
  });
}

function buildKlubSelect() {
  const sel = $("klubSelect");
  state.data.kluby.forEach(k => {
    const o = document.createElement("option");
    o.value = k.zkratka; o.textContent = `${k.zkratka} (${k.count})`;
    sel.appendChild(o);
  });
}

function bindControls() {
  $("search").oninput = e => { state.q = e.target.value.trim().toLowerCase(); render(); };
  $("klubSelect").onchange = e => { state.klub = e.target.value; renderClubs(); render(); };
  $("onlyActive").onchange = e => { state.onlyActive = e.target.checked; renderKpis(); render(); };
  document.querySelectorAll("#head th").forEach(th => th.onclick = () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.dir *= -1;
    else { state.sort = key; state.dir = (key === "name" || key === "klub" || key === "kraj") ? 1 : -1; }
    render();
  });
  $("modalClose").onclick = closeModal;
  $("modalBg").onclick = e => { if (e.target === $("modalBg")) closeModal(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

function getVal(p, key) {
  if (key === "name") return p.prijmeni + " " + p.jmeno;
  if (key === "klub") return p.klub;
  if (key === "kraj") return p.kraj;
  return p.stats[key];
}

function render() {
  let list = activeList();
  if (state.klub) list = list.filter(p => p.klub === state.klub);
  if (state.q) list = list.filter(p => (p.name + " " + p.klub + " " + p.kraj).toLowerCase().includes(state.q));

  list.sort((a, b) => {
    let av = getVal(a, state.sort), bv = getVal(b, state.sort);
    if (typeof av === "string") return av.localeCompare(bv, "cs") * state.dir;
    return (av - bv) * state.dir;
  });

  // hlavičkové šipky
  document.querySelectorAll("#head th").forEach(th => {
    const base = th.textContent.replace(/[ ▲▼]+$/, "");
    th.innerHTML = base + (th.dataset.sort === state.sort ? ` <span class="arrow">${state.dir < 0 ? "▼" : "▲"}</span>` : "");
  });

  $("count").textContent = `${list.length} poslanců`;
  const idx = {}; state.data.poslanci.forEach((p, i) => idx[p.id_poslanec] = i);

  $("rows").innerHTML = list.map(p => {
    const s = p.stats, c = klubColor(p.klub, p._ci);
    return `<tr data-id="${p.id_poslanec}"${p.aktivni ? "" : ' class="inactive"'}>
      <td><div class="who">
        <img class="avatar" loading="lazy" src="${esc(p.foto_url)}" onerror="this.src='${PLACEHOLDER}'" alt="">
        <div><div class="nm">${esc(p.name)}${p.aktivni ? "" : '<span class="tag-out">mandát skončil</span>'}</div>
        <div class="meta hide-sm">${esc(p.strana || p.klub)} · ${esc(p.kraj)}</div></div>
      </div></td>
      <td class="hide-sm"><span class="badge" style="background:${c}">${esc(p.klub)}</span></td>
      <td class="hide-sm" style="color:var(--muted)">${esc(p.kraj)}</td>
      <td class="num"><span class="minibar"><span class="t"><span class="f" style="width:${s.pct_hlasoval}%;background:${pctColor(s.pct_hlasoval)}"></span></span><span class="v">${s.pct_hlasoval.toFixed(1)}</span></span></td>
      <td class="num hide-sm pill" style="color:var(--muted)">${s.pct_omluven.toFixed(1)} %</td>
      <td class="num pill" style="color:${s.pct_neprihlasen >= 15 ? "var(--bad)" : "inherit"};font-weight:700">${s.pct_neprihlasen.toFixed(1)} %</td>
    </tr>`;
  }).join("");

  $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => openModal(state.data.poslanci[idx[tr.dataset.id]]));
}

function statline(label, val, count, total, color) {
  const pct = val.toFixed(1);
  return `<div class="statline"><div class="lab"><span>${label}</span><b>${count.toLocaleString("cs")}× &nbsp; ${pct} %</b></div>
    <div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div></div>`;
}

function openModal(p) {
  const s = p.stats, c = klubColor(p.klub, p._ci);
  const links = [];
  links.push(`<a href="${esc(p.detail_url)}" target="_blank" rel="noopener">Profil na PSP →</a>`);
  links.push(`<a href="${esc(p.pstat_url)}" target="_blank" rel="noopener">Účast na PSP →</a>`);
  if (p.web) links.push(`<a href="${esc(p.web)}" target="_blank" rel="noopener">Web</a>`);
  if (p.facebook) links.push(`<a href="${esc(p.facebook)}" target="_blank" rel="noopener">Facebook</a>`);
  if (p.email) links.push(`<a href="mailto:${esc(p.email)}">E-mail</a>`);

  $("modalContent").innerHTML = `
    <div class="head" style="background:linear-gradient(180deg,${c}14,transparent)">
      <img src="${esc(p.foto_url)}" onerror="this.src='${PLACEHOLDER}'" alt="">
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="m"><span class="badge" style="background:${c}">${esc(p.klub)}</span> &nbsp; ${esc(p.klub_full)}</div>
        <div class="m" style="margin-top:6px">${esc(p.kraj)} kraj · kandidátka ${esc(p.strana || "–")}${p.narozeni ? " · nar. " + esc(p.narozeni) : ""}${p.aktivni ? "" : ' · <b style="color:var(--bad)">mandát skončil</b>'}</div>
        <div class="links">${links.join("")}</div>
      </div>
    </div>
    <div class="body">
      ${statline("Hlasoval (ANO + NE + zdržel se)", s.pct_hlasoval, s.hlasoval, s.total, pctColor(s.pct_hlasoval))}
      ${statline("Omluven", s.pct_omluven, s.omluven, s.total, "var(--warn)")}
      ${statline("Nepřihlášen (bez omluvy)", s.pct_neprihlasen, s.neprihlasen, s.total, "var(--bad)")}
      <div class="split">
        <div class="row"><span>ANO</span><span>${s.ano.toLocaleString("cs")} · ${s.pct_ano.toFixed(1)} %</span></div>
        <div class="row"><span>NE</span><span>${s.ne.toLocaleString("cs")} · ${s.pct_ne.toFixed(1)} %</span></div>
        <div class="row"><span>Zdržel se</span><span>${s.zdrzel.toLocaleString("cs")} · ${s.pct_zdrzel.toFixed(1)} %</span></div>
        <div class="row"><span>Hlasování celkem</span><span>${s.total.toLocaleString("cs")}</span></div>
      </div>
    </div>`;
  $("modalBg").classList.add("show");
}
function closeModal() { $("modalBg").classList.remove("show"); }
