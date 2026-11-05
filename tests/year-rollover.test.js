// Reading dates in any column, and growing the tab into a new year.
//
// The clock is Sunday 2026-12-27 — the first week of the year whose
// forward edge lands in January. Window: Sun 2026-12-20 → Sat 2027-01-09.
// The tab holds 2026 and nothing after it, exactly as the live sheet does.
const fs  = require('fs');
const src = fs.readFileSync('/home/user/Food-Cost-UMP/CaloDeliveries.gs', 'utf8');

let ROWS = 200;                       // the tab grows when a block needs room
const COLS = 24;
const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
let rowsAdded = 0;

// 2026 block: heading on row 133 (col J), dates rows 134-164.
// Twelve month pairs; December is the twelfth, columns W/X (0-based 22/23).
grid[132][9] = '2026 DELIVERIES';
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
for (let m = 0; m < 12; m++) {
  for (let d = 1; d <= dim(2026, m); d++) {
    grid[133 + d - 1][m * 2]     = new Date(2026, m, d);
    grid[133 + d - 1][m * 2 + 1] = m === 11 ? '' : 100 * (m + 1) + d;   // Dec not filled yet
  }
}

const copies = [], setValuesCalls = [], written = [];
function makeRange(r, c, nr, nc) {
  const rg = {
    _r: r, _c: c, _nr: nr, _nc: nc,
    setValue(v) { grid[r - 1][c - 1] = v; written.push({ r, c, v }); },
    setValues(vals) {
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = vals[i][j];
      setValuesCalls.push({ r, c, nr, nc });
    },
    copyTo(dest) {
      copies.push({ from: { r, c, nr, nc }, to: { r: dest._r, c: dest._c, nr: dest._nr, nc: dest._nc } });
      const snap = [];
      for (let i = 0; i < nr; i++) snap.push(grid[r - 1 + i].slice(c - 1, c - 1 + nc));
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) grid[dest._r - 1 + i][dest._c - 1 + j] = snap[i][j];
    }
  };
  return rg;
}
const SHEET = {
  getDataRange: () => ({ getValues: () => grid }),
  getRange: (r, c, nr, nc) => makeRange(r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc),
  getMaxRows: () => ROWS,
  getMaxColumns: () => COLS,
  insertRowsAfter: (after, n) => {
    if (after !== ROWS) throw new Error('rows must be added at the bottom, not after ' + after);
    for (let i = 0; i < n; i++) grid.push(Array(COLS).fill(''));
    ROWS += n; rowsAdded += n;
  }
};

global.pad2 = n => (n < 10 ? '0' : '') + n;
global._dlvYmd_ = v => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  if (typeof v === 'number') return null;
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
};

global.SpreadsheetApp = { openById: () => ({ getName: () => 'W', getSheetByName: n => n === 'DELIVERIES' ? SHEET : null }) };
global.SS_COMPLAINTS_ = () => 'x';
global.CFG_KITCHEN_   = () => 'AE001';
const props = {
  CALO_API_KEY: 'k',
  CALO_QS_STYLE: 'brackets',
  CALO_DLV_FILTER: JSON.stringify({ skipped: false, status: ['upcoming', 'paymentRequired'] })
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => props[k] = v }) };
global.Session   = { getScriptTimeZone: () => 'Asia/Dubai' };
global.Logger    = { log: () => {} };
global.Utilities = { formatDate: () => '2026-12-27' };            // Sunday
global.ScriptApp = {
  newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => {} }) }) }) }),
  getProjectTriggers: () => []
};

// Every day in the window answers with a count; nothing is zero, so the
// hold-back rules stay out of the way and the window itself is what shows.
global.UrlFetchApp = { fetch: u => {
  const day = (decodeURIComponent(u).match(/filters\[day\]\[gte\]=(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!day) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ count: 60635664 }) };
  return { getResponseCode: () => 200,
           getContentText: () => JSON.stringify({ count: 4000 + Number(day.slice(8)), cost: [] }) };
}};

eval(src);

let pass = 0, fail = 0;
const t = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};
const ymd = v => global._dlvYmd_(v);

// ── a date is found wherever it sits ────────────────────────
// The user's question: December is in a different column from January.
{
  const idx = _caloSheetIndex_();
  t('January found (cols A/B)',    idx.cells['2026-01-15'], { row: 148, col: 2 });
  t('June found (cols K/L)',       idx.cells['2026-06-15'], { row: 148, col: 12 });
  t('December found (cols W/X)',   idx.cells['2026-12-15'], { row: 148, col: 24 });
  t('Dec 31 found on the last row', idx.cells['2026-12-31'], { row: 164, col: 24 });
  t('every day of 2026 indexed',   Object.keys(idx.cells).filter(d => d.startsWith('2026')).length, 365);
  t('Dec count reads as blank',    idx.values['2026-12-15'], null);
  t('Jun count reads through',     idx.values['2026-06-15'], 615);
  t('2027 is not there yet',       idx.cells['2027-01-01'] || null, null);
}

// ── the window crosses New Year ─────────────────────────────
const days = _caloDayList_(1, 1);
t('window starts Sun Dec 20',      days[0], '2026-12-20');
t('window ends Sat Jan 9',         days[days.length - 1], '2027-01-09');
t('window is 21 days',             days.length, 21);
t('it contains January days',      days.filter(d => d.startsWith('2027')).length, 9);

// ── preview builds nothing ──────────────────────────────────
{
  copies.length = 0; written.length = 0; setValuesCalls.length = 0;
  const prev = caloPreviewSync();
  t('preview copies no block',     copies.length, 0);
  t('preview writes nothing',      written.length + setValuesCalls.length, 0);
  t('preview says a block is due',  /The window reaches 2027, which has no block yet/.test(prev), true);
  t('and names what it copies from', /copied from 2026/.test(prev), true);
}

// ── the sync builds it ──────────────────────────────────────
copies.length = 0; written.length = 0; setValuesCalls.length = 0;
const log = _caloSync_(1, 1, false);

t('one block copied',              copies.length, 1);
t('copied from the 2026 heading',  copies[0].from, { r: 133, c: 1, nr: 32, nc: 24 });
t('placed after one blank row',    copies[0].to,   { r: 166, c: 1, nr: 32, nc: 24 });
t('row 165 left blank',            grid[164].filter(v => v !== '').length, 0);
t('heading says 2027',             grid[165][9], '2027 DELIVERIES');
t('heading in the same column',    grid[165].findIndex(v => v !== ''), 9);

t('Jan 1 2027 in cols A/B',        ymd(grid[166][0]),  '2027-01-01');
t('Jan 1 is a real Date',          grid[166][0] instanceof Date, true);
t('Feb 2027 in cols C/D',          ymd(grid[166][2]),  '2027-02-01');
t('Jun 2027 in cols K/L',          ymd(grid[166][10]), '2027-06-01');
t('Dec 2027 in cols W/X',          ymd(grid[166][22]), '2027-12-01');
t('Dec 31 2027 on the last row',   ymd(grid[196][22]), '2027-12-31');

t('Feb 2027 stops at the 28th',    ymd(grid[166 + 27][2]), '2027-02-28');
t('no Feb 29 in 2027',             grid[166 + 28][2], '');
t('no Feb 30 either',              grid[166 + 29][2], '');
t('April stops at the 30th',       ymd(grid[166 + 29][6]), '2027-04-30');
t('no April 31',                   grid[166 + 30][6], '');

// Last year's figures came across with the copy and had to go.
t('Jun 2027 count is blank',       grid[166 + 20][11], '');
t('no 2026 figure survived',       grid.slice(166, 197).every(r => r.every((v, i) =>
                                     i % 2 === 1 ? (v === '' || (typeof v === 'number' && v > 3000)) : true)), true);

// ── and then fills it ───────────────────────────────────────
{
  const idx = _caloSheetIndex_();
  t('Jan 1 2027 now indexed',      idx.cells['2027-01-01'], { row: 167, col: 2 });
  t('Jan 1 2027 synced',           idx.values['2027-01-01'], 4001);
  t('Jan 9 2027 synced',           idx.values['2027-01-09'], 4009);
  t('Jan 10 left blank',           idx.values['2027-01-10'], null);
  t('Dec 20 2026 synced',          idx.values['2026-12-20'], 4020);
  t('Dec 31 2026 synced',          idx.values['2026-12-31'], 4031);
  t('Dec 19 2026 untouched',       idx.values['2026-12-19'], null);
  t('June 2026 untouched',         idx.values['2026-06-15'], 615);
  t('every window day written',    days.filter(d => idx.values[d] !== null).length, 21);
}

t('the log reports the new year',  /New year: 2027: heading row 166, dates rows 167 → 197, copied from 2026/.test(log), true);
t('both years appear in the log',  /2026-12-20/.test(log) && /2027-01-09/.test(log), true);

// ── a leap year, built by hand, two years out ───────────────
{
  copies.length = 0;
  const r = caloEnsureYear(2029);
  t('2028 and 2029 both built',    copies.length, 2);
  const idx = _caloSheetIndex_();
  t('2028 block exists',           !!idx.cells['2028-01-01'], true);
  t('2029 block exists',           !!idx.cells['2029-01-01'], true);
  t('2028 has a Feb 29',           !!idx.cells['2028-02-29'], true);
  t('2029 has none',               !!idx.cells['2029-02-29'], false);
  t('2028 copied from 2027',       /2028: .* copied from 2027/.test(r), true);
  t('2029 copied from 2028',       /2029: .* copied from 2028/.test(r), true);
  t('2029 counts all blank',       Object.keys(idx.cells).filter(d => d.startsWith('2029'))
                                     .every(d => idx.values[d] === null), true);
  t('2026 history still intact',   idx.values['2026-06-15'], 615);
  t('the tab was grown to fit',    ROWS >= 263, true);
  t('rows added at the bottom only', rowsAdded > 0, true);
}

// ── asking again changes nothing ────────────────────────────
{
  copies.length = 0;
  const again = caloEnsureYear(2027);
  t('a year already there is left alone', copies.length, 0);
  t('and says so',                 /already in the DELIVERIES tab/.test(again), true);
}

// ── it will not invent a year inside the history ────────────
{
  copies.length = 0;
  const old = caloEnsureYear(2024);
  t('an older year is refused',    copies.length, 0);
  t('and explains why',            /older than the 2029 block/.test(old), true);
}

// ── a year is a year ────────────────────────────────────────
{
  let threw = '';
  try { caloEnsureYear(27); } catch (e) { threw = e.message; }
  t('a two-digit year is refused', /four-digit year/.test(threw), true);
  threw = '';
  try { caloEnsureYear('next'); } catch (e) { threw = e.message; }
  t('a word is refused',           /four-digit year/.test(threw), true);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
