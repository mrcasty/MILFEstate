const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0D8NXWZ7ViUeHxH0XNdGycpf0fxaAEHAYqDGrMIbNYo4mrjT3WdoSjcPSeHO6TQ/pub?output=csv";
const PAGE_SIZE = 16;

let allProperties = [];
let filtered = [];
let currentPage = 1;
/* ── Parse CSV and deduplicate to primary rows ── */
function loadData() {
  Papa.parse(SHEET_URL, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete(result) {
      allProperties = result.data.filter(r => r.structure && r.structure.trim());
      filtered = allProperties.slice();
      renderPage();
      document.getElementById("loading-screen").style.display = "none";
    },
    error(err) {
      console.error("CSV load error:", err);
      document.getElementById("loading-screen").innerHTML =
        '<p style="color:#f66;text-align:center">Failed to load data</p>';
    }
  });
}

/* ── Status → badge class ── */
function badgeClass(status) {
  if (!status) return "badge-other";
  const s = status.toLowerCase();
  if (s === "available")     return "badge-available";
  if (s === "upcoming")      return "badge-upcoming";
  if (s === "to check")      return "badge-tocheck";
  if (s === "not available") return "badge-notavailable";
  if (s.startsWith("sale"))  return "badge-sale";
  return "badge-other";
}

/* ── Format price with Thai Baht ── */
function fmtPrice(v) {
  const n = parseInt((v || "").replace(/[^0-9]/g, ""));
  if (!n) return null;
  return "\u0E3F" + n.toLocaleString();
}

/* ── Render current page of cards ── */
function renderPage() {
  const sortField = document.getElementById("sort-field").value;
  const desc = document.getElementById("sort-desc").checked;
  if (sortField) {
    filtered.sort((a, b) => {
      let av = (a[sortField] || "").trim();
      let bv = (b[sortField] || "").trim();
      const an = parseFloat(av.replace(/[^0-9.]/g, "")) || 0;
      const bn = parseFloat(bv.replace(/[^0-9.]/g, "")) || 0;
      const cmp = (an || bn) ? an - bn : av.localeCompare(bv);
      return desc ? -cmp : cmp;
    });
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById("result-count").textContent =
    `${filtered.length} listings \u2014 page ${currentPage} of ${Math.ceil(filtered.length / PAGE_SIZE) || 1}`;

  const grid = document.getElementById("listings");
  grid.innerHTML = page.map(p => {
    const id = (p.id || "").trim();
    const rent = fmtPrice(p.rent);
    const sale = fmtPrice(p.sale);
    const bed  = (p.bedrooms || "").trim();
    const bath = (p.bath || "").trim();
    const sqm  = (p.SQm || "").trim();
    const floor = (p.floor || "").trim();
    const room = (p.room_number || "").trim();
    const status = (p.status || "").trim();
    const photos = (p.photos || "").trim();

    return `
      <div class="card">
        <div class="card-thumb" style="cursor:pointer"
             onclick="openPhotos('${photos.replace(/'/g,"\\'")}', '${(p.structure||'').trim().replace(/'/g,"\\'")}', '${id}')">
          <div class="spinner"></div>
          <img src="thumbs/${id}.webp" loading="lazy"
               alt="${(p.structure||'').trim()}"
               onload="this.previousElementSibling.style.display='none'"
               onerror="this.previousElementSibling.style.display='none'; this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23555%22 font-size=%2214%22>No photo</text></svg>'">
          <span class="id-tag">#${id}</span>
        </div>
        <div class="card-body">
          <div class="building" title="${(p.structure||'').trim()}">${(p.structure||'Unknown').trim()}</div>
          <div><span class="badge ${badgeClass(status)}">${status || '?'}</span></div>
          <div class="meta">
            ${room ? 'Room ' + room : ''}${floor ? ' \u00B7 Fl.' + floor : ''}
          </div>
          <div class="meta">
            ${bed ? bed + ' BR' : ''}${bath ? ' \u00B7 ' + bath + ' BA' : ''}${sqm ? ' \u00B7 ' + sqm + ' m\u00B2' : ''}
          </div>
          <div class="price">
            ${rent ? '<span class="rent">Rent ' + rent + '</span>' : ''}
            ${rent && sale ? '<br>' : ''}
            ${sale ? '<span class="sale">Sale ' + sale + '</span>' : ''}
            ${!rent && !sale ? '<span class="meta">Price on request</span>' : ''}
          </div>
        </div>
      </div>`;
  }).join("");

  renderPagination();
}

/* ── Pagination ── */
function renderPagination() {
  const total = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const el = document.getElementById("pagination");
  el.innerHTML = "";

  function btn(label, page, active) {
    const b = document.createElement("button");
    b.textContent = label;
    if (active) b.setAttribute("aria-current", "page");
    b.addEventListener("click", () => { currentPage = page; renderPage(); window.scrollTo(0, 0); });
    return b;
  }

  if (currentPage > 1) { el.appendChild(btn("\u00AB First", 1)); el.appendChild(btn("\u2039 Prev", currentPage - 1)); }

  const range = 2;
  let lo = Math.max(1, currentPage - range);
  let hi = Math.min(total, currentPage + range);
  if (lo > 1) { el.appendChild(btn("1", 1)); if (lo > 2) el.appendChild(Object.assign(document.createElement("span"), { textContent: "\u2026" })); }
  for (let i = lo; i <= hi; i++) el.appendChild(btn(i, i, i === currentPage));
  if (hi < total) { if (hi < total - 1) el.appendChild(Object.assign(document.createElement("span"), { textContent: "\u2026" })); el.appendChild(btn(total, total)); }

  if (currentPage < total) { el.appendChild(btn("Next \u203A", currentPage + 1)); el.appendChild(btn("Last \u00BB", total)); }
}

/* ── Filters ── */
document.getElementById("filter-form").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target).entries());
  filtered = allProperties.filter(p => {
    const rent = parseInt((p.rent || "").replace(/[^0-9]/g, "")) || 0;
    const sale = parseInt((p.sale || "").replace(/[^0-9]/g, "")) || 0;
    const bed  = parseInt(p.bedrooms) || 0;
    const bath = parseInt(p.bath) || 0;
    const sqm  = parseFloat(p.SQm) || 0;

    return (
      (!fd.structure || (p.structure || "").toLowerCase().includes(fd.structure.toLowerCase())) &&
      (!fd.status    || p.status === fd.status) &&
      (!fd.minRent   || rent >= +fd.minRent) &&
      (!fd.maxRent   || rent <= +fd.maxRent) &&
      (!fd.minSale   || sale >= +fd.minSale) &&
      (!fd.maxSale   || sale <= +fd.maxSale) &&
      (!fd.minBed    || bed  >= +fd.minBed) &&
      (!fd.maxBed    || bed  <= +fd.maxBed) &&
      (!fd.minBath   || bath >= +fd.minBath) &&
      (!fd.maxBath   || bath <= +fd.maxBath) &&
      (!fd.minSqm    || sqm  >= +fd.minSqm) &&
      (!fd.maxSqm    || sqm  <= +fd.maxSqm) &&
      (!fd.idSearch   || (p.id || "").includes(fd.idSearch) || (p.room_number || "").toLowerCase().includes(fd.idSearch.toLowerCase()))
    );
  });
  currentPage = 1;
  renderPage();
});

document.getElementById("clear-btn").addEventListener("click", () => {
  document.getElementById("filter-form").reset();
  filtered = allProperties.slice();
  currentPage = 1;
  renderPage();
});

document.getElementById("sort-field").addEventListener("change", renderPage);
document.getElementById("sort-desc").addEventListener("change", renderPage);

/* ── Photo overlay ── */
function openPhotos(url, name, id) {
  if (!url) return;
  document.getElementById("overlay-title").textContent = name || "Property Photos";
  document.getElementById("overlay-tag").textContent = id ? "#" + id : "";
  document.getElementById("overlay-frame").src = url;
  document.getElementById("photo-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closePhotos() {
  document.getElementById("photo-overlay").classList.remove("open");
  document.getElementById("overlay-frame").src = "about:blank";
  document.body.style.overflow = "";
}

document.getElementById("overlay-close").addEventListener("click", closePhotos);
document.addEventListener("keydown", e => { if (e.key === "Escape") closePhotos(); });

/* ── Boot ── */
loadData();
