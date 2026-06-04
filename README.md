# Účast poslanců na hlasování — dashboard

Automaticky aktualizovaný přehled účasti poslanců Poslanecké sněmovny PČR na
jmenovitých hlasováních. Scraper stahuje **otevřená data PSP**, spočítá statistiky
a publikuje statický dashboard. Vše běží zdarma přes GitHub Actions + GitHub Pages.

## Co to umí

- Tabulka všech poslanců s fotkou, klubem, krajem a mírou účasti
- Třídění a filtrování (podle klubu, jména, jen aktivní mandát)
- Metriky **Hlasoval / Omluven / Nepřihlášen** přesně podle metodiky stránky `pstat.sqw`
- Přehled průměrné účasti podle klubů
- Detail poslance (rozpad ANO/NE/zdržel se, kontakty, odkazy na PSP)
- Časová řada průměrů v `data/history.csv` (graf vývoje v čase)

## Zdroj dat a metodika

Data pochází z [otevřených dat Poslanecké sněmovny](https://www.psp.cz/sqw/hp.sqw?k=1300):

| Soubor | Obsah |
|---|---|
| `poslanci.zip` | osoby, poslanci, orgány (kluby, kraje), zařazení |
| `hl-2025ps.zip` | seznam hlasování, jednotlivé hlasy, omluvy, zmatečná hlasování |

Statistika se počítá z jednotlivých hlasů (`hl…h1.unl`) stejně jako oficiální
stránka *Účast na hlasování*:

- **Hlasoval** = ANO (`A`) + NE (`B`/`N`) + Zdržel se (`C`/`K`)
- **Omluven** = absence (`@`), kterou kryje omluva v `omluvy.unl` (časové okno)
- **Nepřihlášen** = absence (`@`) bez omluvy
- Zmatečná (neplatná) hlasování se nezapočítávají

> **Poznámka k aktuálnosti:** otevřená data se exportují jednou denně, takže čísla
> mohou být mírně nižší než živý web PSP o právě probíhající (neuzavřenou) schůzi.
> Mezi schůzemi se srovnají. Ověřeno proti `pstat.sqw` — hodnota *Omluven* sedí přesně.

## Spuštění lokálně

Scraper nemá žádné závislosti (jen standardní Python ≥ 3.9):

```bash
python3 scraper/scrape.py            # stáhne data, vygeneruje data/poslanci.json
python3 scraper/scrape.py --photos   # navíc stáhne fotky do photos/ (jen chybějící)
```

Dashboard je statický web — stačí ho naservírovat z kořene projektu:

```bash
python3 -m http.server 8848
# otevřete http://localhost:8848
```

## Nasazení (GitHub Pages, zdarma)

1. Vytvořte repozitář na GitHubu a nahrajte tento projekt:
   ```bash
   git remote add origin git@github.com:<vase-jmeno>/poslanci-hlasovani.git
   git push -u origin main
   ```
2. V repozitáři **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Hotovo. Workflow [`scrape-deploy.yml`](.github/workflows/scrape-deploy.yml):
   - běží **každý den v 06:00** (lze spustit i ručně přes *Actions → Run workflow*),
   - stáhne aktuální data + nové fotky,
   - commitne změny do `data/` a `photos/` (verzovaná historie),
   - publikuje dashboard na `https://<vase-jmeno>.github.io/poslanci-hlasovani/`.

Interval změníte v `cron` výrazu na začátku workflow.

## Struktura

```
index.html, app.js, style.css   – statický dashboard (bez build kroku)
scraper/scrape.py               – scraper otevřených dat PSP
data/poslanci.json              – vygenerovaná data (verzovaná)
data/history.csv                – časová řada průměrné účasti
photos/                         – fotky poslanců (volitelně, přes --photos)
.github/workflows/              – plánované scrapování + nasazení
```

## Možná rozšíření

- Graf vývoje účasti v čase z `history.csv`
- Jednota hlasování v rámci klubu (kolik % MP hlasuje shodně s klubem)
- Analýza konkrétních hlasování / zákonů (data jsou v `hl-2025ps.zip`)
- Export do CSV/XLSX přímo z dashboardu
