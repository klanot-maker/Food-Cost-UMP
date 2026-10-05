// ============================================================
// LIVE DELIVERY STATS — @calo/dashboard-sdk API → DELIVERY tab
// ============================================================
// The SDK itself cannot run here: Apps Script has no npm. It is a
// client over an HTTP API though, so this calls that API directly.
//
// Base URL: https://0t42vvmg9i.execute-api.us-east-1.amazonaws.com
//
// WHAT THIS DOES
//   Fills the DELIVERY tab from the API, so the manual update goes
//   away and everything already reading that tab — the Operation
//   Overview hero, Capacity Overview, forecast vs actual, the Slack
//   summary's delivery lines — becomes live without being touched.
//
// HOW IT BEHAVES, by default
//   • Only fills days the sheet has no figure for. A number already
//     there is left alone and reported, never quietly replaced.
//   • Never writes today or any future day — a day is only written
//     once it has closed.
//   • previewDeliverySync() shows exactly what it would change
//     without changing anything.
//
// ── The key does NOT go in this file ────────────────────────
// Anyone with edit access to the project can read the source, so a
// key pasted here is a key handed out. Put it in Script Properties:
//
//   Project Settings (⚙) → Script Properties → Add script property
//     Property:  CALO_API_KEY
//     Value:     <your key>
//
// ── Still to fill in ────────────────────────────────────────
// CALO_DELIVERY_STATS_PATH below. Run probeDashboardApi() and send
// me the log, or the SDK's README, and I will set it.
// ============================================================

var CALO_API_BASE      = 'https://0t42vvmg9i.execute-api.us-east-1.amazonaws.com';
var CALO_API_KEY_PROP  = 'CALO_API_KEY';
var CALO_API_HEADER    = 'x-api-key';   // 'x-api-key' | 'bearer' | 'apikey'
var CALO_API_CACHE_TTL = 60;            // seconds — live figures, so far shorter than the sheets

var CALO_DELIVERY_STATS_PATH = '';      // ← e.g. '/stats/deliveries'
var CALO_SYNC_DAYS           = 14;      // how far back a run looks
var CALO_SYNC_OVERWRITE      = false;   // true lets it correct figures already in the sheet

// ── API CLIENT ──────────────────────────────────────────────
function _caloApiKey_() {
  var k = PropertiesService.getScriptProperties().getProperty(CALO_API_KEY_PROP);
  if (!k) {
    throw new Error('No API key stored. Project Settings → Script Properties → add '
      + CALO_API_KEY_PROP + ' with the key as its value.');
  }
  return k;
}

function _caloHeaders_(style) {
  var key = _caloApiKey_(), h = { 'Accept': 'application/json' };
  if (style === 'bearer')      h['Authorization'] = 'Bearer ' + key;
  else if (style === 'apikey') h['Authorization'] = key;
  else                         h['x-api-key'] = key;
  return h;
}

function callDashboardApi(path, params, style) {
  var url = CALO_API_BASE + (path.charAt(0) === '/' ? path : '/' + path);
  if (params) {
    var q = Object.keys(params)
      .filter(function(k){ return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (q.length) url += (url.indexOf('?') > -1 ? '&' : '?') + q.join('&');
  }
  var res  = UrlFetchApp.fetch(url, { method: 'get', headers: _caloHeaders_(style || CALO_API_HEADER),
                                      muteHttpExceptions: true });
  var code = res.getResponseCode(), body = res.getContentText();
  if (code >= 300) throw new Error('API returned ' + code + ' for ' + path + ': ' + body.substring(0, 300));
  try { return JSON.parse(body); } catch (e) { return body; }
}

// Tries each path against each way of presenting the key and reports what
// answers. Reads only — nothing is written anywhere.
function probeDashboardApi(paths) {
  var key;
  try { key = _caloApiKey_(); }
  catch (e) { Logger.log('STOPPED: ' + e.message); return e.message; }
  Logger.log('Key found (' + key.length + ' characters). Probing ' + CALO_API_BASE + '\n');

  var candidates = paths || [
    '/', '/stats', '/delivery', '/deliveries', '/delivery/stats', '/deliveries/stats',
    '/stats/delivery', '/stats/deliveries', '/delivery-stats', '/dashboard/stats',
    '/meal-stats', '/stats/meals', '/v1/stats', '/v1/delivery/stats'
  ];
  var out = [], hits = [];
  candidates.forEach(function(p) {
    ['x-api-key', 'bearer', 'apikey'].forEach(function(style) {
      var code, snippet;
      try {
        var res = UrlFetchApp.fetch(CALO_API_BASE + p,
          { method: 'get', headers: _caloHeaders_(style), muteHttpExceptions: true });
        code = res.getResponseCode();
        snippet = res.getContentText().substring(0, 160).replace(/\s+/g, ' ');
      } catch (e) { code = 'ERR'; snippet = e.message.substring(0, 160); }
      var line = _caloPad_(p, 24) + ' ' + _caloPad_(style, 10) + ' ' + code + '  ' + snippet;
      out.push(line);
      if (code !== 404 && code !== 403) hits.push(line);
    });
  });
  Logger.log(out.join('\n'));
  Logger.log('\n──────── anything that is not 404/403 ────────');
  Logger.log(hits.length ? hits.join('\n')
    : 'Nothing answered — the routes are different. Send the SDK README, or one real request from DevTools → Network.');
  return hits;
}

// ── READING COUNTS BY DATE ──────────────────────────────────
// Shapes the response into { 'YYYY-MM-DD': count }. Several plausible
// layouts are accepted, because the exact one is not known yet; anything
// unrecognised is reported rather than silently read as nothing.
function _caloNormaliseCounts_(json) {
  var out = {}, n = 0;
  var take = function(d, v) {
    var ds = _caloYmd_(d);
    if (!ds) return;
    var num = Number(String(v).replace(/[^0-9.\-]/g, ''));
    if (isNaN(num)) return;
    out[ds] = num; n++;
  };
  var rows = json;
  if (rows && !Array.isArray(rows)) {
    if (Array.isArray(rows.data))        rows = rows.data;
    else if (Array.isArray(rows.items))  rows = rows.items;
    else if (Array.isArray(rows.results))rows = rows.results;
    else if (Array.isArray(rows.stats))  rows = rows.stats;
  }
  if (Array.isArray(rows)) {
    rows.forEach(function(r) {
      if (!r || typeof r !== 'object') return;
      var d = r.date || r.day || r.deliveryDate || r.d || r.ds;
      var v = (r.count !== undefined) ? r.count
            : (r.deliveries !== undefined) ? r.deliveries
            : (r.total !== undefined) ? r.total
            : (r.value !== undefined) ? r.value : undefined;
      if (d !== undefined && v !== undefined) take(d, v);
    });
  } else if (rows && typeof rows === 'object') {
    Object.keys(rows).forEach(function(k) {       // { '2026-10-01': 5123, … }
      if (/^\d{4}-\d{2}-\d{2}/.test(k)) take(k, rows[k]);
    });
  }
  return { counts: out, found: n };
}

function _caloCountsByDate_(from, to) {
  if (!CALO_DELIVERY_STATS_PATH) {
    throw new Error('CALO_DELIVERY_STATS_PATH is not set — run probeDashboardApi() to find the route.');
  }
  var json = callDashboardApi(CALO_DELIVERY_STATS_PATH, { from: from, to: to });
  var norm = _caloNormaliseCounts_(json);
  if (!norm.found) {
    throw new Error('The API answered but no date/count pairs were recognised in it. '
      + 'First 400 characters: ' + JSON.stringify(json).substring(0, 400));
  }
  return norm.counts;
}

function getLiveDeliveryStats(from, to) {
  var ck = 'calo_live_' + (from || '') + '_' + (to || '');
  try { var hit = CacheService.getScriptCache().get(ck); if (hit) return JSON.parse(hit); } catch (e) {}
  try {
    var payload = { ok: true, counts: _caloCountsByDate_(from, to), fetchedAt: new Date().toISOString() };
    try { CacheService.getScriptCache().put(ck, JSON.stringify(payload), CALO_API_CACHE_TTL); } catch (e) {}
    return payload;
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── THE SYNC ────────────────────────────────────────────────
// Reads the DELIVERY tab's column pairs: an even column holds dates, the
// one after it holds that day's count. Returns where each date lives and
// whether it already carries a figure.
function _caloSheetIndex_(sheet) {
  var all = sheet.getDataRange().getValues();
  var idx = {};
  for (var r = 1; r < all.length; r++) {
    for (var c = 0; c + 1 < all[r].length; c += 2) {
      var ds = _caloYmd_(all[r][c]);
      if (!ds || idx[ds]) continue;
      var raw = all[r][c + 1];
      var cur = Number(String(raw === null || raw === undefined ? '' : raw).replace(/[^0-9.\-]/g, ''));
      idx[ds] = { row: r + 1, col: c + 2, value: isNaN(cur) ? 0 : cur,
                  blank: (raw === '' || raw === null || raw === undefined || cur === 0) };
    }
  }
  return { idx: idx, all: all };
}

function syncDeliveriesToSheet(opts) {
  // A time-driven trigger calls the handler with an event object; taken as
  // options that would silently turn settings on.
  if (!opts || typeof opts !== 'object' || opts.authMode || opts.triggerUid) opts = {};
  var dryRun    = !!opts.dryRun;
  var overwrite = (opts.overwrite === undefined) ? CALO_SYNC_OVERWRITE : !!opts.overwrite;
  var days      = opts.days || CALO_SYNC_DAYS;

  var today = _caloYmd_(new Date());
  var to    = opts.to || _caloShift_(today, -1);        // yesterday: today has not closed
  var from  = opts.from || _caloShift_(to, -(days - 1));
  if (to >= today) to = _caloShift_(today, -1);

  var rep = { ok: true, dryRun: dryRun, overwrite: overwrite, from: from, to: to,
              filled: [], alreadySet: [], differs: [], notInApi: [], wrote: 0 };
  try {
    var counts = _caloCountsByDate_(from, to);
    var ss     = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet  = ss.getSheetByName('DELIVERIES');
    if (!sheet) throw new Error('DELIVERIES sheet not found.');
    var index  = _caloSheetIndex_(sheet).idx;

    for (var d = from; d <= to; d = _caloShift_(d, 1)) {
      var apiVal = counts[d];
      if (apiVal === undefined) { rep.notInApi.push(d); continue; }
      var cell = index[d];

      if (cell && !cell.blank) {
        if (Math.abs(cell.value - apiVal) < 0.5) { rep.alreadySet.push(d); continue; }
        rep.differs.push({ date: d, sheet: cell.value, api: apiVal });
        if (!overwrite) continue;                        // reported, not replaced
      }
      if (dryRun) { rep.filled.push({ date: d, value: apiVal, newRow: !cell }); continue; }

      if (cell) sheet.getRange(cell.row, cell.col).setValue(apiVal);
      else      addDeliveryRecord(d, apiVal);            // creates the row in the right month pair
      rep.filled.push({ date: d, value: apiVal, newRow: !cell });
      rep.wrote++;
    }

    if (rep.wrote) { SpreadsheetApp.flush(); _invalidateCache(); }
  } catch (e) {
    rep.ok = false; rep.error = e.message;
  }
  _caloLogReport_(rep);
  return rep;
}

// Shows exactly what a run would change, and changes nothing.
function previewDeliverySync(days) {
  return syncDeliveriesToSheet({ dryRun: true, days: days || CALO_SYNC_DAYS });
}

// Lists only the days where the sheet and the API disagree. Writes nothing,
// whatever CALO_SYNC_OVERWRITE is set to.
function reconcileDeliveries(from, to) {
  var rep = syncDeliveriesToSheet({ dryRun: true, overwrite: true, from: from, to: to });
  Logger.log('\n──────── disagreements only ────────');
  Logger.log(rep.differs.length
    ? rep.differs.map(function(x){ return x.date + '   sheet ' + x.sheet + '   api ' + x.api
        + '   (' + (x.api - x.sheet > 0 ? '+' : '') + (x.api - x.sheet) + ')'; }).join('\n')
    : 'None — the sheet and the API agree on every day in range.');
  return rep.differs;
}

function _caloLogReport_(rep) {
  var L = [];
  L.push(rep.dryRun ? 'DRY RUN — nothing was written.' : 'SYNC — ' + rep.wrote + ' day(s) written.');
  L.push('Window: ' + rep.from + ' to ' + rep.to + (rep.overwrite ? '   (overwrite ON)' : ''));
  if (!rep.ok) L.push('FAILED: ' + rep.error);
  L.push('');
  L.push('filled      ' + rep.filled.length + (rep.filled.length
    ? '   ' + rep.filled.map(function(f){ return f.date + '=' + f.value + (f.newRow ? '*' : ''); }).join(', ') : ''));
  L.push('already set ' + rep.alreadySet.length + '   (left alone)');
  L.push('differs     ' + rep.differs.length + (rep.differs.length
    ? '   ' + rep.differs.map(function(x){ return x.date + ' sheet=' + x.sheet + ' api=' + x.api; }).join(', ') : ''));
  L.push('not in api  ' + rep.notInApi.length + (rep.notInApi.length ? '   ' + rep.notInApi.join(', ') : ''));
  if (rep.differs.length && !rep.overwrite) {
    L.push('');
    L.push('Days above under "differs" were NOT changed. Run reconcileDeliveries() to look at them,');
    L.push('or syncDeliveriesToSheet({overwrite:true}) to let the API figure win.');
  }
  L.push('* = a new row was added for that date');
  Logger.log(L.join('\n'));
}

// ── DAILY TRIGGER ───────────────────────────────────────────
function createDeliverySyncTrigger() {
  removeDeliverySyncTrigger();
  ScriptApp.newTrigger('syncDeliveriesToSheet').timeBased().atHour(2).everyDays(1).create();
  return { ok: true, note: 'Runs daily around 02:00, filling days that have closed.' };
}

function removeDeliverySyncTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncDeliveriesToSheet') { ScriptApp.deleteTrigger(t); n++; }
  });
  return { ok: true, removed: n };
}

// ── HELPERS ─────────────────────────────────────────────────
function _caloYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getFullYear() + '-' + _caloP2_(v.getMonth() + 1) + '-' + _caloP2_(v.getDate());
  }
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  var d = new Date(s);
  if (!isNaN(d.getTime()) && s) {
    return d.getFullYear() + '-' + _caloP2_(d.getMonth() + 1) + '-' + _caloP2_(d.getDate());
  }
  return '';
}

function _caloShift_(ymd, days) {
  var p = String(ymd).split('-');
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  d.setDate(d.getDate() + days);
  return _caloYmd_(d);
}

function _caloP2_(n)  { return String(n).length === 1 ? '0' + n : String(n); }
function _caloPad_(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }
