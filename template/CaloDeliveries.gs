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
// HOW FAR AHEAD IT LOOKS
// The window is whole weeks, Sunday to Saturday — last week, this week and
// next week. On Thursday 5 November that is 25 October through 14 November:
// last week re-checked, and every day from tomorrow to the end of next week.
//
// Forward days are counts, not estimates. The deliveries already exist —
// subscriptions renewed, meals chosen, addresses attached — they simply have
// not been driven anywhere yet, which is why the Calo dashboard can show
// 3,807 for tomorrow. The further out the day, the fewer exist so far, so the
// number climbs as the week fills. Re-reading it every morning is the point.
//
// A forecast must never erase a plan. A FUTURE day answering 0 has not been
// generated yet rather than been cancelled, so it is left alone and said so.
// A past day answering 0 is written, because there zero is a fact.
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
// Both sync calls take whole WEEKS, and both default to (1, 1) — last week,
// this week, next week. caloSyncDeliveries(0, 2) would be this week plus the
// two ahead. They used to take days, so a stale caloSyncDeliveries(7, 2) is
// refused rather than read as seven weeks.
//
// A month's dates can sit in any column — December is the twelfth pair, W
// and X — because each date is looked up where it actually is. A new YEAR
// is different: those rows do not exist until someone makes them, so the
// sync builds the block itself when the window first reaches it, copied
// from the year above so the colours and the date format match. To lay a
// year out early, run caloEnsureYear(2027).
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

// ── weeks run Sunday → Saturday ─────────────────────────────
// Calo's operating week starts on Sunday, so every window below is anchored
// to one. Dates stay as yyyy-mm-dd strings throughout: that sorts and
// compares correctly as plain text, which avoids a Date object quietly
// shifting a day across a timezone when nobody is watching.

var _CALO_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 0 = Sunday … 6 = Saturday. */
function _caloDow_(ymd) {
  var p = ymd.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
}

/** The Sunday that begins the week containing this date. */
function _caloWeekStart_(ymd) { return _caloShiftDays_(ymd, -_caloDow_(ymd)); }

/** The Saturday that ends the week containing this date. */
function _caloWeekEnd_(ymd) { return _caloShiftDays_(ymd, 6 - _caloDow_(ymd)); }


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
// FILL THIS IN BEFORE RUNNING caloFindFilter().
//
// Six days of delivery counts for YOUR kitchen, read off the Calo dashboard
// by eye. caloFindFilter() tries every plausible filter against them and
// keeps the one that reproduces all six exactly; with the wrong market's
// numbers here, nothing will match and it will report a failure it cannot
// explain.
//
// Use SETTLED days — yesterday and the five before it. A day still filling
// up keeps changing while the test runs, and will make a correct filter
// look wrong.
//
// Include a Friday and a Saturday if you can. They are the days that differ
// most from the rest of the week, so a filter that is quietly counting
// something extra shows up there first.
var CALO_TRUTH = {
  // 'yyyy-mm-dd': 0,
  // 'yyyy-mm-dd': 0,
  // 'yyyy-mm-dd': 0,
  // 'yyyy-mm-dd': 0,
  // 'yyyy-mm-dd': 0,
  // 'yyyy-mm-dd': 0
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

/**
 * Does the saved filter still describe OLD days? Writes nothing.
 *
 *   caloCheckHistory()        samples 8 settled days across the whole tab
 *   caloCheckHistory(20)      samples more
 *
 * WHY THIS IS NOT OBVIOUS
 * The filter is `status = [upcoming, paymentRequired]`, and "upcoming" is a
 * state a delivery is supposed to LEAVE once it has happened. It reproduces
 * the first week of November exactly, so the status evidently sticks around
 * for recent days — but whether it still holds for a day in 2022 is a
 * different question, and four years is plenty of time for a schema to have
 * been migrated underneath it.
 *
 * So this asks the API about days the sheet already knows the answer to. If
 * the figures come back matching, the filter describes history as well as it
 * describes this week. If they come back near zero, it does not, and no
 * backfill should go anywhere near the historical blocks.
 *
 * Either way the answer is read off, not assumed.
 */
function caloCheckHistory(sampleSize) {
  var want  = Math.max(2, Number(sampleSize) || 8);
  var extra = _caloExtraFilter_();
  if (!extra) throw new Error('Run caloFindFilter() first — there is no filter to check.');

  var idx   = _caloSheetIndex_();
  var today = _caloToday_();

  // Only settled days that the sheet has a real figure for: a blank or a
  // zero gives nothing to compare against.
  var settled = Object.keys(idx.cells).filter(function(ds) {
    return ds < today && idx.values[ds] > 0;
  }).sort();

  var out = [];
  function say(s) { out.push(s); }

  say('DOES THE FILTER DESCRIBE HISTORY?  (' + new Date() + ')');
  say('');
  if (!settled.length) {
    say('The tab holds no settled day with a count, so there is nothing to check.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  say('Kitchen: ' + _caloKitchen_() + '    Counting: ' + JSON.stringify(extra));
  say('History in the tab: ' + settled[0] + ' → ' + settled[settled.length - 1] +
      '   (' + settled.length + ' days with a figure)');
  say('');

  // An even spread across the whole range, so a verdict is not drawn from
  // one corner of it.
  var picks = [], seen = {};
  for (var i = 0; i < want; i++) {
    var ds = settled[Math.round(i * (settled.length - 1) / (want - 1))];
    if (!seen[ds]) { seen[ds] = true; picks.push(ds); }
  }

  say('   date         sheet     API      difference');
  var matched = 0, nearZero = 0, failed = 0;

  picks.forEach(function(ds) {
    var have = idx.values[ds];
    var c    = _caloCountFor_(ds, extra);
    if (!c.ok) {
      say('   ' + ds + '   ' + _caloPadLeft_(have, 7) + '   ' +
          _caloPadLeft_('err', 6) + '   ' + c.why.substring(0, 60));
      failed++;
      return;
    }
    var diff = c.count - have;
    var pct  = have ? Math.round(diff * 1000 / have) / 10 : 0;
    if (diff === 0) matched++;
    // "Near zero" means the API has essentially nothing for that day, which
    // is the signature of a status filter that no longer applies.
    if (c.count < have * 0.1) nearZero++;
    say('   ' + ds + '   ' + _caloPadLeft_(have, 7) + '   ' + _caloPadLeft_(c.count, 6) +
        '   ' + _caloPadLeft_((diff > 0 ? '+' : '') + diff, 7) +
        (have ? '  (' + (pct > 0 ? '+' : '') + pct + '%)' : ''));
  });

  say('');
  say(matched + ' of ' + picks.length + ' matched exactly.');
  say('');

  if (failed === picks.length) {
    say('Every call failed. This is about the API or the key, not about history —');
    say('run caloDiagnose().');
  } else if (matched === picks.length) {
    say('THE FILTER DESCRIBES HISTORY TOO.');
    say('A backfill would be safe as far as the numbers go. Whether it is worth');
    say('doing is a separate question — see the note above caloBackfillPlan().');
  } else if (nearZero >= picks.length - failed - 1) {
    say('THE FILTER DOES NOT DESCRIBE OLD DAYS.');
    say('The API has almost nothing for them, which is what it looks like when a');
    say('status a delivery is meant to leave has finally been left. Do not');
    say('backfill: it would replace years of good record with near-zeros.');
  } else {
    say('MIXED. The filter fits some days and not others, so there is probably a');
    say('date after which the data behaves one way and before which it behaves');
    say('another. Send me this log and I will find the boundary.');
  }

  var text = out.join('\n');
  Logger.log(text);
  return text;
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


// ── growing the tab into a new year ─────────────────────────
//
// The tab is a stack of year blocks: a green heading row, then thirty-one
// rows of dates, twelve month column-pairs wide. 2026's heading is on row
// 133 and its dates run 134 → 164; December lives in the twelfth pair, W
// and X. Because the index above goes looking for each date rather than
// working out where it ought to sit, which column a month occupies has
// never mattered — December reads exactly like January.
//
// The year boundary is different, because the row genuinely is not there.
// The forward week first crosses it on Sunday 20 December 2026: the week
// Dec 27 → Jan 2 is the first window containing a January date. Without a
// 2027 block every one of those days would be reported as "no row for this
// date" and skipped, and from January the sync would write nothing at all.
//
// So the sync builds the block itself. It is a straight copy of the
// previous year's — the green, the borders, the alignment and the
// mmm d, yy ddd  date format all come across as they are — and then the
// dates are rewritten for the new year and the counts left blank for the
// sync to fill.

var _CALO_MONTH_ROWS = 31;      // the longest month, so every block is 31 rows
var _CALO_BLOCK_COLS = 24;      // twelve months, a date and a count each

/** Days in a month. month is 0-based, as JavaScript counts them. */
function _caloDaysInMonth_(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** The last row holding anything at all. */
function _caloLastUsedRow_(all) {
  for (var r = all.length - 1; r >= 0; r--) {
    for (var c = 0; c < all[r].length; c++) {
      if (all[r][c] !== '' && all[r][c] !== null) return r + 1;
    }
  }
  return 0;
}

/** The newest year the tab has any date at all in. */
function _caloNewestYear_(idx) {
  var best = 0;
  for (var ds in idx.cells) {
    var y = Number(ds.substring(0, 4));
    if (y > best) best = y;
  }
  return best;
}

/** How wide a block is, measured rather than assumed. */
function _caloBlockWidth_(all, firstRow) {
  var last = 0;
  for (var r = firstRow - 1; r < firstRow - 1 + _CALO_MONTH_ROWS && r < all.length; r++) {
    var row = all[r] || [];
    for (var c = row.length - 1; c >= 0; c--) {
      if (row[c] !== '' && row[c] !== null) { if (c + 1 > last) last = c + 1; break; }
    }
  }
  if (last % 2) last++;                                   // a date always has its count
  return Math.max(2, Math.min(last, _CALO_BLOCK_COLS));
}

/** The one cell in a heading row that carries the text. */
function _caloTitleCol_(all, titleRow, width) {
  var row = all[titleRow - 1] || [];
  for (var c = 0; c < width; c++) {
    if (row[c] !== '' && row[c] !== null && row[c] !== undefined) return c + 1;
  }
  return 0;
}

/** Copies one year block to the bottom of the tab and re-dates it. */
function _caloAddYear_(idx, newYear, templateYear) {
  var sheet = idx.sheet;
  var jan1  = idx.cells[templateYear + '-01-01'];
  if (!jan1) {
    throw new Error('The ' + templateYear + ' block has no 1 January row, so there is no ' +
                    'complete year to copy the layout from. Nothing was changed.');
  }
  var tmplFirst = jan1.row;
  var tmplTitle = tmplFirst - 1;
  if (tmplTitle < 1) {
    throw new Error('The ' + templateYear + ' block starts on row 1, so it has no heading row ' +
                    'to copy. Nothing was changed.');
  }

  var all      = sheet.getDataRange().getValues();
  var width    = _caloBlockWidth_(all, tmplFirst);
  var lastUsed = _caloLastUsedRow_(all);

  var newTitle = lastUsed + 2;                  // one blank row between blocks, as above
  var newFirst = newTitle + 1;
  var needRows = newFirst + _CALO_MONTH_ROWS - 1;
  if (needRows > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needRows - sheet.getMaxRows());
  }
  if (width > sheet.getMaxColumns()) {
    throw new Error('The tab is only ' + sheet.getMaxColumns() + ' columns wide but a year ' +
                    'block needs ' + width + '. Nothing was changed.');
  }

  // 1. The look, taken whole from last year so nothing has to be described.
  sheet.getRange(tmplTitle, 1, _CALO_MONTH_ROWS + 1, width)
       .copyTo(sheet.getRange(newTitle, 1, _CALO_MONTH_ROWS + 1, width));

  // 2. The heading.
  var titleCol = _caloTitleCol_(all, tmplTitle, width);
  if (titleCol) sheet.getRange(newTitle, titleCol).setValue(newYear + ' DELIVERIES');

  // 3. The dates — and blank counts, because the copy brought last year's
  //    figures with it and those must not survive a single moment.
  var rows = [];
  for (var d = 1; d <= _CALO_MONTH_ROWS; d++) {
    var row = [];
    for (var m = 0; m * 2 < width; m++) {
      if (m < 12 && d <= _caloDaysInMonth_(newYear, m)) row.push(new Date(newYear, m, d), '');
      else                                              row.push('', '');
    }
    rows.push(row);
  }
  sheet.getRange(newFirst, 1, _CALO_MONTH_ROWS, width).setValues(rows);

  return newYear + ': heading row ' + newTitle + ', dates rows ' + newFirst + ' → ' +
         (newFirst + _CALO_MONTH_ROWS - 1) + ', copied from ' + templateYear;
}

/** Adds every year block needed to reach `year`, oldest first. */
function _caloGrowTo_(year) {
  var lines = [], guard = 0;
  while (guard++ < 12) {
    var idx = _caloSheetIndex_();
    if (idx.cells[year + '-01-01']) break;
    var newest = _caloNewestYear_(idx);
    if (!newest) {
      throw new Error('The DELIVERIES tab has no year block to copy from, so there is no ' +
                      'format to follow. Nothing was changed.');
    }
    if (year <= newest) {
      // Older than something already in the tab: a gap someone made, not a
      // year that has yet to arrive. Inventing rows in the middle of
      // someone else's history is not this function's business.
      lines.push(year + ' is older than the ' + newest + ' block already in the tab — ' +
                 'left alone. Add it by hand if it is really wanted.');
      break;
    }
    lines.push(_caloAddYear_(idx, newest + 1, newest));
  }
  return lines;
}

/**
 * Builds a year block by hand: caloEnsureYear(2027).
 *
 * The sync does this on its own when the window reaches a new year, so
 * this is only for doing it early — to see the block before January, or
 * to lay out several years at once.
 */
function caloEnsureYear(year) {
  var y = Number(year);
  if (!y || y < 2000 || y > 2100 || y !== Math.floor(y)) {
    throw new Error('caloEnsureYear needs a four-digit year, e.g. caloEnsureYear(2027).');
  }
  var idx = _caloSheetIndex_();
  if (idx.cells[y + '-01-01']) {
    var msg = y + ' is already in the DELIVERIES tab — nothing to do.';
    Logger.log(msg);
    return msg;
  }
  var out = ['GROWING THE DELIVERIES TAB  (' + new Date() + ')', ''].concat(_caloGrowTo_(y));
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Whatever year blocks this window needs but the tab has not got. */
function _caloGrowForWindow_(days, previewOnly) {
  var years = [], seen = {};
  days.forEach(function(ds) {
    var y = Number(ds.substring(0, 4));
    if (!seen[y]) { seen[y] = true; years.push(y); }
  });
  years.sort();

  var lines = [];
  years.forEach(function(y) {
    var idx = _caloSheetIndex_();
    if (idx.cells[y + '-01-01']) return;
    var newest = _caloNewestYear_(idx);
    if (y <= newest) return;                    // a gap, not a new year — see above
    if (previewOnly) {
      lines.push('The window reaches ' + y + ', which has no block yet. A sync would add ' +
                 'one, copied from ' + newest + '.');
      return;
    }
    // A tab that cannot be grown is a reason to say so, not a reason to
    // abandon the fifteen days that do have rows.
    try {
      lines = lines.concat(_caloGrowTo_(y));
    } catch (e) {
      lines.push('could not add ' + y + ': ' + e.message);
    }
  });
  return lines;
}


// ── 3 & 4. PREVIEW AND SYNC ─────────────────────────────────

/**
 * How many weeks either side may be asked for.
 *
 * Four is already two months end to end, which is far more than a delivery
 * count is ever re-read over. The limit exists to catch the old habit, not
 * to ration anything: this used to count DAYS, and caloSyncDeliveries(7, 2)
 * still reads as a perfectly reasonable call. Seven WEEKS back would be
 * forty-nine days of API calls rewriting a sheet nobody meant to touch, so
 * seven lands above the line and is refused with an explanation.
 */
var _CALO_MAX_WEEKS = 4;

/** Reads a weeks argument, or explains why it will not. */
function _caloWeeksArg_(v, dflt, name) {
  if (v === null || v === undefined || v === '') return dflt;
  var n = Number(v);
  if (isNaN(n) || n < 0) {
    throw new Error(name + ' must be a whole number of WEEKS, 0 or more. ' +
                    'caloSyncDeliveries() with no arguments is the normal call.');
  }
  if (n > _CALO_MAX_WEEKS) {
    throw new Error(name + ' is counted in WEEKS now, not days — ' + n + ' would be ' +
                    (n * 7) + ' days. Try ' + Math.max(1, Math.round(n / 7)) + '.');
  }
  return Math.floor(n);
}

/**
 * Every date in the window, Sunday-aligned at both ends.
 *
 * weeksBack 1, weeksForward 1 → the Sunday that began last week through the
 * Saturday that ends next week. Twenty-one days, always; the edges never
 * fall mid-week, whichever day the sync happens to run on.
 */
function _caloDayList_(weeksBack, weeksForward) {
  var today = _caloToday_();
  var from  = _caloWeekStart_(_caloShiftDays_(today, -7 * weeksBack));
  var to    = _caloWeekEnd_(_caloShiftDays_(today,   7 * weeksForward));
  var days = [], d = from, guard = 0;
  while (d <= to && guard++ < 400) {        // string compare: yyyy-mm-dd sorts
    days.push(d);
    d = _caloShiftDays_(d, 1);
  }
  return days;
}

/** Shows exactly what a sync would change. Writes nothing. */
function caloPreviewSync(weeksBack, weeksForward) { return _caloSync_(weeksBack, weeksForward, true); }

/** Writes the API's counts into the DELIVERIES tab. Touches no other tab. */
function caloSyncDeliveries(weeksBack, weeksForward) { return _caloSync_(weeksBack, weeksForward, false); }

function _caloSync_(weeksBack, weeksForward, previewOnly) {
  weeksBack    = _caloWeeksArg_(weeksBack,    1, 'weeksBack');
  weeksForward = _caloWeeksArg_(weeksForward, 1, 'weeksForward');
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

  var today = _caloToday_();
  var days  = _caloDayList_(weeksBack, weeksForward);

  // A window crossing New Year needs rows that nobody has typed yet. Build
  // them before going looking, or every January day reads as "no row for
  // this date" and the sync quietly stops working on the 1st.
  var grew = _caloGrowForWindow_(days, previewOnly);

  var idx   = _caloSheetIndex_();

  say('Kitchen: ' + _caloKitchen_() + '    Counting: ' + JSON.stringify(extra));
  say('Window:  ' + days[0] + ' (Sun) → ' + days[days.length - 1] + ' (Sat)   ' +
      days.length + ' days, ' + (weeksBack + weeksForward + 1) + ' whole weeks');
  say('Today:   ' + today + ' (' + _CALO_DOW[_caloDow_(today)] + ')   ' +
      'anything after this is a forecast and will be revised daily');
  if (grew.length) {
    say('');
    grew.forEach(function(line) { say('New year: ' + line); });
  }
  say('');
  say('      date            sheet now  API     action');

  var written = 0, skipped = 0, failed = 0, held = 0;
  var thisWeek = '';

  days.forEach(function(ds) {
    // A heading per week, so twenty-one rows read as three weeks rather than
    // as a wall. The tag says which side of today the week falls on.
    var wkStart = _caloWeekStart_(ds);
    if (wkStart !== thisWeek) {
      thisWeek = wkStart;
      var wkEnd = _caloWeekEnd_(ds);
      var tag   = (wkEnd   < today) ? 'last week — re-checked'
                : (wkStart > today) ? 'NEXT WEEK — forecast'
                :                     'this week';
      say('');
      say('   ── ' + wkStart + ' Sun → ' + wkEnd + ' Sat    ' + tag);
    }

    var isFuture = ds > today;
    var cell     = idx.cells[ds];
    var now      = idx.values.hasOwnProperty(ds) ? idx.values[ds] : null;

    function row(api, action) {
      say('      ' + _caloPadRight_(ds + ' ' + _CALO_DOW[_caloDow_(ds)], 16) +
          _caloPadRight_(now == null ? '(blank)' : now, 11) +
          _caloPadRight_(api, 8) + action);
    }

    if (!cell) { row('—', 'no row for this date in the tab'); skipped++; return; }

    var c = _caloCountFor_(ds, extra);
    if (!c.ok) { row('—', 'FAILED: ' + c.why); failed++; return; }

    // Zero is the one answer never written over something real.
    //
    // On a future day it means the deliveries have not been generated yet,
    // not that they were cancelled. On a past day it is almost certainly the
    // API having a bad moment: Calo delivers every day, so a settled day that
    // suddenly reads 0 is a glitch, and letting an unattended 06:00 job
    // replace 5,321 with 0 would take the day out of the dashboard entirely —
    // it drops any count of zero or less from the series.
    //
    // A real zero day can still be typed in by hand. A machine should not be
    // the thing that decides a day had no deliveries.
    if (c.count === 0) {
      if (isFuture) {
        row('0', 'not generated yet — left alone');
        held++;
        return;
      }
      if (now) {
        row('0', 'API says 0 but the sheet has ' + now + ' — left alone, check the dashboard');
        held++;
        return;
      }
      // Sheet blank or already 0: nothing of value to lose either way.
    }

    if (now === c.count) { row(c.count, 'already correct'); skipped++; return; }

    var note = isFuture ? ' (forecast)' : '';
    if (previewOnly) {
      row(c.count, 'would write' + note);
    } else {
      idx.sheet.getRange(cell.row, cell.col).setValue(c.count);
      row(c.count, 'written' + note);
      written++;
    }
  });

  say('');
  if (previewOnly) {
    say('Nothing was changed. Run caloSyncDeliveries() to apply this.');
  } else {
    say(written + ' written, ' + skipped + ' unchanged, ' + held +
        ' held back, ' + failed + ' failed.');
    // The dashboard keys its cache on the workbook's last-modified time, so
    // a write here is picked up on its own. No redeploy, no Refresh.
    if (written) say('The dashboard picks these up within about a minute.');
    if (held)    say(held + ' future day(s) had no deliveries generated yet, so whatever ' +
                     'was already in the sheet was left in place. They fill in as the ' +
                     'week approaches.');
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
 * Each run covers last week, this week and next week. Re-reading the past
 * matters because a day that was wrong — the API down, or deliveries still
 * settling when the run happened — is corrected on the next pass instead of
 * staying wrong for good. Re-reading the future matters more: next week's
 * numbers are only as complete as the orders placed so far, so every morning
 * revises them upwards until the day arrives and they stop moving.
 */
function caloInstallDailySync() {
  if (!_caloExtraFilter_()) {
    throw new Error('Settle which rows count as a delivery first — run ' +
                    'caloFindFilter(). An unattended job must not be the thing ' +
                    'that decides that question.');
  }
  caloRemoveDailySync();
  ScriptApp.newTrigger('caloDailySyncRun').timeBased().atHour(6).everyDays(1).create();
  var today = _caloToday_();
  var msg = 'Daily sync installed: caloDailySyncRun, about 06:00 ' +
            Session.getScriptTimeZone() + '. Each run covers ' +
            _caloWeekStart_(_caloShiftDays_(today, -7)) + ' Sun → ' +
            _caloWeekEnd_(_caloShiftDays_(today, 7)) + ' Sat — last week, this ' +
            'week and next week, re-read in full every morning.';
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
function caloDailySyncRun() { return caloSyncDeliveries(1, 1); }
