// ============================================================
// MILFEstate — Photo Migration & Indexing
// ============================================================
// Setup:
//   1. Create a new Google Spreadsheet (this is your "Photos" sheet)
//   2. Extensions → Apps Script
//   3. Paste this code, save
//   4. Reload the spreadsheet
//   5. Use the "Photo Tools" menu
//
// The script reads listing IDs from Judy's published CSV,
// downloads photos from reverse.estate into Google Drive,
// and indexes all Drive URLs in this spreadsheet.
// ============================================================

var JUDY_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0D8NXWZ7ViUeHxH0XNdGycpf0fxaAEHAYqDGrMIbNYo4mrjT3WdoSjcPSeHO6TQ/pub?output=csv";
var ROOT_FOLDER_NAME = "MILFEstate";
var BATCH_SIZE = 50;

// ── Menu ──

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Photo Tools")
    .addItem("Migrate from reverse.estate (next batch)", "migratePhotos")
    .addItem("Migrate ALL (auto-batches)", "migrateAllWithTrigger")
    .addSeparator()
    .addItem("Index Drive folders", "indexDriveFolders")
    .addItem("Index ALL (auto-batches)", "indexAllWithTrigger")
    .addSeparator()
    .addItem("Stop all auto-batching", "stopTriggers")
    .addToUi();
}

// ── Fetch listing IDs from Judy's published CSV ──

function getListingIds() {
  var response = UrlFetchApp.fetch(JUDY_CSV);
  var csv = response.getContentText();
  var lines = csv.split("\n");
  var ids = [];
  var seen = {};
  for (var i = 1; i < lines.length; i++) {
    var match = lines[i].match(/^(\d+),([^,]+),/);
    if (match && match[2].trim() && !seen[match[1]]) {
      seen[match[1]] = true;
      ids.push({ id: match[1], photoPage: "https://reverse.estate/photos/" + match[1] });
    }
  }
  return ids;
}

// ── Migration: reverse.estate → Google Drive ──

function migratePhotos() {
  var rootFolder = getOrCreateRootFolder();
  var listings = getListingIds();
  var processed = 0;
  var skipped = 0;

  for (var i = 0; i < listings.length && processed < BATCH_SIZE; i++) {
    var id = listings[i].id;

    // Skip if folder already exists
    var existing = rootFolder.getFoldersByName(id);
    if (existing.hasNext()) { skipped++; continue; }

    var imageUrls = scrapeAllImages(listings[i].photoPage);
    if (imageUrls.length === 0) continue;

    var folder = rootFolder.createFolder(id);
    for (var j = 0; j < imageUrls.length; j++) {
      try {
        var blob = UrlFetchApp.fetch(imageUrls[j], { muteHttpExceptions: true }).getBlob();
        blob.setName(j + ".jpg");
        folder.createFile(blob);
      } catch (e) {
        Logger.log("Failed: ID " + id + " image " + j + ": " + e.message);
      }
    }

    processed++;
    if (processed % 10 === 0) Logger.log("Migrated " + processed + " properties");
  }

  SpreadsheetApp.getUi().alert(
    "Migration batch complete.\nMigrated: " + processed +
    "\nSkipped (already on Drive): " + skipped
  );
}

function scrapeAllImages(pageUrl) {
  try {
    var response = UrlFetchApp.fetch(pageUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return [];
    var html = response.getContentText();
    var urls = [];
    var regex = /src="(\/storage\/photos\/[^"]*?\/(\d+)\.jpg[^"]*)"/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      urls.push("https://reverse.estate" + match[1]);
    }
    return urls;
  } catch (e) {
    Logger.log("Error fetching " + pageUrl + ": " + e.message);
    return [];
  }
}

// ── Indexing: Drive folders → this spreadsheet ──

function indexDriveFolders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Photos");
  if (!sheet) {
    sheet = ss.insertSheet("Photos");
    sheet.getRange(1, 1).setValue("id");
    sheet.getRange(1, 2).setValue("photo_index");
    sheet.getRange(1, 3).setValue("drive_url");
  }

  // Also ensure a Thumbnails sheet for the page to load
  var firstSheet = ss.getSheetByName("Thumbnails");
  if (!firstSheet) {
    firstSheet = ss.insertSheet("Thumbnails");
    firstSheet.getRange(1, 1).setValue("id");
    firstSheet.getRange(1, 2).setValue("thumbnail_url");
  }

  // Get already-indexed IDs
  var existingData = sheet.getDataRange().getValues();
  var indexedIds = {};
  for (var i = 1; i < existingData.length; i++) {
    indexedIds[existingData[i][0].toString()] = true;
  }

  var rootFolder = getOrCreateRootFolder();
  var folders = rootFolder.getFolders();
  var processed = 0;
  var photoRows = [];
  var firstRows = [];

  while (folders.hasNext() && processed < BATCH_SIZE) {
    var folder = folders.next();
    var id = folder.getName();

    if (indexedIds[id]) continue;

    var files = folder.getFiles();
    var fileList = [];
    while (files.hasNext()) fileList.push(files.next());

    // Sort by filename (0.jpg, 1.jpg, ...)
    fileList.sort(function(a, b) { return a.getName().localeCompare(b.getName(), undefined, { numeric: true }); });

    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var url = "https://drive.google.com/uc?export=view&id=" + file.getId();
      photoRows.push([id, i, url]);
      if (i === 0) firstRows.push([id, "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w200"]);
    }

    processed++;
  }

  if (photoRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, photoRows.length, 3).setValues(photoRows);
  }
  if (firstRows.length > 0) {
    firstSheet.getRange(firstSheet.getLastRow() + 1, 1, firstRows.length, 2).setValues(firstRows);
  }

  SpreadsheetApp.getUi().alert(
    "Indexing complete.\nFolders indexed: " + processed +
    "\nPhoto entries added: " + photoRows.length
  );
}

// ── Auto-batching ──

function migrateAllWithTrigger() {
  stopTriggers();
  ScriptApp.newTrigger("migrateBatchAuto").timeBased().everyMinutes(10).create();
  SpreadsheetApp.getUi().alert(
    "Auto-migration started.\n~" + BATCH_SIZE +
    " properties every 10 minutes.\nUse 'Stop all auto-batching' when done."
  );
}

function migrateBatchAuto() {
  var rootFolder = getOrCreateRootFolder();
  var listings = getListingIds();
  var processed = 0;

  for (var i = 0; i < listings.length && processed < BATCH_SIZE; i++) {
    var id = listings[i].id;
    var existing = rootFolder.getFoldersByName(id);
    if (existing.hasNext()) continue;

    var imageUrls = scrapeAllImages(listings[i].photoPage);
    if (imageUrls.length === 0) continue;

    var folder = rootFolder.createFolder(id);
    for (var j = 0; j < imageUrls.length; j++) {
      try {
        var blob = UrlFetchApp.fetch(imageUrls[j], { muteHttpExceptions: true }).getBlob();
        blob.setName(j + ".jpg");
        folder.createFile(blob);
      } catch (e) {}
    }
    processed++;
  }

  if (processed === 0) {
    stopTriggers();
    Logger.log("Migration complete — triggers removed.");
  }
}

function indexAllWithTrigger() {
  stopTriggers();
  ScriptApp.newTrigger("indexBatchAuto").timeBased().everyMinutes(10).create();
  SpreadsheetApp.getUi().alert("Auto-indexing started.");
}

function indexBatchAuto() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Photos");
  if (!sheet) return;

  var existingData = sheet.getDataRange().getValues();
  var indexedIds = {};
  for (var i = 1; i < existingData.length; i++) {
    indexedIds[existingData[i][0].toString()] = true;
  }

  var firstSheet = ss.getSheetByName("Thumbnails");
  var rootFolder = getOrCreateRootFolder();
  var folders = rootFolder.getFolders();
  var processed = 0;
  var photoRows = [];
  var firstRows = [];

  while (folders.hasNext() && processed < BATCH_SIZE) {
    var folder = folders.next();
    var id = folder.getName();
    if (indexedIds[id]) continue;

    var files = folder.getFiles();
    var fileList = [];
    while (files.hasNext()) fileList.push(files.next());
    fileList.sort(function(a, b) { return a.getName().localeCompare(b.getName(), undefined, { numeric: true }); });

    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var url = "https://drive.google.com/uc?export=view&id=" + file.getId();
      photoRows.push([id, i, url]);
      if (i === 0) firstRows.push([id, "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w200"]);
    }
    processed++;
  }

  if (photoRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, photoRows.length, 3).setValues(photoRows);
  }
  if (firstRows.length > 0 && firstSheet) {
    firstSheet.getRange(firstSheet.getLastRow() + 1, 1, firstRows.length, 2).setValues(firstRows);
  }

  if (processed === 0) {
    stopTriggers();
    Logger.log("Indexing complete — triggers removed.");
  }
}

// ── Helpers ──

function getOrCreateRootFolder() {
  var folders = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function stopTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
}
