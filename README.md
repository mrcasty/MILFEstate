# MILFEstate

MILFEstate is a single-page property browser that surfaces listings from a curated Google Sheet. Agents can filter, sort, and page through inventory directly in the browser without maintaining a database or backend service.

## Features
- Client-side filtering by property name, type, location, price range, bedroom/bathroom counts, and floor area.
- Sort controls for any sheet column with optional descending toggle.
- Paginated results with a lightweight loading experience and quick links to asset photos.
- `view.html` detail page for deep-linking to individual rows in the data source.

## Getting Started
1. Install [PowerShell 7+](https://learn.microsoft.com/powershell/scripting/install/installing-powershell), if not already available.
2. From the repository root, run the local server:
   ```powershell
   pwsh ./serve.ps1
   ```
3. Open `http://localhost:8080` in your browser to browse the latest sheet data.

To view a specific row, navigate to `view.html?row=<rowIndex>`, where `<rowIndex>` matches the 1-based row number from the sheet (excluding the header).

## Data Source
Both pages pull from published Google Sheets CSV exports. Update the spreadsheet if you need to change inventory; the site will reflect updates on the next reload. If column names change, mirror those updates in the JavaScript header mappings before publishing.

## Development Notes
- The interface relies on [Pico.css](https://picocss.com) for styling and [Papa Parse](https://www.papaparse.com) for CSV parsing.
- Keep indentation at two spaces and follow the inline scripting pattern used in `index.html`.
- Test changes by exercising all filters, verifying pagination, and ensuring images/links remain valid.
