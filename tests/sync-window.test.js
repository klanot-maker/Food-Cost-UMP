// Week-aligned window + forecast behaviour.
// Today is Thursday 2026-11-05. Expected window: Sun 2026-10-25 .. Sat 2026-11-14.
const fs   = require('fs');
const path = require('path');
// Found relative to this file rather than at a fixed location, so the suite
// runs wherever the repository is checked out — a laptop, a CI runner.
const ROOT = path.join(__dirname, '..');
const src  = fs.readFileSync(path.join(ROOT, 'CaloDeliveries.gs'), 'utf8');

// DELIVERIES tab: 2026 block starts at row 134. Oct = cols S/T (0-based 18/19),
// Nov = cols U/V (0-based 20/21). Date in the even col, count in the next.
// Date cells hold real Date objects, which is what getValues() hands back for
// a date-formatted cell in the live sheet — not the strings the earlier
// fixtures used. Nov 15-30 are left blank, as they are in the real tab.
const grid = Array.from({ length: 170 }, () => Array(24).fill(''));
for (let d = 1; d <= 31; d++) { grid[133 + d - 1][18] = new Date(2026, 9, d);  grid[133 + d - 1][19] = 4000 + d; }
for (let d = 1; d <= 30; d++) { grid[133 + d - 1][20] = new Date(2026, 10, d); grid[133 + d - 1][21] = d <= 14 ? 1000 + d : ''; }

// Dashboard.gs is loaded alongside in production, so _caloYmd_ delegates to
// its reader rather than the local fallback. Exercise that path.
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

const written = [];
const SHEET = {
  getDataRange: () => ({ getValues: () => grid }),
  getRange: (r, c) => ({ setValue: v => { written.push({ r, c, v }); grid[r - 1][c - 1] = v; } })
};
global.SpreadsheetApp = { openById: () => ({ getName: () => 'W', getSheetByName: n => n === 'DELIVERIES' ? SHEET : null }) };
global.SS_COMPLAINTS_ = () => 'x';
global.CFG_KITCHEN_ = () => 'AE001';
const props = {
  CALO_API_KEY: 'k',
  CALO_QS_STYLE: 'brackets',
  CALO_DLV_FILTER: JSON.stringify({ skipped: false, status: ['upcoming', 'paymentRequired'] })
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => props[k] = v }) };
global.Session = { getScriptTimeZone: () => 'Asia/Dubai' };
global.Logger = { log: () => {} };
global.Utilities = { formatDate: () => '2026-11-05' };     // Thursday
let installMsg = '';
global.ScriptApp = {
  newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => {} }) }) }) }),
  getProjectTriggers: () => []
};

// Past/today: a settled figure. Future: a count that thins out the further
// ahead you look, and 0 from the 14th on — nothing generated yet.
function apiCount(day) {
  if (day <= '2026-11-05') return 5000 + Number(day.slice(8));
  if (day >= '2026-11-14') return 0;
  return 3800 - (Number(day.slice(8)) - 6) * 400;
}
global.UrlFetchApp = { fetch: u => {
  const q = decodeURIComponent(u);
  const day = (q.match(/filters\[day\]\[gte\]=(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!day) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ count: 60635664 }) };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ count: apiCount(day), cost: [] }) };
}};

eval(src);

let pass = 0, fail = 0;
const t = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};

// ── week arithmetic ─────────────────────────────────────────
t('Nov 5 2026 is a Thursday',        _CALO_DOW[_caloDow_('2026-11-05')], 'Thu');
t('week containing Thu starts Sun',  _caloWeekStart_('2026-11-05'), '2026-11-01');
t('week containing Thu ends Sat',    _caloWeekEnd_('2026-11-05'),   '2026-11-07');
t('a Sunday is its own week start',  _caloWeekStart_('2026-11-08'), '2026-11-08');
t('a Saturday is its own week end',  _caloWeekEnd_('2026-11-14'),   '2026-11-14');
t('week start crosses the month',    _caloWeekStart_('2026-11-02'), '2026-11-01');
t('week start crosses into Oct',     _caloWeekStart_('2026-10-31'), '2026-10-25');

// ── the window ──────────────────────────────────────────────
const days = _caloDayList_(1, 1);
t('window is 21 days',               days.length, 21);
t('window starts last Sunday',       days[0], '2026-10-25');
t('window ends next Saturday',       days[days.length - 1], '2026-11-14');
t('covers Nov 6 to Nov 14',          days.filter(d => d >= '2026-11-06' && d <= '2026-11-14').length, 9);
t('stops before Nov 15',             days.indexOf('2026-11-15'), -1);
t('0 weeks forward ends this Sat',   _caloDayList_(0, 0)[_caloDayList_(0, 0).length - 1], '2026-11-07');
t('2 weeks forward ends Nov 21',     _caloDayList_(1, 2).slice(-1)[0], '2026-11-21');

// ── the days-vs-weeks typo guard ────────────────────────────
let threw = '';
try { _caloWeeksArg_(7, 1, 'weeksBack'); } catch (e) { threw = e.message; }
t('7 is refused as a weeks value',   /WEEKS now, not days/.test(threw), true);
t('and suggests the right number',   /Try 1\./.test(threw), true);
t('0 weeks is allowed',              _caloWeeksArg_(0, 1, 'x'), 0);
t('omitted falls back to default',   _caloWeeksArg_(undefined, 1, 'x'), 1);

// ── preview writes nothing ──────────────────────────────────
written.length = 0;
const prev = caloPreviewSync();
t('preview writes nothing',          written.length, 0);
t('preview flags forecast rows',     /would write \(forecast\)/.test(prev), true);

// ── the sync ────────────────────────────────────────────────
written.length = 0;
const log = _caloSync_(1, 1, false);

const byDay = {};
written.forEach(w => { byDay[_dlvYmd_(grid[w.r - 1][w.c - 2])] = w.v; });

t('Nov 6 written as forecast',       byDay['2026-11-06'], 3800);
t('Nov 13 written as forecast',      byDay['2026-11-13'], 1000);
t('Nov 14 held back, not zeroed',    grid[133 + 13][21], 1014);
t('date cells are Date objects',     grid[133 + 13][20] instanceof Date, true);
t('Nov 14 never written',            written.some(w => w.r === 133 + 14), false);
t('Nov 5 written as actual',         byDay['2026-11-05'], 5005);
t('Oct 25 written (last week)',      byDay['2026-10-25'], 5025);
t('Oct 24 untouched (before window)', grid[133 + 23][19], 4024);
t('Nov 15 still blank (after window)', grid[133 + 14][21], '');
t('only count columns touched',      [...new Set(written.map(w => w.c))].sort((a, b) => a - b), [20, 22]);
t('every window day with a row written', written.length, 20);  // 21 days less held-back Nov 14

// ── zero never overwrites a real figure ─────────────────────
// The API has a bad moment and answers 0 for a settled day.
const realApi = global.UrlFetchApp.fetch;
global.UrlFetchApp = { fetch: u => {
  const day = (decodeURIComponent(u).match(/filters\[day\]\[gte\]=(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (day === '2026-11-04') return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ count: 0, cost: [] }) };
  return realApi(u);
}};
const before = grid[133 + 3][21];
written.length = 0;
const zlog = _caloSync_(1, 1, false);
t('past 0 does not overwrite',       grid[133 + 3][21], before);
t('Nov 4 never written',             written.some(w => w.r === 133 + 4), false);
t('and the log says to check',       /API says 0 but the sheet has .* left alone/.test(zlog), true);
global.UrlFetchApp = { fetch: realApi };

// ── the log reads as weeks ──────────────────────────────────
t('three week headings',             (log.match(/── 2026-\d\d-\d\d Sun → /g) || []).length, 3);
t('last week labelled',              /last week — re-checked/.test(log), true);
t('next week labelled',              /NEXT WEEK — forecast/.test(log), true);
t('this week labelled',              /2026-11-07 Sat    this week/.test(log), true);
t('held-back day explained',         /not generated yet — left alone/.test(log), true);
t('summary counts the hold',         /1 held back/.test(log), true);
t('window stated up front',          /Window:  2026-10-25 \(Sun\) → 2026-11-14 \(Sat\)/.test(log), true);

// ── the trigger ─────────────────────────────────────────────
installMsg = caloInstallDailySync();
t('trigger covers the same window',  /2026-10-25 Sun → 2026-11-14 Sat/.test(installMsg), true);
t('trigger handler takes no args',   caloDailySyncRun.length, 0);

// a trigger passes an event object; it must not be read as a week count
threw = '';
try { caloSyncDeliveries({ triggerUid: 'x' }); } catch (e) { threw = e.message; }
t('an event object is refused',      /whole number of WEEKS/.test(threw), true);

// ── the filter guard still holds ────────────────────────────
delete props.CALO_DLV_FILTER;
written.length = 0;
const blocked = _caloSync_(1, 1, false);
t('no filter = no writes',           written.length, 0);
t('and says why',                    /which rows count as a delivery/.test(blocked), true);



// ── caloCheckHistory: read-only, and reads the verdict off the data ──
// The guard test above cleared the filter; put it back.
props.CALO_DLV_FILTER = JSON.stringify({ skipped: false, status: ['upcoming', 'paymentRequired'] });
// Fixture: the tab's older blocks. 2022 rows 2-32, 2026 rows 134-164.
for (let d = 1; d <= 31; d++) { grid[1 + d - 1][0] = new Date(2022, 0, d); grid[1 + d - 1][1] = 200 + d; }

written.length = 0;
let hApi = day => 0;                                   // the API has nothing for old days
global.UrlFetchApp = { fetch: u => {
  const day = (decodeURIComponent(u).match(/filters\[day\]\[gte\]=(\d{4}-\d{2}-\d{2})/) || [])[1];
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ count: hApi(day), cost: [] }) };
}};
let hist = caloCheckHistory(6);
t('history check writes nothing',    written.length, 0);
t('spots a filter that misses old',  /DOES NOT DESCRIBE OLD DAYS/.test(hist), true);
t('and says not to backfill',        /Do not\s+backfill/.test(hist), true);

// Now the API agrees with the sheet. Read the figure back out of the grid
// rather than recomputing it: the sync above has already rewritten three
// weeks of it, so any formula here would describe the fixture as it was
// built, not as it now stands.
const sheetVal = day => {
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c + 1 < grid[r].length; c += 2)
      if (grid[r][c] instanceof Date && _dlvYmd_(grid[r][c]) === day) return Number(grid[r][c + 1]) || 0;
  return 0;
};
hApi = sheetVal;
hist = caloCheckHistory(6);
t('spots a filter that does match',  /DESCRIBES HISTORY TOO/.test(hist), true);
t('counts the matches',              /6 of 6 matched exactly/.test(hist), true);

hApi = day => day.startsWith('2022') ? 0 : sheetVal(day);
hist = caloCheckHistory(6);
t('spots a mixed result',            /MIXED/.test(hist), true);
t('never samples a future day',      hist.indexOf('2026-11-06') , -1);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
