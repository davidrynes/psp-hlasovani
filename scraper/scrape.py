#!/usr/bin/env python3
"""
Scraper účasti poslanců PS PČR na hlasování.

Zdroj: otevřená data Poslanecké sněmovny (psp.cz/sqw/hp.sqw?k=1300).
- poslanci.zip      ... osoby, poslanci, orgány (kluby, kraje), zařazení
- hl-<rok>ps.zip    ... seznam hlasování, jednotlivé hlasy, omluvy, zmatečná hlasování

Výstup: data/poslanci.json + data/history.csv (časová řada průměrů).

Metodika odpovídá stránce pstat.sqw:
- "Hlasoval"     = ANO (A) + NE (B/N) + Zdržel se (C/K)
- "Omluven"      = absence (@) pokrytá časovým oknem v omluvy.unl  (+ případný kód M)
- "Nepřihlášen"  = absence (@) bez omluvy
- Zmatečná (neplatná) hlasování se do statistik nezapočítávají.

Bez externích závislostí – pouze standardní knihovna Pythonu.
"""

import csv
import io
import json
import os
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone

BASE = "https://www.psp.cz/eknih/cdrom/opendata"
POSLANCI_ZIP = f"{BASE}/poslanci.zip"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
PHOTO_DIR = os.path.join(ROOT, "photos")

UA = {"User-Agent": "novinky.cz-poslanci-dashboard/1.0 (+research; data z otevrenych dat PSP)"}

# Kódy výsledku hlasování (sloupec vysledek v hl_poslanec)
ANO_CODES = {"A"}
NE_CODES = {"B", "N"}
ZDRZEL_CODES = {"C", "K"}          # K = zdržel se / nehlasoval (kombinovaně po r. 1995)
NEHLASOVAL_PRESENT = {"F"}         # přihlášen, ale nehlasoval
ABSENT_CODE = "@"                  # nepřihlášen (může být i omluven – viz omluvy.unl)
OMLUVEN_CODE = "M"
BEFORE_OATH = {"W"}

# Čitelné a sjednocené názvy klubů (zkratky z otevřených dat PSP bývají krkolomné).
CLUB_LABEL = {
    "ANO2011": "ANO",
    "MS": "Motoristé",     # Poslanecký klub Motoristé sobě
    "Moto": "Motoristé",   # kandidátka „Motoristé sobě" – sjednotit s klubem
}


def klub_label(zkr):
    return CLUB_LABEL.get(zkr, zkr)


def log(msg):
    print(f"[scrape] {msg}", file=sys.stderr, flush=True)


def fetch(url):
    log(f"stahuji {url}")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def open_zip(url):
    return zipfile.ZipFile(io.BytesIO(fetch(url)))


def unl(z, name):
    """Vrátí řádky UNL souboru jako seznam seznamů (cp1250, oddělovač |)."""
    if name not in z.namelist():
        return []
    text = z.read(name).decode("cp1250", "replace")
    return [row for row in csv.reader(io.StringIO(text), delimiter="|") if row]


def to_int(s, default=None):
    try:
        return int(s)
    except (TypeError, ValueError):
        return default


def hhmm_to_min(s):
    s = (s or "").strip()
    if not s or ":" not in s:
        return None
    try:
        h, m = s.split(":")[:2]
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def find_current_term(organy):
    """Najde orgán aktuálního volebního období sněmovny (nejnovější PSP)."""
    terms = []
    for r in organy:
        # id_organ | parent | id_typ_organu | zkratka | nazev_cz | nazev_en | od | do | priorita | base
        nazev = r[4] if len(r) > 4 else ""
        zkratka = r[3] if len(r) > 3 else ""
        od = r[6] if len(r) > 6 else ""
        if nazev.startswith("Poslanecká sněmovna") or zkratka.startswith("PSP"):
            year = to_int(zkratka.replace("PSP", "")) if zkratka.startswith("PSP") else None
            terms.append((year or 0, od, r))
    if not terms:
        raise SystemExit("Nepodařilo se najít orgán volebního období.")
    terms.sort(key=lambda t: (t[0], t[1]))
    return terms[-1][2]


def period_for_term(term_row):
    """Vrátí řetězec období pro cestu k fotkám, např. '2025ps'."""
    od = term_row[6] if len(term_row) > 6 else ""
    year = None
    for fmt in ("%Y-%m-%d %H", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            year = datetime.strptime(od.strip(), fmt).year
            break
        except (ValueError, AttributeError):
            continue
    return f"{year}ps" if year else "2025ps"


def main():
    download_photos = "--photos" in sys.argv
    os.makedirs(DATA_DIR, exist_ok=True)

    # ---- 1) Poslanci a osoby -------------------------------------------------
    pz = open_zip(POSLANCI_ZIP)
    osoby = unl(pz, "osoby.unl")
    poslanci = unl(pz, "poslanec.unl")
    organy = unl(pz, "organy.unl")
    zarazeni = unl(pz, "zarazeni.unl")

    term = find_current_term(organy)
    term_id = term[0]
    period = period_for_term(term)
    term_num = to_int((term[3] or "").replace("PSP", ""), 10)  # 10. volební období
    log(f"aktuální období: organ {term_id} '{term[4]}' PSP{term_num} (period {period})")

    # organ lookup: id -> (zkratka, nazev_cz, parent, typ)
    organ = {r[0]: r for r in organy}

    def organ_name(oid):
        r = organ.get(str(oid))
        return r[4] if r else ""

    def organ_zkratka(oid):
        r = organ.get(str(oid))
        return r[3] if r else ""

    # kluby aktuálního období: orgány typu "Poslanecký klub" s rodičem = období
    klub_ids = set()
    for r in organy:
        nazev = r[4] if len(r) > 4 else ""
        parent = r[1] if len(r) > 1 else ""
        if nazev.startswith("Poslanecký klub") and parent == term_id:
            klub_ids.add(r[0])
    log(f"klubů v období: {len(klub_ids)}")

    # zařazení: osoba -> aktuální klub (cl_funkce=0, do_o prázdné, orgán je klub období)
    # + množina osob s aktivním mandátem (členství v orgánu sněmovny bez data konce)
    osoba_klub = {}
    aktivni_osoby = set()
    for r in zarazeni:
        # id_osoba | id_of | cl_funkce | od_o | do_o | od_f | do_f
        if len(r) < 5 or r[2] != "0":
            continue
        konci = r[4].strip()
        if r[1] in klub_ids and not konci:
            osoba_klub[r[0]] = r[1]
        if r[1] == term_id and not konci:
            aktivni_osoby.add(r[0])
    log(f"poslanců s aktivním mandátem: {len(aktivni_osoby)}")

    osoba = {r[0]: r for r in osoby}

    # ---- 2) Hlasování --------------------------------------------------------
    hz = open_zip(f"{BASE}/hl-{period.replace('ps','')}ps.zip")

    # zmatečná (neplatná) hlasování
    void = {r[0] for r in unl(hz, "zmatecne.unl") if r}

    # seznam hlasování: id -> (datum, cas_min); + metadata pro votings.json
    hlas_file = next((n for n in hz.namelist() if n.endswith("s.unl")), None)
    voting_time = {}
    voting_meta = {}
    votings_total = 0
    for r in unl(hz, hlas_file):
        # id_hlasovani|id_organ|schuze|cislo|bod|datum|cas|pro|proti|zdrzel|nehlasoval|prihlaseno|kvorum|druh|vysledek|nazev_dlouhy|nazev_kratky
        if len(r) < 15:
            continue
        votings_total += 1
        voting_time[r[0]] = (r[5], hhmm_to_min(r[6]))
        if r[0] in void:
            continue
        voting_meta[r[0]] = {
            "id": r[0],
            "schuze": to_int(r[2], 0), "cislo": to_int(r[3], 0), "bod": to_int(r[4], 0),
            "datum": r[5], "cas": r[6],
            "pro": to_int(r[7], 0), "proti": to_int(r[8], 0), "zdrzel": to_int(r[9], 0),
            "nehlasoval": to_int(r[10], 0), "prihlaseno": to_int(r[11], 0),
            "vysledek": r[14],            # 'A' = přijato, 'R' = zamítnuto
            "prijato": r[14] == "A",
            "nazev": (r[15] or r[16] or "").strip(),
            "nazev_kratky": (r[16] or "").strip(),
        }
    votings_valid = votings_total - len([v for v in void if v in voting_time])
    log(f"hlasování celkem: {votings_total}, platných: {votings_valid}")

    # omluvy aktuálního období: id_poslanec -> { den: [(od_min,do_min), ...] }
    omluvy = defaultdict(lambda: defaultdict(list))
    for r in unl(hz, "omluvy.unl"):
        # id_organ | id_poslanec | den | od | do
        if len(r) < 3 or r[0] != term_id:
            continue
        od = hhmm_to_min(r[3]) if len(r) > 3 else None
        do = hhmm_to_min(r[4]) if len(r) > 4 else None
        omluvy[r[1]][r[2]].append((od, do))

    def is_excused(id_poslanec, id_hlasovani):
        datum, cas_min = voting_time.get(id_hlasovani, (None, None))
        if datum is None:
            return False
        windows = omluvy.get(id_poslanec, {}).get(datum)
        if not windows:
            return False
        if cas_min is None:
            return True
        for od, do in windows:
            lo = od if od is not None else 0
            hi = do if do is not None else 24 * 60
            if lo <= cas_min <= hi:
                return True
        return False

    def categorize(vys, idp, idh):
        """Převede surový kód hlasu na kategorii (shodně s pstat.sqw)."""
        if vys in ANO_CODES:
            return "ano"
        if vys in NE_CODES:
            return "ne"
        if vys in ZDRZEL_CODES:
            return "zdrzel"
        if vys in NEHLASOVAL_PRESENT:
            return "nehlasoval"
        if vys == OMLUVEN_CODE:
            return "omluven"
        if vys in BEFORE_OATH:
            return "pred_slibem"
        if vys == ABSENT_CODE:
            return "omluven" if is_excused(idp, idh) else "neprihlasen"
        return "jine"

    # individuální hlasy: per poslanec (souhrn) i per hlasování (detail)
    cat = defaultdict(Counter)
    voting_votes = defaultdict(lambda: defaultdict(list))  # idh -> kategorie -> [id_poslanec]
    indiv_files = sorted(n for n in hz.namelist() if "h" in n.lower()
                         and n.lower().endswith(".unl")
                         and any(c.isdigit() for c in n)
                         and n != hlas_file)
    # Spolehlivá detekce: soubor jednotlivých hlasů má 3 sloupce (id_poslanec|id_hlasovani|vysledek)
    for name in indiv_files:
        rows = unl(hz, name)
        if rows and len(rows[0]) < 3:
            continue
        for r in rows:
            if len(r) < 3:
                continue
            idp, idh, vys = r[0], r[1], r[2]
            if idh in void:
                continue
            kat = categorize(vys, idp, idh)
            cat[idp][kat] += 1
            voting_votes[idh][kat].append(idp)

    # ---- 3) Sestavení výstupu ------------------------------------------------
    out = []
    if download_photos:
        os.makedirs(PHOTO_DIR, exist_ok=True)

    for r in poslanci:
        # id_poslanec|id_osoba|id_kraj|id_kandidatka|id_obdobi|web|ulice|obec|psc|email|telefon|fax|psp_telefon|facebook|foto
        if len(r) < 15 or r[4] != term_id:
            continue
        idp, id_osoba = r[0], r[1]
        os_row = osoba.get(id_osoba, [])
        pred = os_row[1] if len(os_row) > 1 else ""
        prijmeni = os_row[2] if len(os_row) > 2 else ""
        jmeno = os_row[3] if len(os_row) > 3 else ""
        za = os_row[4] if len(os_row) > 4 else ""
        narozeni = os_row[5] if len(os_row) > 5 else ""
        pohlavi = os_row[6] if len(os_row) > 6 else ""

        full = " ".join(p for p in [pred, jmeno, prijmeni] if p).strip()
        if za:
            full += f", {za}"

        klub_oid = osoba_klub.get(id_osoba)
        klub_zkr = organ_zkratka(klub_oid) if klub_oid else organ_zkratka(r[3])
        klub_full = organ_name(klub_oid) if klub_oid else organ_name(r[3])
        klub_zkr = klub_label(klub_zkr)   # čitelný a sjednocený název klubu

        c = cat.get(idp, Counter())
        ano, ne, zdrzel = c["ano"], c["ne"], c["zdrzel"]
        nehlasoval, omluven, neprihlasen = c["nehlasoval"], c["omluven"], c["neprihlasen"]
        hlasoval = ano + ne + zdrzel
        total = hlasoval + nehlasoval + omluven + neprihlasen + c["pred_slibem"] + c["jine"]
        pritomen = hlasoval + nehlasoval

        def pct(x):
            return round(100 * x / total, 1) if total else 0.0

        foto = r[14] == "1"
        foto_url = f"https://www.psp.cz/eknih/cdrom/{period}/eknih/{period}/poslanci/i{id_osoba}.jpg"
        if download_photos and foto:
            local = os.path.join(PHOTO_DIR, f"i{id_osoba}.jpg")
            if not os.path.exists(local):  # cache: stahuj jen nové
                try:
                    with open(local, "wb") as f:
                        f.write(fetch(foto_url))
                except Exception as e:  # noqa
                    log(f"foto {id_osoba} se nepodařilo stáhnout: {e}")
                    local = None
            if local:
                foto_url = f"photos/i{id_osoba}.jpg"

        out.append({
            "id_poslanec": idp,
            "id_osoba": id_osoba,
            "jmeno": jmeno,
            "prijmeni": prijmeni,
            "name": full,
            "narozeni": narozeni,
            "pohlavi": pohlavi,
            "kraj": organ_name(r[2]),
            "klub": klub_zkr,
            "klub_full": klub_full,
            "strana": organ_zkratka(r[3]),
            "aktivni": id_osoba in aktivni_osoby,
            "foto": foto,
            "foto_url": foto_url,
            "web": r[5],
            "email": r[9],
            "facebook": r[13],
            "detail_url": f"https://www.psp.cz/sqw/detail.sqw?id={id_osoba}",
            "pstat_url": f"https://www.psp.cz/sqw/pstat.sqw?o={term_num}&id={id_osoba}&id_posl={idp}",
            "stats": {
                "total": total,
                "ano": ano, "ne": ne, "zdrzel": zdrzel, "nehlasoval": nehlasoval,
                "hlasoval": hlasoval, "pritomen": pritomen,
                "omluven": omluven, "neprihlasen": neprihlasen,
                "pct_hlasoval": pct(hlasoval),
                "pct_pritomen": pct(pritomen),
                "pct_omluven": pct(omluven),
                "pct_neprihlasen": pct(neprihlasen),
                "pct_ano": pct(ano), "pct_ne": pct(ne), "pct_zdrzel": pct(zdrzel),
            },
        })

    out.sort(key=lambda p: (p["prijmeni"], p["jmeno"]))

    # agregace za kluby (jen aktivní mandáty → součet členů = počet poslanců)
    kluby = defaultdict(lambda: {"count": 0, "sum_hlasoval": 0.0, "sum_neprihlasen": 0.0,
                                 "name": ""})
    for p in out:
        if not p["aktivni"]:
            continue
        k = kluby[p["klub"]]
        k["count"] += 1
        k["name"] = p["klub_full"]
        k["sum_hlasoval"] += p["stats"]["pct_hlasoval"]
        k["sum_neprihlasen"] += p["stats"]["pct_neprihlasen"]
    klub_list = []
    for zkr, k in kluby.items():
        if not zkr:
            continue
        klub_list.append({
            "zkratka": zkr,
            "name": k["name"],
            "count": k["count"],
            "avg_hlasoval": round(k["sum_hlasoval"] / k["count"], 1),
            "avg_neprihlasen": round(k["sum_neprihlasen"] / k["count"], 1),
        })
    klub_list.sort(key=lambda k: -k["avg_hlasoval"])

    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {
        "generated_at": generated,
        "term": {"id_organ": term_id, "name": term[4], "cislo": term_num, "period": period},
        "votings_total": votings_total,
        "votings_valid": votings_valid,
        "pocet_poslancu": len(out),
        "pocet_aktivnich": sum(1 for p in out if p["aktivni"]),
        "kluby": klub_list,
        "poslanci": out,
    }

    out_path = os.path.join(DATA_DIR, "poslanci.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    log(f"zapsáno {out_path} ({len(out)} poslanců)")

    # ---- 4) Jednotlivá hlasování --------------------------------------------
    # Seznam (votings.json) + detail per hlasování (votes/<id>.json, lazy-load).
    # Soubory se píší deterministicky (seřazená id), aby se neměnily bez změny dat.
    votes_dir = os.path.join(DATA_DIR, "votes")
    os.makedirs(votes_dir, exist_ok=True)
    CATS = ["ano", "ne", "zdrzel", "nehlasoval", "omluven", "neprihlasen", "pred_slibem", "jine"]

    votings_list = []
    for idh, meta in voting_meta.items():
        votings_list.append(meta)
        groups = voting_votes.get(idh, {})
        detail = {}
        for k in CATS:
            ids = groups.get(k)
            if ids:
                detail[k] = sorted(ids, key=lambda x: int(x))
        with open(os.path.join(votes_dir, f"{idh}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))

    # nejnovější nahoře (podle id hlasování)
    votings_list.sort(key=lambda v: int(v["id"]), reverse=True)
    schuze_list = sorted({v["schuze"] for v in votings_list}, reverse=True)
    with open(os.path.join(DATA_DIR, "votings.json"), "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": generated,
            "term": payload["term"],
            "schuze": schuze_list,
            "votings": votings_list,
        }, f, ensure_ascii=False, separators=(",", ":"))
    log(f"zapsáno votings.json ({len(votings_list)} hlasování) + votes/*.json")

    # časová řada (history.csv) – jeden řádek na běh
    avg_hl = round(sum(p["stats"]["pct_hlasoval"] for p in out) / len(out), 1) if out else 0
    avg_np = round(sum(p["stats"]["pct_neprihlasen"] for p in out) / len(out), 1) if out else 0
    hist_path = os.path.join(DATA_DIR, "history.csv")
    header = ["datum", "pocet_poslancu", "hlasovani_platnych",
              "prum_pct_hlasoval", "prum_pct_neprihlasen"]
    dnes = generated[:10]
    rows_hist = []
    if os.path.exists(hist_path):
        with open(hist_path, encoding="utf-8") as f:
            rows_hist = [r for r in csv.reader(f) if r and r[0] != "datum"]
    rows_hist = [r for r in rows_hist if r[0] != dnes]  # nahraď dnešní záznam
    rows_hist.append([dnes, len(out), votings_valid, avg_hl, avg_np])
    with open(hist_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows_hist)

    # kontrolní výpis (kalibrace vůči pstat.sqw)
    for p in out:
        if p["id_osoba"] == "5700":
            s = p["stats"]
            log(f"KONTROLA {p['name']} ({p['klub']}): hlasoval {s['pct_hlasoval']}% "
                f"omluven {s['pct_omluven']}% nepřihlášen {s['pct_neprihlasen']}% "
                f"(ano {s['ano']} ne {s['ne']} zdržel {s['zdrzel']} z {s['total']})")


if __name__ == "__main__":
    main()
