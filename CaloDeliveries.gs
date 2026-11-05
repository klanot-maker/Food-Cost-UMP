// ============================================================
// CALO DELIVERIES — fills the DELIVERIES tab from the Calo API
// ============================================================
// Source: @calo/dashboard-sdk  (GET /ext/v1/stats/deliveries)
//
//   Response:  { "count": 5321, "cost": [ { "currency": "AED", … } ] }
//              count = "Number of matching deliveries"  ← the figure we want
//
// WHY THE OLD SCRIPT NEVER WORKED
// The filter parameter is called `filters`, PLURAL, and both the day range
// and the kitchen go INSIDE it:
//
//     filters[day][gte] = 2026-11-05
//     filters[day][lte] = 2026-11-05
//     filters[kitchen]  = AE001
//
// The old code sent `filter` (singular) and `kitchen` at the top level.
// An unrecognised query parameter is not an error — it is ignored. So the
// endpoint matched EVERY delivery ever recorded and dutifully returned that
// total, around 60 million. The request succeeded; it just answered a
// different question. That is the whole bug.
//
// Because "wrong filter" looks exactly like "no filter", this file refuses
// to write any number above _CALO_SANE_MAX. A day that returns millions is
// a filter that was ignored, not a very good day.
//
// ── SETTINGS (Project Settings → Script Properties) ─────────
//   CALO_API_KEY    required. Sent as the X-Api-Key header.
//                   Your key needs the  kitchen:stats:read  scope.
//   CALO_API_BASE   optional. Defaults to the gateway below.
//   CALO_QS_STYLE   written automatically by caloDiagnose(). Leave it alone.
//
// The kitchen is NOT set here — it comes from Config.gs (CFG.kitchen), so a
// market that copies this dashboard gets its own kitchen without editing code.
//
// ── ORDER TO RUN THINGS ─────────────────────────────────────
//   1. caloDiagnose()        proves the key works and learns the encoding
//   2. caloPreviewSync()     shows what WOULD be written. Changes nothing.
//   3. caloSyncDeliveries()  writes into the DELIVERIES tab
//   4. caloInstallDailySync()  does step 3 every morning
//
// Nothing here touches any tab other than DELIVERIES.
// ============================================================

var _CALO_DEFAULT_BASE = 'https://0t42vvmg9i.execute-api.us-east-1.amazonaws.com';
var _CALO_PATH_DLV     = '/ext/v1/stats/deliveries';
var _CALO_PATH_MEAL    = '/ext/v1/stats/meal';

// A single kitchen's day. UAE runs about 5,500. Anything past this means
// the day filter did not apply, so the figure is an all-time total.
var _CALO_SANE_MAX = 100000;


// ── settings ────────────────────────────────────────────────

function _caloBase_() {
  var b = PropertiesService.getScriptProperties().getProperty('CALO_API_BASE');
  return String(b || _CALO_DEFAULT_BASE).replace(/\/+$/, '');
}

function _caloKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('CALO_API_KEY');
  if (!k) {
    throw new Error('CALO_API_KEY is not set. Project Settings → Script Properties ' +
                    '→ Add script property → CALO_API_KEY, with the key as its value. ' +
                    'The key needs the kitchen:stats:read scope.');
  }
  return k;
}

function _caloKitchen_() {
  var k = (typeof CFG_KITCHEN_ === 'function') ? CFG_KITCHEN_() : '';
  if (!k) throw new Error('No kitchen code. Set CFG.kitchen in Config.gs (e.g. AE001).');
  return k;
}

/** Local copy of the date reader, used only if Dashboard.gs is not present. */
function _caloYmd_(v) {
  if (typeof _dlvYmd_ === 'function') return _dlvYmd_(v);
  if (v instanceof Date && !isNaN(v.getTime())) {
    var p = function(n) { return (n < 10 ? '0' : '') + n; };
    return v.getFullYear() + '-' + p(v.getMonth()+1) + '-' + p(v.getDate());
  }
  if (typeof v === 'number') return null;        // a serial is not a date here
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  var d = new Date(s);
  if (isNaN(d.getTime())) return null;
  var q = function(n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + q(d.getMonth()+1) + '-' + q(d.getDate());
}

function _caloToday_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _caloShiftDays_(ymd, n) {
  var p = ymd.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  var q = function(x) { return (x < 10 ? '0' : '') + x; };
  return d.getFullYear() + '-' + q(d.getMonth()+1) + '-' + q(d.getDate());
}


// ── the request ─────────────────────────────────────────────

/**
 * The same filter written four ways.
 *
 * The README documents what `filters` CONTAINS; it does not say how the
 * gateway wants a nested object spelled in a query string, and that varies
 * with the framework behind it. Rather than guess once and be wrong for an
 * afternoon, all four are tried and the winner is remembered.
 */
function _caloDlvUrls_(day, kitchen) {
  var base = _caloBase_() + _CALO_PATH_DLV;
  var e    = encodeURIComponent;
  var obj  = { day: { gte: day, lte: day }, kitchen: kitchen };

  return [
    { style: 'brackets',
      url: base + '?filters%5Bday%5D%5Bgte%5D=' + e(day) +
                  '&filters%5Bday%5D%5Blte%5D=' + e(day) +
                  '&filters%5Bkitchen%5D='      + e(kitchen) },

    { style: 'json',
      url: base + '?filters=' + e(JSON.stringify(obj)) },

    { style: 'jsonDeep',
      url: base + '?filters%5Bday%5D=' + e(JSON.stringify(obj.day)) +
                  '&filters%5Bkitchen%5D=' + e(kitchen) },

    { style: 'dots',
      url: base + '?filters.day.gte=' + e(day) +
                  '&filters.day.lte=' + e(day) +
                  '&filters.kitchen=' + e(kitchen) }
  ];
}

/** One GET with the API key. Never throws on an HTTP error — returns it. */
function _caloGet_(url) {
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Api-Key': _caloKey_(), 'Accept': 'application/json' },
    muteHttpExceptions: true,
    followRedirects: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { code: code, text: text, json: json };
}

/**
 * The delivery count for one day, or null with a reason.
 * A count over _CALO_SANE_MAX is treated as a failure, not as data.
 */
function _caloCountFor_(day, style) {
  var kitchen = _caloKitchen_();
  var all     = _caloDlvUrls_(day, kitchen);
  var chosen  = null;
  for (var i = 0; i < all.length; i++) if (all[i].style === style) chosen = all[i];
  if (!chosen) chosen = all[0];

  var r = _caloGet_(chosen.url);
  if (r.code !== 200)                 return { ok: false, why: 'HTTP ' + r.code + ' — ' + r.text.substring(0, 200) };
  if (!r.json)                        return { ok: false, why: 'response was not JSON: ' + r.text.substring(0, 200) };
  if (typeof r.json.count !== 'number') return { ok: false, why: 'no "count" field in the response' };
  if (r.json.count > _CALO_SANE_MAX)  return { ok: false, why: 'count ' + r.json.count + ' is impossibly large for one ' +
                                                              'kitchen-day — the filter was ignored' };
  return { ok: true, count: r.json.count, cost: r.json.cost || [] };
}


// ── 1. DIAGNOSE ─────────────────────────────────────────────

/**
 * Proves the key works, finds the encoding the gateway accepts, and
 * remembers it. Run this first, and again if things ever stop working.
 */
function caloDiagnose() {
  var out = [], kitchen, day;
  function say(s) { out.push(s); }

  say('CALO DELIVERY API — diagnosis  (' + new Date() + ')');
  say('');

  try {
    kitchen = _caloKitchen_();
    _caloKey_();
  } catch (e) {
    say('STOP: ' + e.message);
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  // Yesterday, not today: a settled day is a stable thing to test against.
  day = _caloShiftDays_(_caloToday_(), -1);
  say('Base:     ' + _caloBase_());
  say('Kitchen:  ' + kitchen);
  say('Test day: ' + day);
  say('');

  // ── control: does the key work at all? ────────────────────
  // The meal endpoint takes `day` and `kitchen` at the top level, which is
  // unambiguous. If this answers, the key and its scope are fine and any
  // later failure is about the filter spelling, not about authentication.
  say('── Step 1: is the key accepted? (meal endpoint, simple parameters)');
  var e = encodeURIComponent;
  var mealUrl = _caloBase_() + _CALO_PATH_MEAL +
                '?day%5Bgte%5D=' + e(day) + '&day%5Blte%5D=' + e(day) +
                '&kitchen=' + e(kitchen);
  var m = _caloGet_(mealUrl);
  if (m.code === 200) {
    say('   OK    HTTP 200. The key works and has kitchen:stats:read.');
  } else if (m.code === 401 || m.code === 403) {
    say('   WRONG HTTP ' + m.code + '. ' + m.text.substring(0, 300));
    say('         The key is rejected, or it lacks the kitchen:stats:read scope.');
    say('         Ask the platform team on Slack to add that scope.');
    say('         Nothing below will work until this does.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  } else {
    say('   note  HTTP ' + m.code + '. ' + m.text.substring(0, 300));
    say('         Not fatal — carrying on to the delivery endpoint.');
  }
  say('');

  // ── the real question: how is `filters` spelled? ──────────
  say('── Step 2: which encoding does filters[] accept?');
  var urls = _caloDlvUrls_(day, kitchen), winner = null;
  urls.forEach(function(cand) {
    var r = _caloGet_(cand.url);
    if (r.code !== 200) {
      say('   no    ' + _caloPadRight_(cand.style, 9) + ' HTTP ' + r.code + ' — ' + r.text.substring(0, 120));
      return;
    }
    if (!r.json || typeof r.json.count !== 'number') {
      say('   no    ' + _caloPadRight_(cand.style, 9) + ' 200 but no count field');
      return;
    }
    if (r.json.count > _CALO_SANE_MAX) {
      // This is the old bug, caught in the act.
      say('   NO    ' + _caloPadRight_(cand.style, 9) + ' count ' + r.json.count +
          ' — filter IGNORED (this is the all-time total)');
      return;
    }
    say('   YES   ' + _caloPadRight_(cand.style, 9) + ' count ' + r.json.count + '  ← usable');
    if (!winner) winner = cand.style;
  });
  say('');

  if (!winner) {
    say('NONE of the four encodings returned a filtered count.');
    say('Everything that answered gave the all-time total, which means the');
    say('gateway is not reading `filters` in any shape tried here.');
    say('Send this log to the platform team and ask for one worked example');
    say('of a query string for GET ' + _CALO_PATH_DLV + '.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  PropertiesService.getScriptProperties().setProperty('CALO_QS_STYLE', winner);
  say('Using encoding "' + winner + '" from now on. Saved to Script Properties.');
  say('');

  // ── does it track reality? ────────────────────────────────
  say('── Step 3: the last 5 settled days, API against the sheet');
  say('');
  say('   date         API    sheet   difference');
  var sheetVals = {};
  try {
    sheetVals = _caloSheetIndex_().values;
  } catch (err) {
    say('   (could not read the DELIVERIES tab: ' + err.message + ')');
  }
  for (var i = 1; i <= 5; i++) {
    var d = _caloShiftDays_(_caloToday_(), -i);
    var c = _caloCountFor_(d, winner);
    var api = c.ok ? c.count : null;
    var sh  = sheetVals.hasOwnProperty(d) ? sheetVals[d] : null;
    var diff = (api != null && sh != null) ? (api - sh) : null;
    say('   ' + d + '   ' + _caloPadRight_(api == null ? ('— ' + c.why) : String(api), 7) +
        _caloPadRight_(sh == null ? '—' : String(sh), 8) +
        (diff == null ? '' : (diff > 0 ? '+' : '') + diff));
  }
  say('');
  say('Compare the API column against your Calo dashboard for those days.');
  say('If they match, run caloPreviewSync() next.');
  say('If they are close but not equal, the dashboard is probably filtering');
  say('by delivery status — tell me the gap and we will add that filter.');

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

function _caloPadRight_(s, w) {
  s = String(s);
  while (s.length < w) s += ' ';
  return s;
}


// ── the DELIVERIES tab ──────────────────────────────────────

/**
 * Maps every date in the DELIVERIES tab to the cell holding its count.
 *
 * The tab stacks a block per year down the sheet, each twelve month
 * column-pairs wide: an even column holds a date, the next holds its count.
 * Rather than compute where a date OUGHT to live — which breaks the first
 * time someone inserts a row — the sheet is read and the date is looked up
 * where it actually is.
 */
function _caloSheetIndex_() {
  var ss    = SpreadsheetApp.openById(SS_COMPLAINTS_());
  var sheet = ss.getSheetByName('DELIVERIES');
  if (!sheet) throw new Error('No tab called "DELIVERIES" in "' + ss.getName() + '".');

  var all = sheet.getDataRange().getValues();
  var cells = {}, values = {};
  for (var r = 0; r < all.length; r++) {
    var row = all[r];
    for (var c = 0; c + 1 < row.length; c += 2) {
      if (!row[c]) continue;
      var ds = _caloYmd_(row[c]);
      if (!ds || cells[ds]) continue;      // first occurrence wins
      cells[ds]  = { row: r + 1, col: c + 2 };   // 1-based, count is next column
      var n = Number(row[c + 1]);
      values[ds] = (row[c + 1] === '' || row[c + 1] === null || isNaN(n)) ? null : n;
    }
  }
  return { sheet: sheet, cells: cells, values: values };
}


// ── 2. PREVIEW ──────────────────────────────────────────────

/** Shows exactly what a sync would change. Writes nothing. */
function caloPreviewSync(daysBack) {
  return _caloSync_(daysBack, true);
}

// ── 3. SYNC ─────────────────────────────────────────────────

/** Writes the API's counts into the DELIVERIES tab. Touches no other tab. */
function caloSyncDeliveries(daysBack) {
  return _caloSync_(daysBack, false);
}

function _caloSync_(daysBack, previewOnly) {
  daysBack = Number(daysBack) || 7;
  var style = PropertiesService.getScriptProperties().getProperty('CALO_QS_STYLE');
  var out = [];
  function say(s) { out.push(s); }

  say((previewOnly ? 'PREVIEW — nothing will be written' : 'SYNC — writing to the DELIVERIES tab') +
      '  (' + new Date() + ')');
  say('');

  if (!style) {
    say('STOP: run caloDiagnose() first. It works out how this API wants its');
    say('      filter spelled and saves the answer.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  var idx   = _caloSheetIndex_();
  var today = _caloToday_();

  say('Encoding: ' + style + '    Kitchen: ' + _caloKitchen_());
  say('');
  say('   date         sheet now      API    action');

  var written = 0, skipped = 0, failed = 0;

  // Today and backwards only. Dates ahead of today hold the operation's
  // PLANNED figures, typed from the DPD board, and they are not the API's
  // to overwrite — the API reports what exists, not what is intended.
  for (var i = daysBack; i >= 0; i--) {
    var ds   = _caloShiftDays_(today, -i);
    var cell = idx.cells[ds];
    var now  = idx.values.hasOwnProperty(ds) ? idx.values[ds] : null;

    if (!cell) {
      say('   ' + ds + '   ' + _caloPadRight_('—', 14) + _caloPadRight_('—', 8) + 'no row for this date in the tab');
      skipped++;
      continue;
    }

    var c = _caloCountFor_(ds, style);
    if (!c.ok) {
      say('   ' + ds + '   ' + _caloPadRight_(now == null ? '(blank)' : now, 14) +
          _caloPadRight_('—', 8) + 'FAILED: ' + c.why);
      failed++;
      continue;
    }

    if (now === c.count) {
      say('   ' + ds + '   ' + _caloPadRight_(now, 14) + _caloPadRight_(c.count, 8) + 'already correct');
      skipped++;
      continue;
    }

    if (previewOnly) {
      say('   ' + ds + '   ' + _caloPadRight_(now == null ? '(blank)' : now, 14) +
          _caloPadRight_(c.count, 8) + 'would write');
    } else {
      idx.sheet.getRange(cell.row, cell.col).setValue(c.count);
      say('   ' + ds + '   ' + _caloPadRight_(now == null ? '(blank)' : now, 14) +
          _caloPadRight_(c.count, 8) + 'written');
      written++;
    }
  }

  say('');
  if (previewOnly) {
    say('Nothing was changed. Run caloSyncDeliveries() to apply this.');
  } else {
    say(written + ' written, ' + skipped + ' unchanged, ' + failed + ' failed.');
    if (written) {
      // The dashboard keys its cache on the workbook's last-modified time,
      // so a write here is picked up on its own within about a minute.
      say('The dashboard picks these up within about a minute. No redeploy needed.');
    }
    if (failed) {
      say('Some days failed. Run caloDiagnose() — the API may have changed, or');
      say('the key may have lost its scope.');
    }
  }

  var text = out.join('\n');
  Logger.log(text);
  return text;
}


// ── 4. THE DAILY TRIGGER ────────────────────────────────────

/**
 * Runs the sync every morning at 06:00 in the script's timezone.
 *
 * It re-syncs the whole of the last week, not just yesterday, so a day that
 * was wrong — because the API was down, or because deliveries settled after
 * the run — is corrected on the next pass instead of staying wrong forever.
 */
function caloInstallDailySync() {
  caloRemoveDailySync();
  ScriptApp.newTrigger('caloDailySyncRun').timeBased().atHour(6).everyDays(1).create();
  var msg = 'Daily sync installed: caloDailySyncRun, every day at about 06:00 ' +
            Session.getScriptTimeZone() + '. It re-checks the last 7 days each run.';
  Logger.log(msg);
  return msg;
}

function caloRemoveDailySync() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'caloDailySyncRun') { ScriptApp.deleteTrigger(t); n++; }
  });
  var msg = 'Removed ' + n + ' daily sync trigger(s).';
  Logger.log(msg);
  return msg;
}

/**
 * What the trigger calls. A trigger hands its handler an event object, so
 * this takes no argument and passes its own — calling caloSyncDeliveries
 * directly from a trigger would read that event as daysBack.
 */
function caloDailySyncRun() {
  return caloSyncDeliveries(7);
}
