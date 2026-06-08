const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0D8NXWZ7ViUeHxH0XNdGycpf0fxaAEHAYqDGrMIbNYo4mrjT3WdoSjcPSeHO6TQ/pub?output=csv";
const THUMBS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSH5B8X8YSeOow9V0JjzKQwazvqV4D1mVS0hz6NjrCiJLMeGx4lrfsAETCppmp2VH9gszJfVo_bNgS_/pub?gid=1448330933&single=true&output=csv";
const PHOTOS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSH5B8X8YSeOow9V0JjzKQwazvqV4D1mVS0hz6NjrCiJLMeGx4lrfsAETCppmp2VH9gszJfVo_bNgS_/pub?gid=353008864&single=true&output=csv";
const THUMB_MAP_URL = "thumb-map.json";
const PAGE_SIZE = 16;
const ADMIN = new URLSearchParams(window.location.search).get("key") === "JudyRedFlags";

let allProperties = [];
let filtered = [];
let currentPage = 1;
let thumbMap = {};

/* ── Convert Drive URL to embeddable thumbnail URL ── */
function driveThumb(url, size) {
  if (!url) return '';
  if (!url.includes("drive.google.com")) return url; // reverse.estate URLs pass through
  const m = url.match(/[?&]id=([^&]+)/);
  if (m) return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w" + (size || 200);
  return url;
}

/* ── Load CSV as promise ── */
function loadCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, { download: true, header: true, skipEmptyLines: true, complete: resolve, error: reject });
  });
}

/* ── Load all data sources ── */
function loadData() {
  const thumbJsonPromise = fetch(THUMB_MAP_URL).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const thumbCsvPromise = loadCSV(THUMBS_URL).catch(() => ({ data: [] }));
  const csvPromise = loadCSV(SHEET_URL);

  Promise.all([thumbJsonPromise, thumbCsvPromise, csvPromise])
    .then(([thumbJson, thumbCsv, result]) => {
      // Start with thumb-map.json as base
      thumbMap = thumbJson;
      // Override with Drive thumbnails where available
      thumbCsv.data.forEach(r => {
        const id = (r.id || "").trim();
        const url = (r.drive_url || r.thumbnail_url || "").trim();
        if (id && url) thumbMap[id] = url;
      });

      allProperties = result.data.filter(r => r.structure && r.structure.trim());
      filtered = allProperties.slice();
      renderPage();
      document.getElementById("loading-screen").style.display = "none";
    })
    .catch(err => {
      console.error("Load error:", err);
      document.getElementById("loading-screen").innerHTML =
        '<p style="color:#f66;text-align:center">Failed to load data</p>';
    });
}

/* ── Status badge class ── */
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

/* ── Format price ── */
function fmtPrice(v) {
  const n = parseInt((v || "").replace(/[^0-9]/g, ""));
  if (!n) return null;
  return "\u0E3F" + n.toLocaleString();
}

/* ── Render cards ── */
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
  grid.innerHTML = page.map((p, idx) => {
    const id = (p.id || "").trim();
    const rent = fmtPrice(p.rent);
    const sale = fmtPrice(p.sale);
    const bed  = (p.bedrooms || "").trim();
    const bath = (p.bath || "").trim();
    const sqm  = (p.SQm || "").trim();
    const floor = (p.floor || "").trim();
    const room = (p.room_number || "").trim();
    const status = (p.status || "").trim();

    // Store property ref for gallery
    const pageIdx = (currentPage - 1) * PAGE_SIZE + idx;

    return `
      <div class="card">
        <div class="card-thumb" style="cursor:pointer"
             onclick="openGallery(${pageIdx})">
          <div class="spinner"></div>
          <img src="${driveThumb(thumbMap[id], 200) || ''}" loading="lazy"
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

/* ── Photo gallery overlay ── */
let galleryPhotos = [];
let galleryIndex = 0;
let galleryProperty = null;

function openGallery(filteredIdx) {
  galleryProperty = filtered[filteredIdx];
  if (!galleryProperty) return;

  const p = galleryProperty;
  const id = (p.id || "").trim();
  const name = (p.structure || "").trim();

  document.getElementById("overlay-title").textContent = name || "Property Photos";
  var tagEl = document.getElementById("overlay-tag");
  tagEl.textContent = id ? "#" + id : "";
  if (ADMIN) {
    tagEl.style.cursor = "pointer";
    tagEl.onclick = function() {
      var info = document.getElementById("owner-info");
      if (info) info.style.display = info.style.display === "none" ? "" : "none";
    };
  }
  document.getElementById("photo-overlay").classList.add("open");
  document.body.style.overflow = "hidden";

  const container = document.getElementById("gallery-container");
  container.innerHTML = '<div class="spinner" style="margin:auto"></div>';

  // Fetch photos for this listing from the Photos sheet
  loadCSV(PHOTOS_URL).then(result => {
    galleryPhotos = result.data
      .filter(r => (r.id || "").trim() === id)
      .sort((a, b) => parseInt(a.photo_index || 0) - parseInt(b.photo_index || 0))
      .map(r => driveThumb((r.drive_url || "").trim(), 1000))
      .filter(Boolean);

    galleryIndex = 0;
    renderGallery();
  }).catch(() => {
    container.innerHTML = '<p style="text-align:center;color:#f66;margin-top:3rem">Failed to load photos</p>';
  });
}

function renderGallery() {
  const container = document.getElementById("gallery-container");
  const p = galleryProperty;
  const rent = fmtPrice(p.rent);
  const sale = fmtPrice(p.sale);
  const bed = (p.bedrooms || "").trim();
  const bath = (p.bath || "").trim();
  const sqm = (p.SQm || "").trim();
  const floor = (p.floor || "").trim();
  const room = (p.room_number || "").trim();
  const status = (p.status || "").trim();
  const owner = (p.owner_name || "").trim();
  const phone = (p["phone Number"] || "").trim();
  const phoneHref = phone.replace(/[^0-9+]/g, "");

  const hasPhotos = galleryPhotos.length > 0;
  const url = hasPhotos ? galleryPhotos[galleryIndex] : "";
  const total = galleryPhotos.length;

  container.innerHTML = `
    <div class="gallery-layout">
      <div class="gallery-viewer">
        ${hasPhotos && total > 1 ? '<button class="gallery-prev" onclick="galleryPrev()">\u2039</button>' : ''}
        ${hasPhotos
          ? '<img src="' + url + '" alt="Photo ' + (galleryIndex + 1) + '">'
          : '<p style="color:#999;margin:auto">No photos available</p>'}
        ${hasPhotos && total > 1 ? '<button class="gallery-next" onclick="galleryNext()">\u203A</button>' : ''}
      </div>
      <div class="gallery-details">
        <h3>${(p.structure || "Unknown").trim()}</h3>
        <span class="badge ${badgeClass(status)}">${status || "?"}</span>
        ${hasPhotos ? '<div class="gallery-counter">' + (galleryIndex + 1) + ' / ' + total + '</div>' : ''}
        <table>
          ${room ? '<tr><td>Room</td><td>' + room + '</td></tr>' : ''}
          ${floor ? '<tr><td>Floor</td><td>' + floor + '</td></tr>' : ''}
          ${bed ? '<tr><td>Bedrooms</td><td>' + bed + '</td></tr>' : ''}
          ${bath ? '<tr><td>Bathrooms</td><td>' + bath + '</td></tr>' : ''}
          ${sqm ? '<tr><td>Area</td><td>' + sqm + ' m\u00B2</td></tr>' : ''}
          ${rent ? '<tr><td>Rent</td><td class="rent">' + rent + '</td></tr>' : ''}
          ${sale ? '<tr><td>Sale</td><td class="sale">' + sale + '</td></tr>' : ''}
        </table>
        ${ADMIN ? '<div class="gallery-contact" id="owner-info" style="display:none">' +
          (owner ? '<div><strong>Owner:</strong> ' + owner + '</div>' : '') +
          (phone ? '<div><strong>Phone:</strong> <a href="tel:' + phoneHref + '">' + phone + '</a></div>' : '') +
        '</div>' : ''}
      </div>
    </div>
  `;
}

function galleryPrev() {
  galleryIndex = (galleryIndex - 1 + galleryPhotos.length) % galleryPhotos.length;
  renderGallery();
}

function galleryNext() {
  galleryIndex = (galleryIndex + 1) % galleryPhotos.length;
  renderGallery();
}

function closePhotos() {
  document.getElementById("photo-overlay").classList.remove("open");
  galleryPhotos = [];
  galleryIndex = 0;
  document.body.style.overflow = "";
}

document.getElementById("overlay-close").addEventListener("click", closePhotos);
document.addEventListener("keydown", e => {
  if (!document.getElementById("photo-overlay").classList.contains("open")) return;
  if (e.key === "Escape") closePhotos();
  if (e.key === "ArrowLeft") galleryPrev();
  if (e.key === "ArrowRight") galleryNext();
});

/* ── Boot ── */
loadData();
