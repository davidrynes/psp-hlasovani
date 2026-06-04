"use strict";

const KLUB_COLORS = {
  "ANO2011": "#0a318b", "ODS": "#0073cf", "SPD": "#1b6ec2", "STAN": "#e2001a",
  "Piráti": "#000000", "KDU-ČSL": "#f7b500", "TOP09": "#7d3f98", "Moto": "#2b2b2b", "MS": "#c0392b",
};
const FALLBACK = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#64748b"];
const esc = s => (s == null ? "" : String(s)).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const $ = id => document.getElementById(id);

// Pořadí a popis kategorií hlasu v detailu
const CAT = [
  { key: "ano", label: "Pro", color: "var(--good)" },
  { key: "ne", label: "Proti", color: "var(--bad)" },
  { key: "zdrzel", label: "Zdržel se", color: "var(--warn)" },
  { key: "nehlasoval", label: "Nehlasoval", color: "#94a3b8" },
  { key: "neprihlasen", label: "Nepřihlášen", color: "#64748b" },
  { key: "omluven", label: "Omluven", color: "#a8b0bd" },
];

const state = { votings: [], byId: {}, lookup: {}, klubOrder: {}, q: "", schuze: "", vysledek: "", sort: "id", dir: -1, limit: 120, cache: {} };

Promise.all([
  fetch("data/votings.json", { cache: "no-cache" }).then(r => r.json()),
  fetch("data/poslanci.json", { cache: "no-cache" }).then(r => r.json()),
]).then(([v, p]) => init(v, p)).catch(err => {
  $("subtitle").textContent = "Nepodařilo se načíst data (" + err + "). Spusťte: python3 scraper/scrape.py";
});

function klubColor(zkr) { return KLUB_COLORS[zkr] || FALLBACK[(state.klubOrder[zkr] || 0) % FALLBACK.length]; }

function init(v, p) {
  state.votings = v.votings;
  v.votings.forEach(x => state.byId[x.id] = x);
  p.kluby.forEach((k, i) => state.klubOrder[k.zkratka] = i);
  p.poslanci.forEach(x => state.lookup[x.id_poslanec] = x);

  const d = new Date(v.generated_at);
  const prijato = v.votings.filter(x => x.prijato).length;
  $("subtitle").innerHTML =
    `Poslanecká sněmovna, <b>${v.term.cislo}. volební období</b> &nbsp;·&nbsp; ` +
    `<b>${v.votings.length.toLocaleString("cs")}</b> hlasování &nbsp;·&nbsp; ` +
    `${prijato.toLocaleString("cs")} přijato / ${(v.votings.length - prijato).toLocaleString("cs")} zamítnuto &nbsp;·&nbsp; ` +
    `data k <b>${d.toLocaleDateString("cs")}</b>`;
  $("freshness").textContent = "Aktualizováno " + d.toLocaleString("cs") + ".";

  const sel = $("schuzeSelect");
  v.schuze.forEach(s => { const o = document.createElement("option"); o.value = s; o.textContent = s + ". schůze"; sel.appendChild(o); });

  bind();
  render();
}

function bind() {
  let t;
  $("search").oninput = e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); state.limit = 120; render(); }, 180); };
  $("schuzeSelect").onchange = e => { state.schuze = e.target.value; state.limit = 120; render(); };
  $("vysledekSelect").onchange = e => { state.vysledek = e.target.value; state.limit = 120; render(); };
  document.querySelectorAll("#head th[data-sort]").forEach(th => th.onclick = () => {
    const k = th.dataset.sort;
    if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = (k === "nazev") ? 1 : -1; }
    render();
  });
  $("modalClose").onclick = closeModal;
  $("modalBg").onclick = e => { if (e.target === $("modalBg")) closeModal(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

function filtered() {
  let list = state.votings;
  if (state.schuze) list = list.filter(v => v.schuze == state.schuze);
  if (state.vysledek) list = list.filter(v => v.vysledek === state.vysledek);
  if (state.q) list = list.filter(v => v.nazev.toLowerCase().includes(state.q));
  const dir = state.dir, key = state.sort;
  list = list.slice().sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === "nazev") return String(av).localeCompare(String(bv), "cs") * dir;
    if (key === "prijato") { av = a.prijato ? 1 : 0; bv = b.prijato ? 1 : 0; }
    return (av - bv) * dir;
  });
  return list;
}

function tallyBar(v) {
  const tot = Math.max(v.pro + v.proti + v.zdrzel, 1);
  const seg = (n, c) => n ? `<span style="width:${(n / tot * 100).toFixed(1)}%;background:${c}" title="${n}"></span>` : "";
  return `<span class="tally">${seg(v.pro, "var(--good)")}${seg(v.proti, "var(--bad)")}${seg(v.zdrzel, "var(--warn)")}</span>
    <span class="tallynums"><b style="color:var(--good)">${v.pro}</b> / <b style="color:var(--bad)">${v.proti}</b> / <span style="color:var(--warn)">${v.zdrzel}</span></span>`;
}

function render() {
  const list = filtered();
  $("count").textContent = list.length.toLocaleString("cs") + " hlasování";

  document.querySelectorAll("#head th[data-sort]").forEach(th => {
    const base = th.textContent.replace(/[ ▲▼]+$/, "");
    th.innerHTML = base + (th.dataset.sort === state.sort ? ` <span class="arrow">${state.dir < 0 ? "▼" : "▲"}</span>` : "");
  });

  const shown = list.slice(0, state.limit);
  $("rows").innerHTML = shown.map(v => {
    const badge = v.prijato
      ? '<span class="res res-y">Přijato</span>' : '<span class="res res-n">Zamítnuto</span>';
    return `<tr data-id="${v.id}">
      <td style="white-space:nowrap"><b>${esc(v.datum)}</b><div class="meta">${esc(v.cas)}</div></td>
      <td class="hide-sm" style="color:var(--muted);white-space:nowrap">${v.schuze}. schůze<div class="meta">hlas. ${v.cislo}</div></td>
      <td><div class="vname">${esc(v.nazev || "—")}</div></td>
      <td class="num">${badge}</td>
      <td class="num hide-sm"><div class="minitally">${tallyBar(v)}</div></td>
    </tr>`;
  }).join("");

  $("rows").querySelectorAll("tr").forEach(tr => tr.onclick = () => openVoting(tr.dataset.id));

  $("more").innerHTML = list.length > state.limit
    ? `<button class="btn" id="moreBtn">Zobrazit dalších ${Math.min(120, list.length - state.limit)} (z ${list.length.toLocaleString("cs")})</button>`
    : "";
  const mb = $("moreBtn");
  if (mb) mb.onclick = () => { state.limit += 120; render(); };
}

async function openVoting(id) {
  const v = state.byId[id];
  $("modalContent").innerHTML = `<div class="head"><div><h3>${esc(v.nazev || "Hlasování")}</h3>
    <div class="m">${esc(v.datum)} ${esc(v.cas)} · ${v.schuze}. schůze, ${v.cislo}. hlasování</div></div></div>
    <div class="body"><p style="color:var(--muted)">Načítám jmenovité hlasy…</p></div>`;
  $("modalBg").classList.add("show");

  let detail = state.cache[id];
  if (!detail) {
    try { detail = await fetch(`data/votes/${id}.json`, { cache: "force-cache" }).then(r => r.json()); state.cache[id] = detail; }
    catch (e) { $("modalContent").querySelector(".body").innerHTML = "<p>Detail se nepodařilo načíst.</p>"; return; }
  }
  renderVoting(v, detail);
}

function renderVoting(v, detail) {
  // rozpad po klubech
  const klubAgg = {};
  const memberCat = {};       // id_poslanec -> kategorie
  CAT.forEach(c => (detail[c.key] || []).forEach(idp => {
    memberCat[idp] = c.key;
    const p = state.lookup[idp]; if (!p) return;
    const k = (klubAgg[p.klub] ||= { klub: p.klub, total: 0 });
    k[c.key] = (k[c.key] || 0) + 1; k.total++;
  }));
  const kluby = Object.values(klubAgg).sort((a, b) => (b.ano || 0) - (a.ano || 0) || b.total - a.total);

  const klubRows = kluby.map(k => {
    const cell = key => { const n = k[key] || 0; return `<td class="num">${n || '<span style="color:#cbd0d8">·</span>'}</td>`; };
    return `<tr><td><span class="dot" style="background:${klubColor(k.klub)}"></span> ${esc(k.klub)} <span style="color:var(--muted)">· ${k.total}</span></td>
      ${cell("ano")}${cell("ne")}${cell("zdrzel")}${cell("neprihlasen")}${cell("omluven")}</tr>`;
  }).join("");

  // jmenovitě po kategoriích
  const named = CAT.filter(c => (detail[c.key] || []).length).map(c => {
    const chips = (detail[c.key] || []).map(idp => {
      const p = state.lookup[idp]; if (!p) return "";
      return `<span class="chip" data-name="${esc((p.name + " " + p.klub).toLowerCase())}">
        <span class="cdot" style="background:${klubColor(p.klub)}"></span>${esc(p.name)}<small>${esc(p.klub)}</small></span>`;
    }).join("");
    return `<div class="catblock"><div class="cathead"><span class="res-dot" style="background:${c.color}"></span>${c.label}
      <b>${(detail[c.key] || []).length}</b></div><div class="chips">${chips}</div></div>`;
  }).join("");

  const pspLink = `https://www.psp.cz/sqw/hlasy.sqw?G=${v.id}`;
  $("modalContent").innerHTML = `
    <div class="head" style="background:linear-gradient(180deg,${v.prijato ? "#1f9d5514" : "#d6122b14"},transparent)">
      <div>
        <h3>${esc(v.nazev || "Hlasování")}</h3>
        <div class="m">${esc(v.datum)} ${esc(v.cas)} · ${v.schuze}. schůze, ${v.cislo}. hlasování</div>
        <div class="m" style="margin-top:8px">
          ${v.prijato ? '<span class="res res-y">Přijato</span>' : '<span class="res res-n">Zamítnuto</span>'}
          &nbsp; <b style="color:var(--good)">${v.pro}</b> pro ·
          <b style="color:var(--bad)">${v.proti}</b> proti ·
          <span style="color:var(--warn)">${v.zdrzel}</span> zdržel · ${v.prihlaseno} přihlášeno
        </div>
        <div class="links" style="margin-top:10px"><a href="${pspLink}" target="_blank" rel="noopener">Hlasování na PSP →</a></div>
      </div>
    </div>
    <div class="body">
      <h4 class="sech">Jak hlasovaly kluby</h4>
      <div style="overflow-x:auto"><table class="klubtab">
        <thead><tr><th>Klub</th><th class="num">Pro</th><th class="num">Proti</th><th class="num">Zdržel</th><th class="num">Nepřihl.</th><th class="num">Omluven</th></tr></thead>
        <tbody>${klubRows}</tbody>
      </table></div>
      <h4 class="sech">Jmenovitě <input type="search" id="mfilter" placeholder="filtr poslance…" class="mfilter"></h4>
      ${named}
    </div>`;

  const mf = $("mfilter");
  if (mf) mf.oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#modalContent .chip").forEach(ch => {
      ch.style.display = !q || ch.dataset.name.includes(q) ? "" : "none";
    });
  };
}

function closeModal() { $("modalBg").classList.remove("show"); }
