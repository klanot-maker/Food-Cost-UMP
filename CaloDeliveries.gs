// ============================================================
// CALO DELIVERIES — fills the DELIVERIES tab from the Calo API
// ============================================================
// Source: @calo/dashboard-sdk  (GET /ext/v1/stats/deliveries)
//
//   Response:  { "count": 5321, "cost": [ { "currency": "AED", … } ] }
//              count = "Number of matching deliveries"
//
// WHY THE OLD SCRIPT NEVER WORKED
// The filter parameter is called `filters`, PLURAL, and both the day range
// and the kitchen go INSIDE it:
//
//     filters[day][gte] = 2026-11-05
//     filters[day][lte] = 2026-11-05
//     filters[kitchen]  = AE001
//
// The old code sent `filter` (singular) with kitchen at the top level. An
// unrecognised query parameter is ignored rather than refused, so the
// request matched EVERY delivery on record — about 60 million — and said
// so. It succeeded; it answered a different question.
//
// Because "wrong filter" looks exactly like "no filter", this file refuses
// to write any number above _CALO_SANE_MAX. A day returning millions is an
// ignored filter, not a very good day.
//
// WHAT COUNTS AS A DELIVERY
// Unfiltered, the endpoint counts every row for the day — including
// cancelled, skipped, paused and suspended ones. For UAE that runs about
// 400–580 a day above the figure the operation recognises. Which rows to
// include is therefore a decision, not a detail, and it lives in the
// CALO_DLV_FILTER property. Run caloFindFilter() to settle it against a
// number you trust; until then the sync refuses to run, because a delivery
// count that quietly includes cancellations is worse than no count at all.
//
// ── SETTINGS (Project Settings → Script Properties) ─────────
//   CALO_API_KEY      required. Sent as X-Api-Key. Needs kitchen:stats:read.
//   CALO_API_BASE     optional. Defaults to the gateway below.
//   CALO_QS_STYLE     written by caloDiagnose().      Leave alone.
//   CALO_DLV_FILTER   written by caloFindFilter(). Leave alone.
//
// The kitchen comes from Config.gs (CFG.kitchen), so a market that copies
// this dashboard gets its own without editing code.
//
// ── ORDER TO RUN THINGS ─────────────────────────────────────
//   1. caloDiagnose()                     key + encoding
//   2. caloFindFilter()                   which rows to count
//   3. caloPreviewSync()                  what would change. Writes nothing.
//   4. caloSyncDeliveries()               writes it
//   5. caloInstallDailySync()             every morning
//
// Nothing here touches any tab other than DELIVERIES.
// ============================================================

var _CALO_DEFAULT_BASE = 'https://0t42vvmg9i.execute-api.us-east-1.amazonaws.com';
var _CALO_PATH_DLV     = '/ext/v1/stats/deliveries';
var _CALO_PATH_MEAL    = '/ext/v1/stats/meal';

// A single kitchen's day. UAE runs about 5,500. Past this means the day
// filter did not apply and the figure is an all-time total.
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
                    '→ Add script property → CALO_API_KEY. The key needs the ' +
                    'kitchen:stats:read scope.');
  }
  return k;
}

function _caloKitchen_() {
  var k = (typeof CFG_KITCHEN_ === 'function') ? CFG_KITCHEN_() : '';
  if (!k) throw new Error('No kitchen code. Set CFG.kitchen in Config.gs (e.g. AE001).');
  return k;
}

/** The chosen "what counts as a delivery" filter, or null if not settled. */
function _caloExtraFilter_() {
  var raw = PropertiesService.getScriptProperties().getProperty('CALO_DLV_FILTER');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}


// ── dates ───────────────────────────────────────────────────

/** Local copy of the date reader, used only if Dashboard.gs is absent. */
function _caloYmd_(v) {
  if (typeof _dlvYmd_ === 'function') return _dlvYmd_(v);
  var p = function(n) { return (n < 10 ? '0' : '') + n; };
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getFullYear() + '-' + p(v.getMonth()+1) + '-' + p(v.getDate());
  }
  if (typeof v === 'number') return null;        // a serial is not a date here
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  var d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
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


// ── building the request ────────────────────────────────────

/**
 * Turns a filter object into filters[a][b]=v pairs.
 *
 * The gateway's own 400 — "expected object, received string at
 * queryStringParameters.filters" — is what tells us it wants brackets
 * rather than a JSON blob, so this is the shape it asked for.
 */
function _caloFilterQS_(obj, prefix) {
  var parts = [];
  Object.keys(obj).forEach(function(k) {
    var v   = obj[k];
    var key = prefix ? prefix + '[' + k + ']' : 'filters[' + k + ']';
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(function(item) {
        parts.push(encodeURIComponent(key + '[]') + '=' + encodeURIComponent(String(item)));
      });
    } else if (typeof v === 'object') {
      parts = parts.concat(_caloFilterQS_(v, key));
    } else {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
    }
  });
  return parts;
}

/** One day, one kitchen, plus whatever extra filter keys are passed. */
function _caloDlvUrl_(day, kitchen, extra) {
  var f = { day: { gte: day, lte: day }, kitchen: kitchen };
  if (extra) Object.keys(extra).forEach(function(k) { f[k] = extra[k]; });
  return _caloBase_() + _CALO_PATH_DLV + '?' + _caloFilterQS_(f).join('&');
}

/**
 * The same filter written four ways, for caloDiagnose only.
 * Once the gateway has told us which it accepts there is no reason to
 * keep guessing, so everything else uses _caloDlvUrl_.
 */
function _caloDlvUrls_(day, kitchen) {
  var base = _caloBase_() + _CALO_PATH_DLV;
  var e    = encodeURIComponent;
  var obj  = { day: { gte: day, lte: day }, kitchen: kitchen };
  return [
    { style: 'brackets', url: _caloDlvUrl_(day, kitchen, null) },
    { style: 'json',     url: base + '?filters=' + e(JSON.stringify(obj)) },
    { style: 'jsonDeep', url: base + '?filters%5Bday%5D=' + e(JSON.stringify(obj.day)) +
                                     '&filters%5Bkitchen%5D=' + e(kitchen) },
    { style: 'dots',     url: base + '?filters.day.gte=' + e(day) +
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

/** The count for one day, or a reason it cannot be trusted. */
function _caloCountFor_(day, extra, urlOverride) {
  var url = urlOverride || _caloDlvUrl_(day, _caloKitchen_(), extra);
  var r   = _caloGet_(url);
  if (r.code !== 200)                   return { ok: false, why: 'HTTP ' + r.code + ' — ' + r.text.substring(0, 160) };
  if (!r.json)                          return { ok: false, why: 'response was not JSON: ' + r.text.substring(0, 160) };
  if (typeof r.json.count !== 'number') return { ok: false, why: 'no "count" field in the response' };
  if (r.json.count > _CALO_SANE_MAX)    return { ok: false, why: 'count ' + r.json.count + ' is impossibly large for ' +
                                                                'one kitchen-day — the filter was ignored' };
  return { ok: true, count: r.json.count, cost: r.json.cost || [] };
}

function _caloPadRight_(s, w) {
  s = String(s);
  while (s.length < w) s += ' ';
  return s;
}


// ── 1. DIAGNOSE ─────────────────────────────────────────────

/** Proves the key works and finds the encoding the gateway accepts. */
function caloDiagnose() {
  var out = [], kitchen, day;
  function say(s) { out.push(s); }

  say('CALO DELIVERY API — diagnosis  (' + new Date() + ')');
  say('');

  try { kitchen = _caloKitchen_(); _caloKey_(); }
  catch (e) { say('STOP: ' + e.message); Logger.log(out.join('\n')); return out.join('\n'); }

  day = _caloShiftDays_(_caloToday_(), -1);   // a settled day is stable to test against
  say('Base:     ' + _caloBase_());
  say('Kitchen:  ' + kitchen);
  say('Test day: ' + day);
  say('');

  // The meal endpoint takes day and kitchen at the top level, so it is
  // unambiguous. If it answers, the key and its scope are fine and any
  // later failure is about the filter spelling, not authentication.
  say('── Step 1: is the key accepted? (meal endpoint, simple parameters)');
  var e = encodeURIComponent;
  var m = _caloGet_(_caloBase_() + _CALO_PATH_MEAL +
                    '?day%5Bgte%5D=' + e(day) + '&day%5Blte%5D=' + e(day) +
                    '&kitchen=' + e(kitchen));
  if (m.code === 200) {
    say('   OK    HTTP 200. The key works and has kitchen:stats:read.');
  } else if (m.code === 401 || m.code === 403) {
    say('   WRONG HTTP ' + m.code + '. ' + m.text.substring(0, 300));
    say('         The key is rejected, or lacks kitchen:stats:read. Ask the');
    say('         platform team on Slack. Nothing below will work until it does.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  } else {
    say('   note  HTTP ' + m.code + '. Carrying on to the delivery endpoint.');
  }
  say('');

  say('── Step 2: which encoding does filters[] accept?');
  var winner = null;
  _caloDlvUrls_(day, kitchen).forEach(function(cand) {
    var c = _caloCountFor_(day, null, cand.url);
    if (!c.ok) {
      var tag = /ignored/.test(c.why) ? '   NO    ' : '   no    ';
      say(tag + _caloPadRight_(cand.style, 9) + c.why);
      return;
    }
    say('   YES   ' + _caloPadRight_(cand.style, 9) + 'count ' + c.count + '  ← usable');
    if (!winner) winner = cand.style;
  });
  say('');

  if (!winner) {
    say('NONE of the four encodings returned a filtered count. Send this log to');
    say('the platform team and ask for one worked example of a query string for');
    say('GET ' + _CALO_PATH_DLV + '.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  PropertiesService.getScriptProperties().setProperty('CALO_QS_STYLE', winner);
  say('Encoding "' + winner + '" saved.');
  say('');
  say('NEXT: caloFindFilter() — unfiltered, this endpoint also counts');
  say('cancelled and skipped deliveries, so which rows belong in a column');
  say('headed DELIVERIES still has to be settled.');

  var text = out.join('\n');
  Logger.log(text);
  return text;
}


// ── 2. WHICH ROWS COUNT AS A DELIVERY ───────────────────────

/**
 * Candidate filters, in the order a result should be preferred.
 *
 * The SDK exposes four ways to narrow the set — deliveryStatus, status,
 * skipped and expired — and does not say which the dashboard uses. Rather
 * than pick one and hope, every plausible spelling is measured against a
 * number the operation already trusts.
 *
 * The bare measurements at the end are not candidates. They are there to
 * show how the day breaks down, so that if nothing matches exactly we can
 * see what the gap is made of instead of guessing again.
 */
var CALO_TRUTH = {
  '2026-11-01': 2130,
  '2026-11-02': 5570,
  '2026-11-03': 5625,
  '2026-11-04': 5602,
  '2026-11-05': 5321,
  '2026-11-06': 3807
};

/** 'AE001' → 'AE'. The dashboard sends country alongside kitchen. */
function _caloCountry_() {
  return String(_caloKitchen_()).substring(0, 2).toUpperCase();
}

/**
 * Candidates, best first.
 *
 * The first two mirror the Calo dashboard's own standard filter, read off
 * its Filters panel:
 *
 *     Country  AE          Skipped  False
 *     Kitchen  AE001       Status   Upcoming, Not Paid
 *
 * "Not Paid" is the SDK's `paymentRequired`. The important part is that
 * `status` carries TWO values — every earlier attempt passed one, which is
 * why none of them could ever have landed on the operation's figures. A
 * delivery awaiting payment is still a delivery the kitchen is making.
 *
 * Kitchen already implies the country, so it is tried both ways: a filter
 * the API does not recognise is ignored rather than refused, and an ignored
 * `country` would quietly widen the result.
 *
 * `measure: true` marks a row that is not an answer. Those run against one
 * day only, to size each group, so a near miss can be read off rather than
 * guessed at.
 */
function _caloStatusTries_() {
  var UP_NP = ['upcoming', 'paymentRequired'];
  return [
    { label: 'DASHBOARD skipped=false status=up+notPaid',
      f: { skipped: false, status: UP_NP } },
    { label: 'DASHBOARD + country',
      f: { country: _caloCountry_(), skipped: false, status: UP_NP } },

    // Same idea, in case "Not Paid" is spelled differently on the wire.
    { label: 'skipped=false status=upcoming,notPaid',
      f: { skipped: false, status: ['upcoming', 'notPaid'] } },
    { label: 'skipped=false status=upcoming,not_paid',
      f: { skipped: false, status: ['upcoming', 'not_paid'] } },
    { label: 'skipped=false status=upcoming,unpaid',
      f: { skipped: false, status: ['upcoming', 'unpaid'] } },

    // Each half alone, to show which part does the work.
    { label: 'status=upcoming+notPaid only',   f: { status: UP_NP } },
    { label: 'skipped=false status=upcoming',  f: { skipped: false, status: ['upcoming'] } },
    { label: 'skipped=false',                  f: { skipped: false } },
    { label: '(no filter)',                    f: {} },

    { label: 'subscriptionStatus=ongoing',     f: { subscriptionStatus: ['ongoing'] } },
    { label: 'deliveryStatus=delivered',       f: { deliveryStatus: 'delivered' } },

    // Sized against one day only.
    { label: '  measure status=cancelled',       f: { status: ['cancelled'] },       measure: true },
    { label: '  measure status=paused',          f: { status: ['paused'] },          measure: true },
    { label: '  measure status=suspended',       f: { status: ['suspended'] },       measure: true },
    { label: '  measure status=paymentRequired', f: { status: ['paymentRequired'] }, measure: true },
    { label: '  measure skipped=true',           f: { skipped: true },               measure: true }
  ];
}

/**
 * Finds the filter that reproduces the Calo dashboard, across every day in
 * CALO_TRUTH at once.
 *
 *   caloFindFilter()
 *
 * One day agreeing can be coincidence; six agreeing is the answer. Only a
 * filter that matches EVERY day is saved. Nothing is written to any sheet.
 */
function caloFindFilter() {
  var out = [];
  function say(s) { out.push(s); }

  var days = Object.keys(CALO_TRUTH).sort();
  if (!days.length) throw new Error('CALO_TRUTH is empty. Put the figures your ' +
                                    'Calo dashboard shows at the top of this file.');

  say('FINDING THE RIGHT FILTER  (' + new Date() + ')');
  say('');
  say('Kitchen: ' + _caloKitchen_());
  say('Checked against the Calo dashboard for ' + days.length + ' days:');
  days.forEach(function(d) { say('   ' + d + '  ' + CALO_TRUTH[d]); });
  say('');
  say('   filter                           match   difference per day (' +
      days.map(function(d) { return d.substring(8); }).join(' ') + ')');

  var best = null, bestScore = -1;

  _caloStatusTries_().forEach(function(t) {
    if (t.measure) return;                     // sized separately, below
    var hits = 0, cells = [], anyFail = false;
    days.forEach(function(d) {
      var c = _caloCountFor_(d, t.f);
      if (!c.ok) { cells.push('  err'); anyFail = true; return; }
      var diff = c.count - CALO_TRUTH[d];
      if (diff === 0) hits++;
      cells.push(_caloPadLeft_(diff === 0 ? '0' : (diff > 0 ? '+' : '') + diff, 5));
    });
    var mark = (hits === days.length) ? '  <<< MATCHES EVERY DAY' : '';
    say('   ' + _caloPadRight_(t.label, 33) + _caloPadRight_(hits + '/' + days.length, 8) +
        cells.join(' ') + mark);
    if (!anyFail && hits > bestScore) { bestScore = hits; best = t; }
  });

  say('');

  // ── size each group we might need to drop ──────────────────
  // Run on one settled day only; the point is proportion, not a series.
  var probe = days[days.length - 1];
  var base  = _caloCountFor_(probe, {});
  say('── how ' + probe + ' breaks down  (unfiltered ' +
      (base.ok ? base.count : '?') + ', dashboard ' + CALO_TRUTH[probe] + ', so ' +
      (base.ok ? (base.count - CALO_TRUTH[probe]) + ' rows must come out' : 'unknown') + ')');
  _caloStatusTries_().forEach(function(t) {
    if (!t.measure) return;
    var c = _caloCountFor_(probe, t.f);
    say('   ' + _caloPadRight_(t.label.replace(/^\s+measure\s+/, ''), 24) +
        (c.ok ? c.count : 'err — ' + c.why.substring(0, 60)));
  });
  say('');

  if (best && bestScore === days.length) {
    PropertiesService.getScriptProperties()
      .setProperty('CALO_DLV_FILTER', JSON.stringify(best.f));
    say('SAVED: ' + best.label + '   ' + JSON.stringify(best.f));
    say('Every sync from now on counts deliveries that way.');
    say('');
    say('NEXT: caloPreviewSync()   then   caloSyncDeliveries()');
  } else {
    say('NOTHING MATCHED ALL ' + days.length + ' DAYS — nothing has been saved,');
    say('and the sync stays blocked.');
    if (best) say('Closest was "' + best.label + '" at ' + bestScore + '/' + days.length + '.');
    say('');
    say('Send me this log. The breakdown above says how many rows each group');
    say('holds, so the right combination can be worked out from it rather than');
    say('guessed at a third time.');
  }

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

function _caloPadLeft_(s, w) {
  s = String(s);
  while (s.length < w) s = ' ' + s;
  return s;
}

/** Sets the filter by hand, if we work it out from the measurements. */
function caloSetFilter(jsonText) {
  var obj;
  try { obj = JSON.parse(jsonText); }
  catch (e) { throw new Error('That is not valid JSON. Example: {"deliveryStatus":"delivered"}'); }
  PropertiesService.getScriptProperties().setProperty('CALO_DLV_FILTER', JSON.stringify(obj));
  var msg = 'Filter set to ' + JSON.stringify(obj) + '. Run caloPreviewSync() next.';
  Logger.log(msg);
  return msg;
}


// ── the DELIVERIES tab ──────────────────────────────────────

/**
 * Maps every date in the DELIVERIES tab to the cell holding its count.
 *
 * The tab stacks a block per year down the sheet, each twelve month
 * column-pairs wide: an even column holds a date, the next its count.
 * Rather than compute where a date OUGHT to sit — which breaks the first
 * time someone inserts a row — the sheet is read and the date found where
 * it actually is.
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
      if (!ds || cells[ds]) continue;             // first occurrence wins
      cells[ds] = { row: r + 1, col: c + 2 };     // 1-based; count is the next column
      var n = Number(row[c + 1]);
      values[ds] = (row[c + 1] === '' || row[c + 1] === null || isNaN(n)) ? null : n;
    }
  }
  return { sheet: sheet, cells: cells, values: values };
}


// ── 3 & 4. PREVIEW AND SYNC ─────────────────────────────────

/** Shows exactly what a sync would change. Writes nothing. */
function caloPreviewSync(daysBack, daysForward) { return _caloSync_(daysBack, daysForward, true); }

/** Writes the API's counts into the DELIVERIES tab. Touches no other tab. */
function caloSyncDeliveries(daysBack, daysForward) { return _caloSync_(daysBack, daysForward, false); }

function _caloSync_(daysBack, daysForward, previewOnly) {
  daysBack    = (daysBack    === 0 || daysBack)    ? Number(daysBack)    : 7;
  // Two days ahead by default, matching Today's DPD and Tomorrow's DPD on
  // the Calo dashboard. Those days are not guesswork: the deliveries exist
  // and are counted, they simply have not been dispatched yet.
  daysForward = (daysForward === 0 || daysForward) ? Number(daysForward) : 2;
  var props = PropertiesService.getScriptProperties();
  var style = props.getProperty('CALO_QS_STYLE');
  var extra = _caloExtraFilter_();
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
  if (!extra) {
    // Refusing is the point. Unfiltered, this endpoint counts cancelled and
    // skipped rows too, and that number also divides into every
    // per-delivery cost figure on the Financial page. Writing it because
    // nobody chose otherwise would be the quietest kind of wrong.
    say('STOP: it has not been settled which rows count as a delivery.');
    say('');
    say('      Unfiltered, this endpoint also counts cancelled, skipped,');
    say('      paused and suspended deliveries — about 300–500 a day for UAE.');
    say('');
    say('      Run:  caloFindFilter()');
    say('      It tests every filter against the figures in CALO_TRUTH.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  var idx   = _caloSheetIndex_();
  var today = _caloToday_();

  say('Kitchen: ' + _caloKitchen_() + '    Counting: ' + JSON.stringify(extra));
  say('');
  say('   date         sheet now      API    action');

  var written = 0, skipped = 0, failed = 0;

  // Backwards from today, then forward by daysForward. The forward days
  // replace the DPD board figures that were typed in by hand, which is the
  // point: the API reports the same deliveries the board does, without
  // anyone retyping them.
  for (var i = daysBack; i >= -daysForward; i--) {
    var ds   = _caloShiftDays_(today, -i);
    var cell = idx.cells[ds];
    var now  = idx.values.hasOwnProperty(ds) ? idx.values[ds] : null;

    if (!cell) {
      say('   ' + ds + '   ' + _caloPadRight_('—', 14) + _caloPadRight_('—', 8) +
          'no row for this date in the tab');
      skipped++;
      continue;
    }

    var c = _caloCountFor_(ds, extra);
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
    // The dashboard keys its cache on the workbook's last-modified time, so
    // a write here is picked up on its own. No redeploy, no Refresh.
    if (written) say('The dashboard picks these up within about a minute.');
    if (failed)  say('Some days failed. Run caloDiagnose() — the API may have changed, ' +
                     'or the key may have lost its scope.');
  }

  var text = out.join('\n');
  Logger.log(text);
  return text;
}


// ── 5. THE DAILY TRIGGER ────────────────────────────────────

/**
 * Runs the sync every morning at 06:00 in the script's timezone.
 *
 * It re-syncs the whole of the last week rather than just yesterday, so a
 * day that was wrong — the API down, or deliveries settling after the run —
 * is corrected on the next pass instead of staying wrong for good.
 */
function caloInstallDailySync() {
  if (!_caloExtraFilter_()) {
    throw new Error('Settle which rows count as a delivery first — run ' +
                    'caloFindFilter(). An unattended job must not be the thing ' +
                    'that decides that question.');
  }
  caloRemoveDailySync();
  ScriptApp.newTrigger('caloDailySyncRun').timeBased().atHour(6).everyDays(1).create();
  var msg = 'Daily sync installed: caloDailySyncRun, about 06:00 ' +
            Session.getScriptTimeZone() + ', re-checking the last 7 days and the next 2 each run.';
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
 * straight from a trigger would read that event as daysBack.
 */
function caloDailySyncRun() { return caloSyncDeliveries(7, 2); }
