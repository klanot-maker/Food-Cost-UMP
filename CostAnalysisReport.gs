// ============================================================
// COST ANALYSIS REPORT — CostAnalysisReport.gs
// Posts a MoM cost/wastage summary to Slack.
// ============================================================
// Data lives in the "Summary" tab of SPREADSHEET_ID. Rows are looked up by
// their Column A label (not fixed row numbers) because rows get inserted/
// reordered over time — a hardcoded row index silently drifts to the wrong
// metric. Month columns are likewise detected from the header row instead
// of hardcoded, because the sheet interleaves an extra "year total" column
// after every December (e.g. col O = "2024" sits between Dec 24 and Jan 25),
// so a fixed column offset walks off the correct month within a year.
// ============================================================

// The Slack webhook is a secret and must never be committed to source
// control — set it once via Script Properties (Project Settings > Script
// Properties in the Apps Script editor, or run setSlackWebhookUrl() below
// from the script editor with the real URL filled in, then delete the URL
// from that function afterwards).
const SLACK_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
const SPREADSHEET_ID    = '1JvHBdSaeh6c2KIktDAOTub93jTOqs5znszzwKEdbe1o';
const SHEET_NAME        = 'Summary';

// Run this once from the Apps Script editor (with the real URL pasted in)
// to store the webhook in Script Properties, then remove the URL again.
function setSlackWebhookUrl() {
  PropertiesService.getScriptProperties().setProperty('SLACK_WEBHOOK_URL', 'PASTE_SLACK_WEBHOOK_URL_HERE');
}

// Column A labels for each metric we report. Matched case-insensitively
// against the FIRST row with that label, since the sheet repeats the same
// labels further down for Growth % and USD-equivalent blocks.
const METRIC_LABELS = {
  deliveries : 'Monthly Deliveries',
  dpd        : 'DPD',
  totalWaste : 'Total Wastage & Spoiled Items',
  ingredient : 'Ingredient Wastage',
  component  : 'Component Wastage',
  cancelled  : 'Cancelled Deliveries',
  extraMeal  : 'Extra Meal Wastage',
  cafe       : 'Cafe Wastage',
  kids       : 'Kids Wastage',
  undelivered: 'Undelivered Meals',
  custom     : 'Custom Meals Wastage',
  b2b        : 'B2B Wastage',
  marketplace: 'Marketplace Wastage',
  staffMeal  : 'Staff Meal Cost',
  cxUAE      : 'CX UAE Request Cost',
  rnd        : 'R&D Food Cost',
  marketing  : 'Marketing Food Cost',
  office     : 'Office Supplies',
  caloCafe   : 'Calo Cafe Food Cost',
  caloKids   : 'Calo Kids Food Cost',
  b2bFood    : 'B2B Food Cost',
  mktFood    : 'Marketplace Food Cost',
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================
function sendCostAnalysisReport() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  const all   = sheet.getDataRange().getValues();

  // ── Locate each metric's row by its Column A label (first match wins) ──
  const rowIndex = {};
  for (let r = 0; r < all.length; r++) {
    const label = String(all[r][0] || '').trim().toLowerCase();
    if (!label) continue;
    Object.keys(METRIC_LABELS).forEach(function (key) {
      if (rowIndex[key] === undefined && label === METRIC_LABELS[key].toLowerCase()) {
        rowIndex[key] = r;
      }
    });
  }
  const missing = Object.keys(METRIC_LABELS).filter(function (k) { return rowIndex[k] === undefined; });
  if (missing.length) {
    throw new Error('sendCostAnalysisReport: could not find rows for: ' + missing.join(', '));
  }

  // ── Locate real month columns in the header row ──
  // A valid month column holds a Date whose day-of-month is 1. This skips
  // both the yearly-total columns (plain numbers, e.g. "2024") and any
  // malformed date cells that aren't the 1st of a month.
  const header = all[0];
  const monthCols = []; // [{ col, year, month }] left-to-right, chronological
  for (let c = 1; c < header.length; c++) {
    const v = header[c];
    if (v instanceof Date && !isNaN(v.getTime()) && v.getDate() === 1) {
      monthCols.push({ col: c, year: v.getFullYear(), month: v.getMonth() });
    }
  }
  if (monthCols.length < 2) {
    throw new Error('sendCostAnalysisReport: fewer than 2 month columns found in header row.');
  }

  // ── Current month = latest month column with actual Monthly Deliveries data ──
  const deliveriesRow = all[rowIndex.deliveries];
  let curIdx = -1;
  for (let i = monthCols.length - 1; i >= 0; i--) {
    if (typeof deliveriesRow[monthCols[i].col] === 'number') { curIdx = i; break; }
  }
  if (curIdx < 1) {
    throw new Error('sendCostAnalysisReport: could not find a current month with data (need at least one prior month too).');
  }

  const curMonthCol  = monthCols[curIdx];
  const prevMonthCol = monthCols[curIdx - 1];

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(mc) { return MONTH_NAMES[mc.month] + ' ' + mc.year; }
  const curMonthName  = monthLabel(curMonthCol);
  const prevMonthName = monthLabel(prevMonthCol);

  function val(key, col) {
    const v = all[rowIndex[key]][col];
    return typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')) || 0;
  }

  function buildSnapshot(col) {
    const out = {};
    Object.keys(METRIC_LABELS).forEach(function (key) { out[key] = val(key, col); });
    return out;
  }

  const cur  = buildSnapshot(curMonthCol.col);
  const prev = buildSnapshot(prevMonthCol.col);

  const message = buildMessage(cur, prev, curMonthName, prevMonthName);
  postToSlack(message);
  Logger.log('Message sent successfully.');
}

// ============================================================
// MESSAGE BUILDER
// ============================================================
function buildMessage(cur, prev, curMonthName, prevMonthName) {

  function delta(current, previous) {
    if (previous === 0 && current === 0) return '─  0.0%';
    if (previous === 0) return '▲ New';
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    if (pct > 0.05)  return `▲ +${pct.toFixed(1)}%  _(increased)_`;
    if (pct < -0.05) return `▼ ${pct.toFixed(1)}%  _(decreased)_`;
    return '─  0.0%  _(no change)_';
  }

  function aed(v) {
    return 'AED ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function num(v) {
    return Number(v).toLocaleString('en-US');
  }

  function line(label, curVal, prevVal, formatter) {
    if (!curVal || curVal === 0) return null;
    return `• *${label}*   ${formatter(curVal)}   ${delta(curVal, prevVal)}`;
  }

  const wastageLines = [
    line('Total Wastage:',         cur.totalWaste,  prev.totalWaste,  aed),
    line('Ingredient Wastage:',    cur.ingredient,  prev.ingredient,  aed),
    line('Component Wastage:',     cur.component,   prev.component,   aed),
    line('Cancelled Deliveries:',  cur.cancelled,   prev.cancelled,   aed),
    line('Extra Meal Wastage:',    cur.extraMeal,   prev.extraMeal,   aed),
    line('Cafe Wastage:',          cur.cafe,        prev.cafe,        aed),
    line('Kids Wastage:',          cur.kids,        prev.kids,        aed),
    line('Undelivered Meals:',     cur.undelivered, prev.undelivered, aed),
    line('Custom Meals Wastage:',  cur.custom,      prev.custom,      aed),
    line('B2B Wastage:',           cur.b2b,         prev.b2b,         aed),
    line('Marketplace Wastage:',   cur.marketplace, prev.marketplace, aed),
  ].filter(l => l !== null);

  const otherCostLines = [
    line('Staff Meal Cost:',       cur.staffMeal,  prev.staffMeal,  aed),
    line('CX UAE Request Cost:',   cur.cxUAE,      prev.cxUAE,      aed),
    line('R&D Food Cost:',         cur.rnd,        prev.rnd,        aed),
    line('Marketing Food Cost:',   cur.marketing,  prev.marketing,  aed),
    line('Office Supplies:',       cur.office,     prev.office,     aed),
    line('Calo Cafe Food Cost:',   cur.caloCafe,   prev.caloCafe,   aed),
    line('Calo Kids Food Cost:',   cur.caloKids,   prev.caloKids,   aed),
    line('B2B Food Cost:',         cur.b2bFood,    prev.b2bFood,    aed),
    line('Marketplace Food Cost:', cur.mktFood,    prev.mktFood,    aed),
  ].filter(l => l !== null);

  const sections = [
    `🌅 *Good Morning!*`,
    ``,
    `📊 *${curMonthName} vs ${prevMonthName} — Cost Analysis Report*`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `♻️ *WASTAGE BREAKDOWN*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ...wastageLines,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 *OTHER FOOD COSTS*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ...otherCostLines,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🚚 *DELIVERIES — ${curMonthName}*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `• *Monthly Deliveries:*   ${num(cur.deliveries)}   ${delta(cur.deliveries, prev.deliveries)}`,
    `• *DPD:*                  ${num(cur.dpd)}   ${delta(cur.dpd, prev.dpd)}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `👨‍🍳 *For Your Review Chef* <@U03N1R6LA78> <@U03KWLL7KV5>`,
  ];

  return sections.join('\n');
}

// ============================================================
// SLACK POSTER
// ============================================================
function postToSlack(text) {
  if (!SLACK_WEBHOOK_URL) {
    throw new Error('SLACK_WEBHOOK_URL is not set. Run setSlackWebhookUrl() from the script editor first.');
  }

  const payload = JSON.stringify({
    text      : text,
    username  : 'Cost Analysis Bot',
    icon_emoji: ':bar_chart:',
  });

  const options = {
    method            : 'post',
    contentType       : 'application/json',
    payload           : payload,
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(SLACK_WEBHOOK_URL, options);
  Logger.log('Slack response: ' + response.getContentText());

  if (response.getResponseCode() !== 200) {
    throw new Error('Slack webhook failed: ' + response.getContentText());
  }
}

// ============================================================
// OPTIONAL: Daily trigger at 8:00 AM GST — run once to set up
// ============================================================
function createDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendCostAnalysisReport')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sendCostAnalysisReport')
    .timeBased()
    .everyDays(1)
    .atHour(4) // 4 AM UTC = 8 AM GST
    .create();

  Logger.log('Daily trigger created for 8:00 AM GST.');
}
