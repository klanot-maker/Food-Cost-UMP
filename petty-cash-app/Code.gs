// ============================================================
// PETTY CASH APP — Code.gs
// Web app: photo of a receipt -> Claude reads it -> row appended to the
// "W/H Petty Cash 2026" ledger. setupSheet() is run once by hand.
// ============================================================

const SPREADSHEET_ID = '1EU45PIpUF1YpsbALtPH-srKkMEzJOvtYrlr2Tx7Rl58';
const LEDGER_GID = 344147005; // 'Petty Cash' tab
const SUMMARY_NAME = 'Monthly Summary';
const RECEIPTS_FOLDER = 'Petty Cash Receipts 2026';
const FIRST_DATA_ROW = 3; // row 3 holds the opening balance
const PHOTO_COL = 9;      // column I
const DATE_FMT = 'dd-MMM-yy';
const MONEY_FMT = '#,##0.00';

const TYPES = ['Withdraw', 'Deposit'];
const CATEGORIES = [
  'Staff Meal & Refreshment',
  'Logistics & Transportation',
  'Cash Inflows / Replenishment',
  'Office Admin & Utilities',
  'Warehouse & Office Maintenance',
];

const CLAUDE_MODEL = 'claude-opus-5-5';
const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    receipt_number: { type: 'string' },
    invoice_date: { type: 'string' },
    total_amount: { type: 'number' },
  },
  required: ['receipt_number', 'invoice_date', 'total_amount'],
  additionalProperties: false,
};
const EXTRACT_PROMPT =
  'This is a photo of a receipt or tax invoice, usually from the UAE. Extract:\n' +
  '- receipt_number: the tax invoice, invoice, receipt or bill number exactly as printed, e.g. the value after ' +
  '"TAX INVOICE#", "Invoice No." or "Receipt No." ("" if none).\n' +
  '- invoice_date: the invoice date as YYYY-MM-DD ("" if none). UAE receipts print dates day-first; ' +
  'ignore stamp dates if a printed date exists.\n' +
  '- total_amount: the final total in AED including VAT, e.g. "TOTAL AMOUNT DUE" or "Total incl. VAT", ' +
  'not the amount before VAT (0 if not visible).';

// ── WEB APP ──────────────────────────────────────────────────

function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.types = TYPES;
  t.categories = CATEGORIES;
  t.today = Utilities.formatDate(new Date(), 'Asia/Dubai', DATE_FMT);
  return t.evaluate()
    .setTitle('PETTY CASH APP')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function extractInvoice(base64, mimeType) {
  const key = (PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '')
    .trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Project Settings > Script Properties.');
  if (key.indexOf('sk-ant-') !== 0) {
    throw new Error('ANTHROPIC_API_KEY does not look like an Anthropic key (should start with "sk-ant-"). ' +
      'Create one at console.anthropic.com > API Keys.');
  }

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: INVOICE_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: EXTRACT_PROMPT },
        ],
      }],
    }),
  });

  const raw = res.getContentText();
  if (res.getResponseCode() !== 200) {
    console.error(raw);
    throw new Error('Claude API error ' + res.getResponseCode() + ': ' + raw.slice(0, 300));
  }
  const msg = JSON.parse(raw);
  const text = msg.content.filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  if (msg.stop_reason !== 'end_turn' || !text) {
    console.error(raw);
    throw new Error('Receipt not read (stop_reason: ' + msg.stop_reason + '). Enter the details manually.');
  }
  return JSON.parse(text);
}

function saveEntry(entry) {
  const amount = Number(entry.amount);
  if (TYPES.indexOf(entry.type) < 0) throw new Error('Choose a Transaction Type.');
  if (CATEGORIES.indexOf(entry.category) < 0) throw new Error('Choose a Payment For category.');
  if (!(amount > 0) || !isFinite(amount)) throw new Error('Amount must be a positive number.');
  if (entry.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(entry.invoiceDate)) throw new Error('Invalid invoice date.');

  const photoUrl = entry.photo ? savePhoto_(entry.photo) : '';
  const signed = entry.type === 'Withdraw' ? -amount : amount;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ledger_();
    const row = nextRow_(sheet);
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);

    sheet.getRange(row, 1).setNumberFormat(DATE_FMT);
    sheet.getRange(row, 4).setNumberFormat('@'); // keeps "01-215598" from parsing as a date
    sheet.getRange(row, 5).setNumberFormat(DATE_FMT);
    sheet.getRange(row, 6, 1, 2).setNumberFormat(MONEY_FMT);
    // Date strings are parsed by Sheets, so the Dubai calendar date lands regardless of time zone.
    sheet.getRange(row, 1, 1, 7).setValues([[
      Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd'),
      entry.type,
      entry.category,
      String(entry.receipt || '').trim(),
      entry.invoiceDate || '',
      signed,
      balanceFormula_(row),
    ]]);
    if (photoUrl) {
      sheet.getRange(row, PHOTO_COL).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText('View receipt').setLinkUrl(photoUrl).build());
    }
    SpreadsheetApp.flush();
    return { row: row, balance: sheet.getRange(row, 7).getValue() };
  } finally {
    lock.releaseLock();
  }
}

// ── HELPERS ──────────────────────────────────────────────────

function ledger_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()
    .filter(function (s) { return s.getSheetId() === LEDGER_GID; })[0];
  if (!sheet) throw new Error('Petty Cash tab (gid ' + LEDGER_GID + ') not found.');
  return sheet;
}

function nextRow_(sheet) {
  const col = sheet.getRange(FIRST_DATA_ROW, 1, sheet.getMaxRows() - FIRST_DATA_ROW + 1, 1).getValues();
  let n = col.length;
  while (n > 0 && col[n - 1][0] === '') n--;
  return FIRST_DATA_ROW + n;
}

function balanceFormula_(row) {
  return '=SUM($F$' + FIRST_DATA_ROW + ':F' + row + ')';
}

function savePhoto_(photo) {
  const it = DriveApp.getFoldersByName(RECEIPTS_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(RECEIPTS_FOLDER);
  const name = Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd_HHmmss') + '_' + (photo.name || 'receipt.jpg');
  const blob = Utilities.newBlob(Utilities.base64Decode(photo.base64), photo.mimeType, name);
  return folder.createFile(blob).getUrl();
}

// ── ONE-TIME SETUP (run from the Apps Script editor) ─────────

function setupSheet() {
  const sheet = ledger_();
  sheet.getRange(2, 1, 1, 9).setValues([[
    'Entry Date', 'Transaction Type', 'Payment For', 'Receipt #', 'Invoice Date',
    'Amount (AED)', 'Balance (AED)', 'Collection Signature', 'Invoice Photo',
  ]]).setFontWeight('bold');

  if (sheet.getRange(FIRST_DATA_ROW, 1).isBlank()) {
    sheet.getRange(FIRST_DATA_ROW, 1, 1, 6).setValues([[
      Utilities.formatDate(new Date(), 'Asia/Dubai', 'yyyy-MM-dd'), '', 'Opening Bal.', '', '', 0]]);
  }

  const lastData = nextRow_(sheet) - 1;
  const formulas = [];
  for (let r = FIRST_DATA_ROW; r <= lastData; r++) formulas.push([balanceFormula_(r)]);
  sheet.getRange(FIRST_DATA_ROW, 7, formulas.length, 1).setFormulas(formulas);

  const tail = sheet.getMaxRows() - FIRST_DATA_ROW + 1;
  sheet.getRange(FIRST_DATA_ROW, 1, tail, 1).setNumberFormat(DATE_FMT);
  sheet.getRange(FIRST_DATA_ROW, 5, tail, 1).setNumberFormat(DATE_FMT);
  sheet.getRange(FIRST_DATA_ROW, 6, tail, 2).setNumberFormat(MONEY_FMT);

  // Dropdowns below the opening-balance row.
  const n = sheet.getMaxRows() - FIRST_DATA_ROW;
  sheet.getRange(FIRST_DATA_ROW + 1, 2, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TYPES, true).setAllowInvalid(false).build());
  sheet.getRange(FIRST_DATA_ROW + 1, 3, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(CATEGORIES, true).setAllowInvalid(false).build());

  buildSummary_(sheet);
  SpreadsheetApp.flush();
  Logger.log('Setup done. Balance: ' + sheet.getRange(lastData, 7).getValue());
}

function buildSummary_(ledger) {
  const ss = ledger.getParent();
  const L = "'" + ledger.getName().replace(/'/g, "''") + "'!";
  const A = L + '$A$3:$A', C = L + '$C$3:$C', F = L + '$F$3:$F';
  let s = ss.getSheetByName(SUMMARY_NAME);
  if (s) {
    if (s.getFilter()) s.getFilter().remove();
    s.getDataRange().clearDataValidations();
    s.clear();
  } else {
    s = ss.insertSheet(SUMMARY_NAME);
  }

  s.getRange('A1').setValue('W/H PETTY CASH — MONTHLY SUMMARY').setFontSize(14).setFontWeight('bold');
  s.getRange('A2:B2').setValues([['Current cash balance (AED)', '=SUM(' + F + ')']]);

  // Selected-month breakdown.
  const inMonth = A + ',">="&$B$4,' + A + ',"<="&EOMONTH($B$4,0)';
  s.getRange('A4:B4').setValues([['Select month ▼', '=MAX($A$18:$A)']]);
  s.getRange('B4').setNumberFormat('MMMM yyyy').setBackground('#fff2cc').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(s.getRange('A18:A'), true).build());
  s.getRange('A6:D6').setValues([['Payment For', 'Withdrawals (AED)', 'Deposits (AED)', 'Net (AED)']]);
  const body = CATEGORIES.map(function (c, i) {
    const r = 7 + i;
    return [c,
      '=-SUMIFS(' + F + ',' + C + ',$A' + r + ',' + inMonth + ',' + F + ',"<0")',
      '=SUMIFS(' + F + ',' + C + ',$A' + r + ',' + inMonth + ',' + F + ',">0")',
      '=C' + r + '-B' + r];
  });
  body.push(['Other / older entries', '=B13-SUM(B7:B11)', '=C13-SUM(C7:C11)', '=C12-B12']);
  body.push(['TOTAL',
    '=-SUMIFS(' + F + ',' + inMonth + ',' + F + ',"<0")',
    '=SUMIFS(' + F + ',' + inMonth + ',' + F + ',">0")',
    '=C13-B13']);
  s.getRange(7, 1, body.length, 4).setValues(body);

  // All-months table; filterable via the header row.
  s.getRange('A16').setValue('All months').setFontWeight('bold');
  const head = ['Month'].concat(CATEGORIES, ['Other / older entries', 'Total Withdrawals', 'Total Deposits', 'Closing Balance']);
  s.getRange(17, 1, 1, head.length).setValues([head]);
  const m = '$A18:$A', mEnd = 'EOMONTH(' + m + ',0)';
  const byMonth = A + ',">="&' + m + ',' + A + ',"<="&' + mEnd;
  const row18 = ['=SORT(UNIQUE(ARRAYFORMULA(FILTER(EOMONTH(' + A + ',-1)+1,ISNUMBER(' + A + ')))))'];
  CATEGORIES.forEach(function (_, i) {
    const h = s.getRange(17, 2 + i).getA1Notation().replace(/(\D+)/, '$1$');
    row18.push('=ARRAYFORMULA(IF(' + m + '="",,-SUMIFS(' + F + ',' + C + ',' + h + ',' + byMonth + ',' + F + ',"<0")))');
  });
  row18.push('=ARRAYFORMULA(IF(' + m + '="",,I18:I-(B18:B+C18:C+D18:D+E18:E+F18:F)))');
  row18.push('=ARRAYFORMULA(IF(' + m + '="",,-SUMIFS(' + F + ',' + byMonth + ',' + F + ',"<0")))');
  row18.push('=ARRAYFORMULA(IF(' + m + '="",,SUMIFS(' + F + ',' + byMonth + ',' + F + ',">0")))');
  row18.push('=ARRAYFORMULA(IF(' + m + '="",,SUMIFS(' + F + ',' + A + ',"<="&' + mEnd + ')))');
  s.getRange(18, 1, 1, row18.length).setFormulas([row18]);

  s.getRange('A18:A').setNumberFormat('MMM-yyyy');
  s.getRange('B2').setNumberFormat(MONEY_FMT);
  s.getRange('B7:D13').setNumberFormat(MONEY_FMT);
  s.getRange(18, 2, s.getMaxRows() - 17, head.length - 1).setNumberFormat(MONEY_FMT);
  [s.getRange('A6:D6'), s.getRange('A13:D13'), s.getRange(17, 1, 1, head.length)]
    .forEach(function (r) { r.setFontWeight('bold').setBackground('#d9ead3'); });
  s.getRange(17, 1, 1, head.length).setWrap(true);
  s.setColumnWidth(1, 230);
  s.setColumnWidths(2, head.length - 1, 120);
  s.getRange(17, 1, s.getMaxRows() - 16, head.length).createFilter();
}
