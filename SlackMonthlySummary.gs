// ============================================================
// SLACK MONTHLY SUMMARY — Financial Cost
// ============================================================
// Posts the month-on-month cost analysis to Slack, in the same
// layout the old script used.
//
// Run it by hand:   sendFinancialSlackSummary('2026-09')
// Last full month:  sendFinancialSlackSummary()
// See it first:     previewFinancialSlackSummary('2026-09')
//
// It reads the "Financial cost" sheet through getFinancialData(),
// the same function the dashboard uses, so the message and the
// Financial Cost page can never disagree.
//
// NOTE: this file must not declare SS_FINANCIAL, SS_COMPLAINTS or
// SS_STAFF. Dashboard.gs already defines them, and every .gs file in
// an Apps Script project shares one global scope — a second
// declaration is what caused "Identifier 'SS_FINANCIAL' has already
// been declared".
// ============================================================

// ── SETTINGS ────────────────────────────────────────────────
var SLACK_WEBHOOK_URL = '';   // ← paste the channel's Incoming Webhook URL
var SLACK_MENTIONS    = '@Kuldeep @Jaspal';
var SLACK_RULE        = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

// Rows that are zero in both months are left out, as they were before.
// Set this to true to list every row the sheet has.
var SLACK_SHOW_EMPTY  = false;

// ── BUILD AND SEND ──────────────────────────────────────────
function sendFinancialSlackSummary(ym) {
  var msg = buildFinancialSlackSummary(ym);
  if (!SLACK_WEBHOOK_URL) {
    throw new Error('SLACK_WEBHOOK_URL is empty — paste the channel webhook at the top of this file.');
  }
  var res = UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: msg }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) {
    throw new Error('Slack rejected the message (' + code + '): ' + res.getContentText());
  }
  return { ok: true, month: _slkLabelFor_(ym), characters: msg.length };
}

// Writes the message to the execution log without posting it, so it can be
// read over before anyone in the channel sees it.
function previewFinancialSlackSummary(ym) {
  var msg = buildFinancialSlackSummary(ym);
  Logger.log(msg);
  return msg;
}

// ── THE MESSAGE ─────────────────────────────────────────────
function buildFinancialSlackSummary(ym) {
  var fin = getFinancialData(SpreadsheetApp.openById(_slkFinancialSsId_()));
  if (!fin || fin.error) throw new Error('Could not read the Financial cost sheet: ' + ((fin && fin.error) || 'no data'));

  var months = fin.months || [];
  var cur = _slkLabelFor_(ym);
  if (months.indexOf(cur) < 0) {
    throw new Error('The Financial cost sheet has no column for ' + cur
      + '. It has: ' + months.join(', '));
  }
  var prev = months[months.indexOf(cur) - 1];
  if (!prev) throw new Error('No month before ' + cur + ' to compare against.');

  var L = [];
  L.push(':sunrise: Good Morning!');
  L.push('');
  L.push(':bar_chart: ' + cur + ' vs ' + prev + ' — Cost Analysis Report');
  L.push('');

  // ── wastage ──
  L.push(SLACK_RULE);
  L.push(':recycle: WASTAGE BREAKDOWN');
  L.push(SLACK_RULE);
  var wast = fin.wastage || [];
  var totCur = 0, totPrev = 0;
  wast.forEach(function(r) {
    totCur  += (r.vals && r.vals[cur])  || 0;
    totPrev += (r.vals && r.vals[prev]) || 0;
  });
  L.push(_slkMoneyLine_('Total Wastage', totCur, totPrev));
  wast.forEach(function(r) {
    var c = (r.vals && r.vals[cur]) || 0, p = (r.vals && r.vals[prev]) || 0;
    if (!SLACK_SHOW_EMPTY && !c && !p) return;
    L.push(_slkMoneyLine_(r.cat, c, p));
  });
  L.push('');

  // ── other food costs ──
  L.push(SLACK_RULE);
  L.push(':moneybag: OTHER FOOD COSTS');
  L.push(SLACK_RULE);
  (fin.other || []).forEach(function(r) {
    var c = (r.vals && r.vals[cur]) || 0, p = (r.vals && r.vals[prev]) || 0;
    if (!SLACK_SHOW_EMPTY && !c && !p) return;
    L.push(_slkMoneyLine_(r.cat, c, p));
  });
  L.push('');

  // ── deliveries ──
  // Labels padded so the two figures line up under each other.
  L.push(SLACK_RULE);
  L.push(':truck: DELIVERIES — ' + cur);
  L.push(SLACK_RULE);
  var kp = fin.kpis || {};
  var dC = (kp.deliveries || {})[cur] || 0, dP = (kp.deliveries || {})[prev] || 0;
  var pC = (kp.dpd || {})[cur] || 0,        pP = (kp.dpd || {})[prev] || 0;
  L.push(_slkPlainLine_('Monthly Deliveries', _slkNum_(dC, 0), dC, dP));
  L.push(_slkPlainLine_('DPD',                _slkNum_(pC, 3), pC, pP));
  L.push('');

  L.push(SLACK_RULE);
  L.push(':male-cook: For Your Review Chef ' + SLACK_MENTIONS);

  return L.join('\n');
}

// ── LINE BUILDERS ───────────────────────────────────────────
function _slkMoneyLine_(label, cur, prev) {
  return '• ' + label + ':   AED ' + _slkNum_(cur, 2) + '   ' + _slkDelta_(cur, prev);
}

function _slkPlainLine_(label, shown, cur, prev) {
  return '• ' + _slkPad_(label + ':', 19) + '   ' + shown + '   ' + _slkDelta_(cur, prev);
}

// ▲ rose, ▼ fell, ─ held. A figure with nothing before it reads "New" rather
// than as a percentage, because there is no percentage to take against zero.
function _slkDelta_(cur, prev) {
  if (!prev && cur) return '▲ New';
  if (!prev && !cur) return '─  0.0%  (no change)';
  var pct = Math.round(((cur - prev) / prev * 100) * 10) / 10;
  if (pct === 0)  return '─  0.0%  (no change)';
  if (pct > 0)    return '▲ +' + pct.toFixed(1) + '%  (increased)';
  return '▼ ' + pct.toFixed(1) + '%  (decreased)';
}

// ── HELPERS ─────────────────────────────────────────────────
function _slkNum_(n, dec) {
  n = Number(n) || 0;
  var neg = n < 0;
  var s = Math.abs(n).toFixed(dec);
  var parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + parts.join('.');
}

function _slkPad_(s, w) {
  s = String(s);
  while (s.length < w) s += ' ';
  return s;
}

// 'YYYY-MM' → 'Mon YYYY', matching the Financial cost column headers.
// With nothing passed it takes the last full month, which is what a run on
// the 1st wants.
function _slkLabelFor_(ym) {
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var y, m;
  if (ym) {
    var p = String(ym).split('-');
    y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1;
  } else {
    var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    y = d.getFullYear(); m = d.getMonth();
  }
  return M[m] + ' ' + y;
}

// Dashboard.gs defines SS_FINANCIAL for the whole project. The id only needs
// pasting below if this file is ever moved to a project of its own.
function _slkFinancialSsId_() {
  if (typeof SS_FINANCIAL !== 'undefined' && SS_FINANCIAL) return SS_FINANCIAL;
  var ownId = '';   // ← only for standalone use
  if (!ownId) throw new Error('No Financial spreadsheet id — this file expects Dashboard.gs in the same project.');
  return ownId;
}

// ── MONTHLY TRIGGER (optional) ──────────────────────────────
// Run once to have it post itself on the 1st of each month at 08:00.
function createMonthlySlackTrigger() {
  removeMonthlySlackTrigger();
  ScriptApp.newTrigger('sendFinancialSlackSummary')
    .timeBased().onMonthDay(1).atHour(8).create();
  return { ok: true };
}

function removeMonthlySlackTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendFinancialSlackSummary') { ScriptApp.deleteTrigger(t); n++; }
  });
  return { ok: true, removed: n };
}
