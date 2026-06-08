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
var INDEX_BATCH_SIZE = 200;

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
    .addSeparator()
    .addItem("Backfill Status from Drive", "backfillStatus")
    .addItem("Verify folders (fix incomplete)", "verifyFolders")
    .addItem("Delete ALL folders and start over", "remigrateFolders")
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

// ── Status sheet: tracks migration progress ──

function getStatusSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Status");
  if (!sheet) {
    sheet = ss.insertSheet("Status");
    sheet.getRange(1, 1).setValue("id");
    sheet.getRange(1, 2).setValue("status");
    sheet.getRange(1, 3).setValue("photos");
    sheet.getRange(1, 4).setValue("migrated_at");
  }
  return sheet;
}

function getMigratedIds() {
  var sheet = getStatusSheet();
  var data = sheet.getDataRange().getValues();
  var ids = {};
  for (var i = 1; i < data.length; i++) {
    ids[data[i][0].toString()] = true;
  }
  return ids;
}

function addStatusRow(sheet, id, photoCount) {
  sheet.appendRow([id, "migrated", photoCount, new Date()]);
}

// ── Migration: reverse.estate → Google Drive ──

function migratePhotos() {
  var statusSheet = getStatusSheet();
  var migrated = getMigratedIds();
  var rootFolder = getOrCreateRootFolder();
  var listings = getListingIds();
  var processed = 0;
  var skipped = 0;

  for (var i = 0; i < listings.length && processed < BATCH_SIZE; i++) {
    var id = listings[i].id;
    if (migrated[id]) { skipped++; continue; }

    var imageUrls = scrapeAllImages(listings[i].photoPage);
    if (imageUrls.length === 0) continue;

    // Download all images first, then create folder
    var blobs = [];
    var allOk = true;
    for (var j = 0; j < imageUrls.length; j++) {
      try {
        var blob = UrlFetchApp.fetch(imageUrls[j], { muteHttpExceptions: true }).getBlob();
        blob.setName(j + ".jpg");
        blobs.push(blob);
      } catch (e) {
        Logger.log("Failed: ID " + id + " image " + j + ": " + e.message);
        allOk = false;
        break;
      }
    }
    if (!allOk || blobs.length === 0) continue;

    var folder = rootFolder.createFolder(id);
    for (var j = 0; j < blobs.length; j++) {
      folder.createFile(blobs[j]);
    }

    addStatusRow(statusSheet, id, blobs.length);
    processed++;
    if (processed % 10 === 0) Logger.log("Migrated " + processed + " properties");
  }

  SpreadsheetApp.getUi().alert(
    "Migration batch complete.\nMigrated: " + processed +
    "\nSkipped (already done): " + skipped
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

  // Get migrated IDs from Status sheet (fast, no Drive calls)
  var migrated = getMigratedIds();
  var migratedList = Object.keys(migrated).sort(function(a, b) { return parseInt(a) - parseInt(b); });
  var rootFolder = getOrCreateRootFolder();
  var processed = 0;
  var skipped = 0;
  var photoRows = 0;
  var firstRows = [];

  for (var i = 0; i < migratedList.length && processed < INDEX_BATCH_SIZE; i++) {
    var id = migratedList[i];
    if (indexedIds[id]) { skipped++; continue; }

    // Folder is confirmed migrated — look it up
    var folderIter = rootFolder.getFoldersByName(id);
    if (!folderIter.hasNext()) continue;

    var folder = folderIter.next();
    var files = folder.getFiles();
    var fileList = [];
    while (files.hasNext()) fileList.push(files.next());

    // Sort by filename (0.jpg, 1.jpg, ...)
    fileList.sort(function(a, b) { return a.getName().localeCompare(b.getName(), undefined, { numeric: true }); });

    var folderPhotoRows = [];
    for (var j = 0; j < fileList.length; j++) {
      var file = fileList[j];
      var url = "https://drive.google.com/uc?export=view&id=" + file.getId();
      folderPhotoRows.push([id, j, url]);
      if (j === 0) firstRows.push([id, "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w200"]);
    }

    // Write immediately after each folder
    if (folderPhotoRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, folderPhotoRows.length, 3).setValues(folderPhotoRows);
    }
    if (firstRows.length > 0) {
      firstSheet.getRange(firstSheet.getLastRow() + 1, 1, firstRows.length, 2).setValues(firstRows);
      firstRows = [];
    }

    photoRows += folderPhotoRows.length;
    processed++;
  }

  SpreadsheetApp.getUi().alert(
    "Indexing complete.\nFolders indexed: " + processed +
    "\nSkipped (already indexed): " + skipped +
    "\nPhoto entries added: " + photoRows
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
  var t0 = new Date();
  var props = PropertiesService.getScriptProperties();
  var startIdx = parseInt(props.getProperty("migrateIndex") || "0");

  var statusSheet = getStatusSheet();
  var migrated = getMigratedIds();
  var rootFolder = getOrCreateRootFolder();
  var listings = getListingIds();
  Logger.log("Setup done (" + ((new Date() - t0)/1000) + "s). Starting from index " + startIdx + ", " + Object.keys(migrated).length + " already done");

  var processed = 0;
  var allDone = true;

  for (var i = startIdx; i < listings.length && processed < BATCH_SIZE; i++) {
    var id = listings[i].id;
    if (migrated[id]) continue;

    allDone = false;
    Logger.log("Processing ID " + id + " (" + ((new Date() - t0)/1000) + "s)");
    var imageUrls = scrapeAllImages(listings[i].photoPage);
    if (imageUrls.length === 0) {
      addStatusRow(statusSheet, id, 0);
      props.setProperty("migrateIndex", (i + 1).toString());
      continue;
    }

    var blobs = [];
    var allOk = true;
    for (var j = 0; j < imageUrls.length; j++) {
      try {
        var blob = UrlFetchApp.fetch(imageUrls[j], { muteHttpExceptions: true }).getBlob();
        blob.setName(j + ".jpg");
        blobs.push(blob);
      } catch (e) { allOk = false; break; }
    }
    if (!allOk || blobs.length === 0) {
      props.setProperty("migrateIndex", (i + 1).toString());
      continue;
    }

    var folder = rootFolder.createFolder(id);
    for (var j = 0; j < blobs.length; j++) {
      folder.createFile(blobs[j]);
    }

    addStatusRow(statusSheet, id, blobs.length);
    props.setProperty("migrateIndex", (i + 1).toString());
    processed++;
    Logger.log("Done ID " + id + ": " + blobs.length + " photos (" + ((new Date() - t0)/1000) + "s)");
  }

  if (allDone && processed === 0) {
    stopTriggers();
    props.deleteProperty("migrateIndex");
    Logger.log("Migration complete — triggers removed.");
  } else {
    Logger.log("Batch done. Processed: " + processed + ", total migrated: " + (Object.keys(migrated).length + processed));
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
  var migrated = getMigratedIds();
  var migratedList = Object.keys(migrated).sort(function(a, b) { return parseInt(a) - parseInt(b); });
  var rootFolder = getOrCreateRootFolder();
  var processed = 0;
  var photoCount = 0;

  for (var i = 0; i < migratedList.length && processed < INDEX_BATCH_SIZE; i++) {
    var id = migratedList[i];
    if (indexedIds[id]) continue;

    var folderIter = rootFolder.getFoldersByName(id);
    if (!folderIter.hasNext()) continue;

    var folder = folderIter.next();
    var files = folder.getFiles();
    var fileList = [];
    while (files.hasNext()) fileList.push(files.next());
    fileList.sort(function(a, b) { return a.getName().localeCompare(b.getName(), undefined, { numeric: true }); });

    var folderRows = [];
    var firstRows = [];
    for (var j = 0; j < fileList.length; j++) {
      var file = fileList[j];
      var url = "https://drive.google.com/uc?export=view&id=" + file.getId();
      folderRows.push([id, j, url]);
      if (j === 0) firstRows.push([id, "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w200"]);
    }

    if (folderRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, folderRows.length, 3).setValues(folderRows);
    }
    if (firstRows.length > 0 && firstSheet) {
      firstSheet.getRange(firstSheet.getLastRow() + 1, 1, firstRows.length, 2).setValues(firstRows);
    }

    photoCount += folderRows.length;
    processed++;
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

/**
 * Backfills the Status sheet by scanning existing Drive folders.
 * Run this once to catch up Status with what's already been migrated.
 * Processes 500 folders per run — click multiple times if needed.
 */
function backfillStatus() {
  var statusSheet = getStatusSheet();
  var migrated = getMigratedIds();
  var rootFolder = getOrCreateRootFolder();
  var folders = rootFolder.getFolders();
  var added = 0;
  var skipped = 0;
  var rows = [];

  while (folders.hasNext()) {
    var folder = folders.next();
    var id = folder.getName();
    if (migrated[id]) { skipped++; continue; }

    rows.push([id, "migrated", -1, new Date()]);
    added++;
  }

  if (rows.length > 0) {
    statusSheet.getRange(statusSheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }

  SpreadsheetApp.getUi().alert(
    "Backfill complete.\nAdded: " + added +
    "\nAlready in Status: " + skipped
  );
}

function resetMigrateIndex() {
  PropertiesService.getScriptProperties().deleteProperty("migrateIndex");
  SpreadsheetApp.getUi().alert("Migration index reset to 0. Next batch starts from the beginning.");
}

function stopTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
}

/**
 * Verifies existing Drive folders have the correct number of photos.
 * Deletes incomplete folders so the next migration batch re-downloads them.
 */
function verifyFolders() {
  var rootFolder = getOrCreateRootFolder();
  var folders = rootFolder.getFolders();
  var checked = 0;
  var fixed = 0;
  var ok = 0;
  var log = [];

  while (folders.hasNext()) {
    var folder = folders.next();
    var id = folder.getName();

    // Count files in Drive folder
    var files = folder.getFiles();
    var driveCount = 0;
    while (files.hasNext()) { files.next(); driveCount++; }

    // Count photos on reverse.estate
    var expectedUrls = scrapeAllImages("https://reverse.estate/photos/" + id);
    var expectedCount = expectedUrls.length;

    if (expectedCount === 0) {
      // Can't verify — photo page might be down
      log.push("ID " + id + ": skipped (reverse.estate returned 0)");
    } else if (driveCount < expectedCount) {
      // Incomplete — delete folder for re-migration
      folder.setTrashed(true);
      log.push("ID " + id + ": FIXED — had " + driveCount + "/" + expectedCount + " → deleted for re-migration");
      fixed++;
    } else {
      ok++;
    }

    checked++;
    if (checked % 20 === 0) Logger.log("Verified " + checked + " folders...");
  }

  var msg = "Verified: " + checked + "\nOK: " + ok + "\nFixed (deleted): " + fixed;
  if (log.length > 0) msg += "\n\n" + log.join("\n");
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Deletes ALL Drive folders so they get re-migrated.
 */
function remigrateFolders() {
  var rootFolder = getOrCreateRootFolder();
  var deleted = 0;

  // Also clean up the spreadsheet entries for these IDs
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var photosSheet = ss.getSheetByName("Photos");
  var thumbsSheet = ss.getSheetByName("Thumbnails");

  var folders = rootFolder.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    folder.setTrashed(true);
    deleted++;
  }

  // Clear spreadsheet data (keep headers)
  if (photosSheet && photosSheet.getLastRow() > 1) {
    photosSheet.getRange(2, 1, photosSheet.getLastRow() - 1, 3).clear();
  }
  if (thumbsSheet && thumbsSheet.getLastRow() > 1) {
    thumbsSheet.getRange(2, 1, thumbsSheet.getLastRow() - 1, 2).clear();
  }

  SpreadsheetApp.getUi().alert("Deleted " + deleted + " folders.\nCleared Photos and Thumbnails sheets.\nRun migration again to re-download.");
}
