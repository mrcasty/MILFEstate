# MILFEstate

Property browser for Bangkok real estate listings. Pulls live data from a Google Sheet and displays it as a card grid with photo thumbnails.

**Live site:** https://mrcasty.github.io/MILFEstate/

## Features
- Card grid with lazy-loaded photo thumbnails
- Filters: building name, status, rent/sale price, bedrooms, bathrooms, floor area, room/ID
- Sort by building, rent, sale price, area, or bedrooms
- 16 listings per page with pagination
- Photo overlay — click a card to view the full gallery without leaving the page
- Color-coded status badges (Available, Upcoming, To Check, etc.)

## How It Works
- **Data:** live CSV from a published Google Sheet (updated by Judy)
- **Photos:** first image URL for each listing is scraped from reverse.estate and cached in `thumb-map.json`
- **Hosting:** GitHub Pages (static, no backend)

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page markup |
| `style.css` | Styles |
| `app.js` | App logic (CSV loading, cards, filters, pagination, overlay) |
| `serve.ps1` | Local dev server |
| `scrape-thumbs.js` | Node.js scraper for GitHub Actions |
| `scrape-thumbs.ps1` | PowerShell scraper for local use |
| `thumb-map.json` | Generated map of listing ID to photo URL |

## GitHub Actions
Two workflows keep `thumb-map.json` up to date:

- **Scrape photos (all)** — runs daily at 13:00 Bangkok time, processes all new listings
- **Scrape photos (latest 100)** — manual one-click for quick updates after new listings are added

Trigger manually from the [Actions tab](https://github.com/mrcasty/MILFEstate/actions).

## Local Development
```powershell
# Start the server
pwsh ./serve.ps1
# Open http://localhost:8080

# Scrape latest 100 photo URLs
pwsh ./scrape-thumbs.ps1 -Last -Limit 100

# Full scrape
pwsh ./scrape-thumbs.ps1
```

## Stack
- [Pico.css](https://picocss.com) — styling
- [Papa Parse](https://www.papaparse.com) — CSV parsing
- GitHub Actions + GitHub Pages — automation and hosting
