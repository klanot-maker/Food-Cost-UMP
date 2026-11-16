// Outsourced manpower: reading the agency Attendance tabs, and projecting a
// month that is only partly logged.
//
// Two pieces of real code are pulled in rather than copied: the server block
// from Dashboard.gs and the projection from Index.html. If either changes,
// these run against the change.
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
              (ok ? '' : '\n          got  ' + JSON.stringify(got) +
                         '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};
const near = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= (tol === undefined ? 0.005 : tol);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
              (ok ? '' : '\n          got  ' + got + '\n          want ~' + want));
  ok ? pass++ : fail++;
};

function slice(file, start, end) {
  const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const i = s.indexOf(start);
  if (i < 0) throw new Error('not found in ' + file + ': ' + start);
  const j = s.indexOf(end, i);
  if (j < 0) throw new Error('end marker not found in ' + file + ': ' + end);
  return s.slice(i, j);
}

// ── stubs ───────────────────────────────────────────────────
let SHEETS = {};                       // id -> {tabName: rows}
let COLS_READ = 0;                     // how wide the last read was
global.SpreadsheetApp = {
  openById: id => {
    if (!SHEETS[id]) throw new Error('no such workbook: ' + id);
    return { getSheetByName: n => {
      const rows = SHEETS[id][n];
      if (!rows) return null;
      const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
      return {
        getLastRow: () => rows.length,
        getLastColumn: () => width,
        getRange: (r, c, nr, nc) => ({
          getValues: () => {
            COLS_READ = nc;
            return rows.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc));
          }
        })
      };
    }};
  }
};

// Both of these are Apps Script service calls. Used once per shift they put
// about 11,000 round trips into a single load, which is what left the page on
// "Loading manpower data…" for ever. They are rigged to throw so the reader
// can never quietly start calling them again.
global.Session = { getScriptTimeZone: () => {
  throw new Error('getScriptTimeZone is a service call — do not use it per row');
}};
global.Utilities = { formatDate: () => {
  throw new Error('formatDate is a service call — do not use it per row');
}};
let CACHE = {};
global._srcKey_   = (b, ids) => b + '|' + ids.join(',');
global._cacheGet_ = k => CACHE[k] || null;
global._cachePut_ = (k, o) => { CACHE[k] = o; };
let KID = '', DID = '';
global.SS_MP_KITCHEN_  = () => KID;
global.SS_MP_DISPATCH_ = () => DID;
global._CACHE_MP = 'ump_manpower_v1';

eval(slice('Dashboard.gs',
  '// 0-based, matching the Attendance header row',
  '// ── Phase 4: Operation Overview'));

eval(slice('Index.html', 'function _mpWeekday_(ds){', 'function _mpAreaLbl('));

// ── dates, as the sheets really hand them over ──────────────
t('a real Date becomes an ISO day', _mpDateStr_(new Date(2026, 10, 7)), '2026-11-07');
t('the sheet\'s own "01-Oct-2026" text', _mpDateStr_('01-Oct-2026'), '2026-10-01');
t('a full month name still parses', _mpDateStr_('09-December-2026'), '2026-12-09');
t('a single-digit day', _mpDateStr_('3-Feb-2027'), '2027-02-03');
t('slashes instead of dashes', _mpDateStr_('15/Jul/2026'), '2026-07-15');
t('an ISO string passes through', _mpDateStr_('2026-11-07'), '2026-11-07');
t('a blank cell yields nothing', _mpDateStr_(''), '');
t('an unparseable month yields nothing', _mpDateStr_('01-Xxx-2026'), '');
t('a stray label yields nothing', _mpDateStr_('Total'), '');

t('a plain number', _mpNum_(11.89), 11.89);
t('text with a thousands separator', _mpNum_('1,234.56'), 1234.56);
t('an empty cell is zero, not NaN', _mpNum_(''), 0);
t('text that is not a number is zero', _mpNum_('n/a'), 0);

// ── reading a workbook ──────────────────────────────────────
const HDR = ['Shift Date','Employee ID','Full Name','Company','Punch In','Punch Out',
             'Hours','OT','Short','Rate','Cost','Status','Role','Flags','Notes',
             'Record ID','Last Updated'];
const shift = (date, emp, company, hours, ot, cost, status) =>
  [date, emp, 'Name ' + emp, company, '', '', hours, ot, 0, 11, cost, status,
   '', '', '', '', ''];

SHEETS = { K: { Attendance: [HDR,
  shift('01-Nov-2026', 'S-1', 'SMS',   8,   0, 88,  'COMPLETE'),
  shift('01-Nov-2026', 'S-2', 'SMS',   9,   1, 99,  'COMPLETE'),
  shift('01-Nov-2026', 'S-1', 'SMS',   4,   0, 44,  'COMPLETE'),   // double shift
  shift('01-Nov-2026', 'A-1', 'Align', 10,  2, 120, 'MISSING OUT'),
  shift('02-Nov-2026', 'S-1', 'SMS',   8,   0, 88,  'COMPLETE'),
  ['',     'ignored', 'x', 'SMS', '', '', 5, 0, 0, 11, 55, 'COMPLETE','','','','',''],
  shift('03-Nov-2026', 'S-9', '',      8,   0, 88,  'COMPLETE'),   // no company
]}};
KID = 'K'; DID = '';
const book = _mpReadBook_('K', 'kitchen');

t('one row per day per company', book.rows.map(r => r.ds + ' ' + r.company),
  ['2026-11-01 Align', '2026-11-01 SMS', '2026-11-02 SMS']);

const sms1 = book.rows.find(r => r.ds === '2026-11-01' && r.company === 'SMS');
t('a double shift is one head, two shifts',
  { staff: sms1.staff, shifts: sms1.shifts }, { staff: 2, shifts: 3 });
near('hours add up', sms1.hours, 21);
near('overtime adds up', sms1.ot, 1);
near('cost adds up', sms1.cost, 231);
t('a closed day needs no attention', sms1.attention, 0);

const align1 = book.rows.find(r => r.company === 'Align');
t('an unclosed punch is flagged', align1.attention, 1);

t('suppliers come from the data, not a fixed list', book.companies, ['Align', 'SMS']);
// The stubs above throw if either service is touched, so getting this far at
// all is the assertion. The width check keeps the read off the five columns
// after Status, which nothing here looks at.
t('a whole workbook is read without one service call', book.rows.length > 0, true);
t('and only as far as the Status column', COLS_READ, 12);
t('a row with no date is skipped', book.rows.every(r => r.ds), true);
t('a row with no company is skipped',
  book.rows.some(r => r.ds === '2026-11-03'), false);

// ── the Settings tab's current rates ────────────────────────
SHEETS.R = { Attendance: [HDR, shift('01-Nov-2026','S-1','SMS',8,0,88,'COMPLETE')],
  // Rows 1–10 are other settings; "Companies" sits on row 11, its header on
  // row 12, and the first agency on row 13, as in the real workbook.
  Settings: Array(10).fill(['']).concat([
    ['Companies','',''],
    ['Company Name','ID Prefix','Active','Hourly Rate (AED)','Rate — Male','Rate — Female'],
    ['SMS',         'SMS','Yes','10.50','11.00','12.00'],
    ['Align',       'ALN','Yes','10.16','',''],
    ['Star Service','STR','No', '7.93', '',''],
    ['',            '',   '',   '',     '',''],
  ])};
const rates = _mpReadBook_('R', 'kitchen').rates;

// The sheet says so itself: filling in Male and Female "makes Hourly Rate
// unused for that company". SMS's cell still reads 10.50 while it actually
// charges 11.00 and 12.00, so carrying the flat figure through would be wrong.
t('a company charging by gender reports no flat rate', rates.SMS.rate, 0);
t('and reports both of its real ones',
  [rates.SMS.rateM, rates.SMS.rateF], [11, 12]);
t('a company on one rate reports it', rates.Align.rate, 10.16);
t('and has no gender rates', [rates.Align.rateM, rates.Align.rateF], [0, 0]);
t('Active yes/no is carried through',
  [rates.SMS.active, rates['Star Service'].active], [true, false]);
t('blank rows are skipped', Object.keys(rates).sort(),
  ['Align', 'SMS', 'Star Service']);
t('a workbook with no Settings tab is not an error',
  _mpReadBook_('K', 'kitchen').rates, {});

t('a workbook that will not open reports why, rather than throwing',
  (_mpReadBook_('NOPE', 'kitchen').error || '').indexOf('cannot open') >= 0, true);
SHEETS.E = { Other: [] };
t('a workbook with no Attendance tab says so',
  (_mpReadBook_('E', 'dispatch').error || '').indexOf('no tab called "Attendance"') >= 0, true);
t('an unconfigured id is not an error', _mpReadBook_('', 'kitchen').skipped, 'not configured');

// ── getManpowerData ─────────────────────────────────────────
// Config.gs and Dashboard.gs are pasted as separate files and can end up out
// of step — which is exactly what happened: the new Dashboard.gs went in
// without the Config.gs that defines these, and the page reported
// "ReferenceError: SS_MP_KITCHEN_ is not defined". Name the file instead.
{
  const k = global.SS_MP_KITCHEN_, d = global.SS_MP_DISPATCH_;
  delete global.SS_MP_KITCHEN_;
  const stale = getManpowerData(true);
  t('an out-of-date Config.gs is named, not a missing symbol',
    /Config\.gs is older than Dashboard\.gs/.test(stale.error || ''), true);
  t('and nothing is reported as loaded', [stale.kitchen, stale.dispatch], [null, null]);
  global.SS_MP_KITCHEN_ = k; global.SS_MP_DISPATCH_ = d;
}

KID = ''; DID = '';
t('neither book configured reports configured:false', getManpowerData(true).configured, false);
KID = 'K'; DID = '';
const got = getManpowerData(true);
t('one book configured still works', [got.configured, !!got.kitchen, got.dispatch],
  [true, true, null]);

// ── the projection ──────────────────────────────────────────
// November 2026 opens on a Sunday, so the weekday pattern is unambiguous.
t('1 Nov 2026 really is a Sunday', _mpWeekday_('2026-11-01'), 0);

t('nothing logged projects nothing',
  _mpProject_({}, '2026-11', 30),
  { total: 0, actual: 0, projectedDays: 0, days: 0, basis: 'nothing logged yet' });

// A week in: weekdays busy, Fri/Sat quiet — the real shape of agency cover.
const week = {'2026-11-01':100,'2026-11-02':200,'2026-11-03':200,'2026-11-04':200,
              '2026-11-05':200,'2026-11-06':50, '2026-11-07':50};
const wk = _mpProject_(week, '2026-11', 30);
// 1000 logged. Remaining 23 days: 4 Sun, 4 Mon, 3 each Tue–Sat.
// 1000 + 4(100) + 4(200) + 3(200+200+200) + 3(50) + 3(50) = 4300
near('each remaining day is costed at its own weekday', wk.total, 4300);
t('the days still to come are counted', wk.projectedDays, 23);
near('what is already logged is kept exactly', wk.actual, 1000);
t('the basis is stated', wk.basis, '7 days logged · 23 projected by weekday');

// Worth being honest about: once a whole week has been sampled the two
// methods very nearly agree, because the sample is balanced. 1000/7*30 is
// 4285.71 against 4300 — a third of a percent.
near('a full week sampled, the flat run-rate lands in much the same place',
  1000 / 7 * 30, 4285.71, 0.01);

// The gap opens when the elapsed days are NOT a whole week. Five days in —
// Sunday to Thursday, before either quiet day has happened — a flat rate
// carries the busy midweek across the weekend it has never seen.
const partial = {'2026-11-01':100,'2026-11-02':200,'2026-11-03':200,
                 '2026-11-04':200,'2026-11-05':200};
const pw = _mpProject_(partial, '2026-11', 30);
// 900 logged over 5 days. Remaining 25: Sun 4, Mon 4, Tue/Wed/Thu 3, Fri 4, Sat 4.
// Fri and Sat have no sample yet, so they fall back to the overall 180.
// 900 + 4(100) + 4(200) + 3(200+200+200) + 4(180) + 4(180) = 5340
near('an unsampled weekday falls back, and the figure parts from the flat rate',
  pw.total, 5340);
near('where the flat rate would have said 5400', 900 / 5 * 30, 5400);
t('five days in, 25 are still to come', pw.projectedDays, 25);

// A gap inside the logged stretch is a real zero, not a day to guess at.
const gap = _mpProject_({'2026-11-01':100,'2026-11-02':200,'2026-11-05':200}, '2026-11', 30);
near('a quiet day inside the logged range stays zero',
  gap.actual, 500);
t('only days after the last logged one are projected', gap.projectedDays, 25);

// A finished month has nothing left to project.
const full = {};
for (let d = 1; d <= 30; d++) full['2026-11-' + ('0' + d).slice(-2)] = 10;
const fp = _mpProject_(full, '2026-11', 30);
t('a complete month projects nothing', fp.projectedDays, 0);
near('and its projection is simply its actual', fp.total, 300);
t('and says so', fp.basis, '30 days logged · month complete');

// A weekday with no sample yet falls back to the overall average.
const two = _mpProject_({'2026-11-01':100,'2026-11-02':300}, '2026-11', 30);
near('an unseen weekday uses the overall average', two.total, 100 + 300 + 28 * 200);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
