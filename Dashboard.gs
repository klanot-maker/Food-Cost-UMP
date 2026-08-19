// ============================================================
// UMP OPERATIONS DASHBOARD — Code.gs  (v4 — multi-sheet staff)
// ============================================================

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.resetToken = (e && e.parameter && e.parameter.reset) ? e.parameter.reset : '';
  return t.evaluate()
    .setTitle('UMP Operations Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── SPREADSHEET IDs ──────────────────────────────────────────
const SS_FINANCIAL  = '1JvHBdSaeh6c2KIktDAOTub93jTOqs5znszzwKEdbe1o';
const SS_COMPLAINTS = '1j1wZ3z3YMvWhDpQbzYTNUAWlaj2rRt1RwP1ENSX3Lr0';
const SS_STAFF      = '1fA1ytS34bcUf-xua55d_RWCgmBwrZEYlvhQtSNwGPwE';
// DOD Complaint sheet gid inside SS_COMPLAINTS
const GID_DOD_COMPLAINT = 1747363719;

// ── LOADERS ──────────────────────────────────────────────────
// Three focused functions fired in parallel from the client.
// Each opens only the spreadsheet(s) it needs — no redundant opens.
// CacheService keeps each section fresh for 30 s.

var _CACHE_CAP   = 'ump_cap_v1';
var _CACHE_FIN   = 'ump_fin_v1';
var _CACHE_STAFF = 'ump_staff_v1';
// Bumped to v2: the ops payload now carries logistics cost fields, so any
// payload cached under the old key has the wrong shape and must be dropped.
var _CACHE_OPS   = 'ump_ops_v2';
var _CACHE_INV   = 'ump_loginv_v1';
// Bumped whenever the invoice reader changes. The page shows it next to its
// own copy, so a dashboard running an older deployment is obvious at a glance
// instead of looking like a bug in the data.
var UMP_BUILD    = '2026-08-18.b';
var _CACHE_TTL   = 300; // seconds (5 min)

function _invalidateCache() {
  try {
    var c = CacheService.getScriptCache();
    c.remove(_CACHE_CAP);
    c.remove(_CACHE_FIN);
    c.remove(_CACHE_STAFF);
    c.remove(_CACHE_OPS);
    c.remove(_CACHE_INV);
  } catch(e) {}
}

// ── Phase 1: Capacity page (SS_COMPLAINTS only) ───────────────
// Typical time: 3–5 s on first call, <0.5 s on cache hit
function getCapacityPageData() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(_CACHE_CAP);
    if (hit) return JSON.parse(hit);
  } catch(e) {}

  var ss = SpreadsheetApp.openById(SS_COMPLAINTS);
  var data = {
    capacity:    getCapacityData(ss),
    deliveries:  getDeliveriesData(ss),
    forecast:    getForecastData(ss),
    logistics:   getLogisticsData(ss),
    wowDistrict: getWowDistrictData(ss),
    districtDel: getDistrictDeliveriesData(ss),
    districtShifts: getDistrictShiftData(ss)
  };
  try {
    var json = JSON.stringify(data);
    if (json.length <= 90000) cache.put(_CACHE_CAP, json, _CACHE_TTL);
  } catch(e) {}
  return data;
}

// ── Phase 2: Financial + Complaints (SS_FINANCIAL + SS_COMPLAINTS) ──
function getFinancialComplaintsData() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(_CACHE_FIN);
    if (hit) return JSON.parse(hit);
  } catch(e) {}

  var ssF = SpreadsheetApp.openById(SS_FINANCIAL);
  var ssC = SpreadsheetApp.openById(SS_COMPLAINTS);
  var data = {
    financial:  getFinancialData(ssF),
    complaints: getComplaintsData(ssC)
  };
  try {
    var json = JSON.stringify(data);
    if (json.length <= 90000) cache.put(_CACHE_FIN, json, _CACHE_TTL);
  } catch(e) {}
  return data;
}

// ── Phase 3: Staff (SS_STAFF only) ───────────────────────────
function getStaffPageData() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(_CACHE_STAFF);
    if (hit) return JSON.parse(hit);
  } catch(e) {}

  var ss = SpreadsheetApp.openById(SS_STAFF);
  var data = {
    staff:        getStaffData(ss),
    staffSummary: getStaffSummaryData(ss)
  };
  try {
    var json = JSON.stringify(data);
    if (json.length <= 90000) cache.put(_CACHE_STAFF, json, _CACHE_TTL);
  } catch(e) {}
  return data;
}

// ── Phase 4: Operation Overview (SS_COMPLAINTS + SS_STAFF) ───
function getOperationOverviewData() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(_CACHE_OPS);
    if (hit) return JSON.parse(hit);
  } catch(e) {}

  var ssC = SpreadsheetApp.openById(SS_COMPLAINTS);
  var ssS = SpreadsheetApp.openById(SS_STAFF);

  var deliveries = getDeliveriesData(ssC);
  var today      = new Date();

  function _ds(d) {
    return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
  }
  var d1 = new Date(today); d1.setDate(d1.getDate() + 1);
  var d2 = new Date(today); d2.setDate(d2.getDate() + 2);
  var ds1 = _ds(d1), ds2 = _ds(d2), todayStr = _ds(today);

  var delivByDate = {};
  (deliveries.records || []).forEach(function(r) { delivByDate[r.dateStr] = r.actual; });

  // Current week capacity target
  var capData = getCapacityData(ssC);
  var todayD  = new Date(todayStr + 'T00:00:00');
  var MO_LC   = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  var yr      = today.getFullYear();
  function _parseWR(wr) {
    var s = String(wr || '').replace(/–/g, '-');
    var parts = s.split(/\s*-\s*/);
    if (parts.length < 2) return null;
    function _pd(p) {
      var m = p.trim().match(/([A-Za-z]{3})\s+(\d+)/);
      if (!m) return null;
      var mi = MO_LC[m[1].toLowerCase()]; if (mi === undefined) return null;
      return new Date(yr, mi, parseInt(m[2]));
    }
    var s0 = _pd(parts[0]), e0 = _pd(parts[parts.length-1]);
    if (!s0 || !e0) return null;
    if (e0 < s0) e0 = new Date(yr+1, e0.getMonth(), e0.getDate());
    return { start: s0, end: e0 };
  }
  var currentWeekTarget = 0, currentWeekLabel = '';
  (capData.weeklyRows || []).forEach(function(wr) {
    var rng = _parseWR(wr.week);
    if (rng && todayD >= rng.start && todayD <= rng.end) {
      currentWeekTarget = wr.target;
      currentWeekLabel  = wr.week;
    }
  });
  if (!currentWeekTarget && capData.weeklyRows && capData.weeklyRows.length > 0) {
    var last = capData.weeklyRows[capData.weeklyRows.length - 1];
    currentWeekTarget = last.target;
    currentWeekLabel  = last.week;
  }

  // Today's staff data per dept
  var staffToday = _getTodayStaffData(ssS, todayStr);

  // DOD Complaints — find today's or latest available row
  var dodData = getDodComplaintsData(ssC);
  var todayDod = null;
  (dodData.records || []).forEach(function(r) {
    if (r.dateStr === todayStr) todayDod = r;
  });
  if (!todayDod && dodData.records && dodData.records.length > 0) {
    var sorted = dodData.records.slice().sort(function(a, b) {
      return b.dateStr.localeCompare(a.dateStr);
    });
    todayDod = sorted[0];
  }

  var _logisticsData = getLogisticsStaffData(ssC) || {};

  var data = {
    todayDeliveries:    delivByDate[ds1] || 0,
    todayDate:          ds1,
    tomorrowDeliveries: delivByDate[ds2] || 0,
    tomorrowDate:       ds2,
    currentWeekTarget:  currentWeekTarget,
    currentWeekLabel:   currentWeekLabel,
    staffToday:         staffToday,
    dodComplaints:      todayDod || null,
    dodComplaintsDate:  todayDod ? (todayDod.dateStr || todayStr) : todayStr,
    dodAllRecords:      dodData.records || [],
    dodHeaders:         dodData.headers || [],
    logisticsRows:      _logisticsData.rows || [],
    logisticsMeta:      _logisticsData.meta || null
  };

  try {
    var json = JSON.stringify(data);
    if (json.length <= 90000) cache.put(_CACHE_OPS, json, _CACHE_TTL);
  } catch(e) {}
  return data;
}

// ════════════════════════════════════════════════════════════
// DOD COMPLAINTS — daily complaint data (DOD Complaint sheet)
// Same SS_COMPLAINTS workbook, gid=1747363719
// Layout: Col A=Date, B=FO, C=Quality, D=Health, E=Spilled, F=Cold, G=Dispatch, H=Logistics
// ════════════════════════════════════════════════════════════
function getDodComplaintsData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheets = ss.getSheets();
    var sheet  = null;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === GID_DOD_COMPLAINT) { sheet = sheets[i]; break; }
    }
    if (!sheet) sheet = ss.getSheetByName('DOD Complaint');
    if (!sheet) return { records: [], headers: [] };

    var all = sheet.getDataRange().getValues();
    if (all.length < 2) return { records: [], headers: [] };

    // Row 1 headers: Col A = Date, Cols D–K (indices 3–10) = complaint categories (D=Foreign Object, E=Quality, F=Health, G=Spilled Liquids, H=Cold Section, I=Dispatch, J=Logistic, K=Calo Cafe)
    var hdrRow = all[0];
    var catCols = []; // [{key, label, colIdx}]
    for (var c = 3; c <= 10 && c < hdrRow.length; c++) {
      var lbl = String(hdrRow[c] || '').trim();
      if (!lbl) continue;
      catCols.push({ key: 'c' + c, label: lbl, colIdx: c });
    }

    var records = [];
    for (var r = 1; r < all.length; r++) {
      var dv = all[r][0];
      if (!dv) continue;
      var ds = null;
      if (dv instanceof Date && !isNaN(dv.getTime())) {
        ds = dv.getFullYear()+'-'+pad2(dv.getMonth()+1)+'-'+pad2(dv.getDate());
      } else {
        var sv = String(dv).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(sv)) ds = sv.substring(0, 10);
      }
      if (!ds) continue;
      var row = { dateStr: ds, total: 0, cats: {} };
      catCols.forEach(function(cc) {
        var v = safeNum(all[r][cc.colIdx]);
        row.cats[cc.key] = v;
        row.total += v;
      });
      if (row.total === 0 && r > 1) continue;
      records.push(row);
    }
    return { records: records, headers: catCols.map(function(cc){ return { key: cc.key, label: cc.label }; }) };
  } catch(e) {
    return { error: e.message, records: [], headers: [] };
  }
}

// ════════════════════════════════════════════════════════════
// TODAY STAFF — reads most recent monthly sheet, finds today's row per dept
// ════════════════════════════════════════════════════════════
function _getTodayStaffData(ss, todayStr) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_STAFF);
    var sheets   = ss.getSheets();
    var KEYWORDS = ['kitchen','steward','dispatch','office'];
    var MONTH_MAP = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,
                     september:8,october:9,november:10,december:11};

    function parseSheetAsMonth(name) {
      var m = name.trim().match(/^([A-Za-z]+)\s*:\s*(\d{4})$/);
      if (!m) return null;
      var mi = MONTH_MAP[m[1].toLowerCase()];
      if (mi === undefined) return null;
      return { name: name, ts: new Date(parseInt(m[2]), mi, 1).getTime() };
    }
    function isDeptHdr(cA, cB) {
      if (cB !== '') return false;
      var a = cA.toLowerCase();
      for (var k = 0; k < KEYWORDS.length; k++) if (a.indexOf(KEYWORDS[k]) > -1) return true;
      return false;
    }

    // Find most recent month sheet
    var monthSheets = [];
    for (var si = 0; si < sheets.length; si++) {
      var info = parseSheetAsMonth(sheets[si].getName());
      if (info) monthSheets.push({ sheet: sheets[si], ts: info.ts });
    }
    if (!monthSheets.length) return { depts: [] };
    monthSheets.sort(function(a, b) { return b.ts - a.ts; });
    var sheet = monthSheets[0].sheet;
    var all   = sheet.getDataRange().getValues();

    // Build today's formatted date string to match fmtCellDate output
    var todayParts = todayStr.split('-');
    var todayDate  = new Date(parseInt(todayParts[0]), parseInt(todayParts[1])-1, parseInt(todayParts[2]));
    var todayFmt   = null;
    try {
      todayFmt = Utilities.formatDate(todayDate, Session.getScriptTimeZone(), 'd MMM EEE');
    } catch(e) {
      todayFmt = Utilities.formatDate(todayDate, 'Asia/Dubai', 'd MMM EEE');
    }

    var depts = [];
    var i = 0;
    while (i < all.length) {
      var cA = String(all[i][0] || '').trim();
      var cB = String(all[i][1] || '').trim();
      if (isDeptHdr(cA, cB)) {
        var deptName = cA;
        i += 2;
        var todayRow = null, lastRow = null;
        while (i < all.length) {
          var nA = String(all[i][0] || '').trim();
          var nB = String(all[i][1] || '').trim();
          if (isDeptHdr(nA, nB)) break;
          if (!nA && !nB) { i++; continue; }
          var ps = safeNum(all[i][1]);
          if (ps > 0) {
            var rawDate = all[i][0];
            var rowDateFmt = fmtCellDate(rawDate);
            var rowData = {
              date: rowDateFmt,
              ps:   ps,
              on:   safeNum(all[i][2]),
              off:  safeNum(all[i][3]),
              al:   safeNum(all[i][4]),
              sl:   safeNum(all[i][5]),
              sup:  safeNum(all[i][6]),
              tot:  safeNum(all[i][7])
            };
            lastRow = rowData;
            if (rowDateFmt === todayFmt) todayRow = rowData;
          }
          i++;
        }
        var row = todayRow || lastRow || { on:0, off:0, al:0, sl:0, sup:0, tot:0, ps:0, date:'—' };
        depts.push({ name: deptName, hasToday: !!todayRow, row: row });
      } else {
        i++;
      }
    }
    return { depts: depts, date: todayFmt || todayStr };
  } catch(e) {
    return { error: e.message, depts: [] };
  }
}

// ── Full refresh (kept for compatibility, uses same cached sections) ──
function getAllData() {
  var cap   = getCapacityPageData();
  var fin   = getFinancialComplaintsData();
  var staff = getStaffPageData();
  var ops   = getOperationOverviewData();
  return {
    financial:    fin.financial,
    complaints:   fin.complaints,
    staff:        staff.staff,
    staffSummary: staff.staffSummary,
    capacity:     cap.capacity,
    deliveries:   cap.deliveries,
    forecast:     cap.forecast,
    logistics:    cap.logistics,
    wowDistrict:  cap.wowDistrict,
    districtDel:  cap.districtDel,
    districtShifts: cap.districtShifts,
    opsOverview:  ops
  };
}

// ════════════════════════════════════════════════════════════
// FINANCIAL COST
// ════════════════════════════════════════════════════════════
function getFinancialData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_FINANCIAL);
    var sheet = ss.getSheetByName('Financial cost') || ss.getSheets()[0];
    var all   = sheet.getDataRange().getValues();

    var hdr = all[0] || [];
    var monthCols = [];
    var MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (var c = 1; c < hdr.length; c++) {
      var raw = hdr[c];
      var label = null;
      if (raw instanceof Date && !isNaN(raw.getTime())) {
        label = MONTH_ABBR[raw.getMonth()] + ' ' + raw.getFullYear();
      } else {
        var h  = String(raw || '').trim();
        var mm = h.match(/^([A-Za-z]{3,})\s+(\d{2,4})$/);
        if (mm) {
          var mon = mm[1].substring(0, 3);
          var yr  = mm[2].length === 2 ? '20' + mm[2] : mm[2];
          label = mon + ' ' + yr;
        }
      }
      if (label) monthCols.push({ col: c, label: label });
    }

    function rowVals(r) {
      var row = all[r] || [], obj = {};
      monthCols.forEach(function(mc){ obj[mc.label] = safeNum(row[mc.col]); });
      return obj;
    }

    var wastage = [], other = [], kpis = {};
    var inWaste = false, inOther = false, wasteDone = false;

    for (var r = 0; r < all.length; r++) {
      var lbl  = String(all[r][0] || '').trim();
      var lblL = lbl.toLowerCase();
      if (!lbl) continue;

      if (!wasteDone && lblL === 'wastages')         { inWaste = true;  inOther = false; continue; }
      if (lblL.indexOf('other food cost') > -1)      { inOther = true;  inWaste = false; continue; }
      if (lblL.indexOf('total wastage') > -1)        { inWaste = false; wasteDone = true; continue; }
      if (lblL.indexOf('total other') > -1)          { inOther = false; continue; }
      if (lblL === 'category' || lblL === 'subtotal' || lblL === 'total') continue;

      if (!inWaste && !inOther) {
        if (lblL === 'monthly revenue')            { kpis.revenue    = rowVals(r); continue; }
        if (lblL === 'monthly deliveries')         { kpis.deliveries = rowVals(r); continue; }
        if (lblL === 'dpd')                        { kpis.dpd        = rowVals(r); continue; }
        if (lblL.indexOf('revenue') > -1 && (lblL.indexOf('usd') > -1 || lblL.indexOf('$') > -1)) {
          kpis.revenueUsd = rowVals(r); continue;
        }
        if ((lblL.indexOf('delivery') > -1 || lblL.indexOf('deliveries') > -1) &&
            (lblL.indexOf('growth') > -1 || lblL.indexOf('change') > -1 || lblL.indexOf('mom') > -1 || lblL.indexOf('%') > -1) &&
            lblL !== 'monthly deliveries') {
          kpis.deliveriesGrowth = rowVals(r); continue;
        }
        if (lblL.indexOf('food cost') > -1 && lblL.indexOf('other') === -1) {
          kpis.foodCostPct = rowVals(r); continue;
        }
      }

      if (inWaste) wastage.push({ cat: lbl, vals: rowVals(r) });
      else if (inOther) other.push({ cat: lbl, vals: rowVals(r) });
    }

    function dedupe(arr) {
      var seen = {}, out = [];
      arr.forEach(function(item) {
        if (!seen[item.cat]) { seen[item.cat] = true; out.push(item); }
      });
      return out;
    }
    wastage = dedupe(wastage);
    other   = dedupe(other);

    return {
      months:  monthCols.map(function(mc){ return mc.label; }),
      kpis:    kpis,
      wastage: wastage,
      other:   other
    };
  } catch(e) {
    return { error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// UMP COMPLAINTS
// Counts: DOD Complaint sheet — Col A=Date, D(3)=FO, E(4)=Quality, F(5)=Health, G(6)=Spilled, H(7)=Cold, I(8)=Dispatch, J(9)=Logistics, K(10)=Calo Cafe
// Rates:  MOM Complaints sheet — Col A=Month, N(13)=FO%, O(14)=Quality%, Q(16)=Spilled%, S(18)=Dispatch%, T(19)=Logistics%
// Targets: MOM Complaints row 1, same columns
// ════════════════════════════════════════════════════════════
function getComplaintsData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheets = ss.getSheets();

    // ── 1. Read MOM Complaints for targets (row 1) and per-month rates ──
    var momSheet = null;
    for (var si = 0; si < sheets.length; si++) {
      if (sheets[si].getSheetId() === 1266592099) { momSheet = sheets[si]; break; }
    }
    if (!momSheet) momSheet = ss.getSheetByName('MOM Complaints');

    var targets = { fo: 0.007, ql: 0.003, sl: 0.002, dp: 0.005, le: 0.008 };
    var momRates = {}; // "Month YYYY" => {foPct, qlPct, slPct, dpPct, lePct}

    if (momSheet) {
      var momAll = momSheet.getDataRange().getValues();
      // Row 0 (row 1 in sheet) = targets
      var tRow = momAll[0] || [];
      // Targets are decimal fractions (e.g. 0.00007 = 0.007%) — multiply by 100 for display
      var _t = function(i) { var v = parseFloat(tRow[i]); return isNaN(v) ? null : v * 100; };
      targets = {
        fo: _t(13) !== null ? _t(13) : 0.007,
        ql: _t(14) !== null ? _t(14) : 0.003,
        sl: _t(16) !== null ? _t(16) : 0.002,
        dp: _t(18) !== null ? _t(18) : 0.005,
        le: _t(19) !== null ? _t(19) : 0.008
      };
      // Rows 1+ = monthly data: col A = month label (Date or text)
      // N(13)=FO%, O(14)=Quality%, P(15)=Health%, Q(16)=Spilled%, R(17)=Cold%, S(18)=Dispatch%, T(19)=Logistics%
      // Values are decimal fractions (e.g. 0.000047 = 0.0047%)
      var MOM_MONTH_NAMES = ['January','February','March','April','May','June',
                             'July','August','September','October','November','December'];
      for (var mr = 1; mr < momAll.length; mr++) {
        var mRow = momAll[mr];
        var mv = mRow[0];
        if (!mv) continue;
        // Build "Month YYYY" key to match DOD bucket keys
        var mKey = null;
        if (mv instanceof Date && !isNaN(mv.getTime())) {
          mKey = MOM_MONTH_NAMES[mv.getMonth()] + ' ' + mv.getFullYear();
        } else {
          // Try to parse text like "May 2026", "Jun-26", "January 2026"
          var ms = String(mv).trim();
          var md = new Date(ms);
          if (!isNaN(md.getTime())) {
            mKey = MOM_MONTH_NAMES[md.getMonth()] + ' ' + md.getFullYear();
          } else {
            // Try "Mon-YY" format e.g. "Jun-26"
            var mtp = ms.match(/^([A-Za-z]+)[- ](\d{2,4})$/);
            if (mtp) {
              var tmpD = new Date(mtp[1] + ' 1 ' + (mtp[2].length===2?'20'+mtp[2]:mtp[2]));
              if (!isNaN(tmpD.getTime())) mKey = MOM_MONTH_NAMES[tmpD.getMonth()] + ' ' + tmpD.getFullYear();
            }
          }
        }
        if (!mKey) continue;
        var _safeP = function(row, i) { var v = parseFloat(row[i]); return isNaN(v) ? null : v; };
        momRates[mKey] = {
          foPct: _safeP(mRow, 13),
          qlPct: _safeP(mRow, 14),
          hrPct: _safeP(mRow, 15),
          slPct: _safeP(mRow, 16),
          csPct: _safeP(mRow, 17),
          dpPct: _safeP(mRow, 18),
          lePct: _safeP(mRow, 19)
        };
      }
    }

    // ── 2. Read DOD Complaint for daily counts ──
    var dodSheet = null;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === GID_DOD_COMPLAINT) { dodSheet = sheets[i]; break; }
    }
    if (!dodSheet) dodSheet = ss.getSheetByName('DOD Complaint');
    if (!dodSheet) return { months: [], targets: targets };

    var all = dodSheet.getDataRange().getValues();
    if (all.length < 2) return { months: [], targets: targets };

    var COL = { fo: 3, ql: 4, hr: 5, sl: 6, cs: 7, dp: 8, le: 9, cc: 10 };
    var MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    var buckets = {}, order = [];

    for (var r = 1; r < all.length; r++) {
      var dv = all[r][0];
      if (!dv) continue;
      var dt = null;
      if (dv instanceof Date && !isNaN(dv.getTime())) {
        dt = dv;
      } else {
        var sv = String(dv).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(sv)) dt = new Date(sv);
      }
      if (!dt) continue;
      var key = MONTH_NAMES[dt.getMonth()] + ' ' + dt.getFullYear();
      if (!buckets[key]) {
        buckets[key] = { label: key, fo:0, ql:0, hr:0, sl:0, cs:0, dp:0, le:0, cc:0 };
        order.push(key);
      }
      var row = all[r];
      Object.keys(COL).forEach(function(k) { buckets[key][k] += safeNum(row[COL[k]]); });
    }

    // ── 3. Merge rates from MOM Complaints into each bucket ──
    var months = order.map(function(k) {
      var b = buckets[k];
      b.total = b.fo + b.ql + b.hr + b.sl + b.cs + b.dp + b.le + b.cc;
      var rates = momRates[k] || {};
      // Sheet stores decimal fractions; multiply by 100 to get % for display/comparison
      ['foPct','qlPct','hrPct','slPct','csPct','dpPct','lePct'].forEach(function(pk){
        b[pk] = (rates[pk] !== undefined && rates[pk] !== null) ? rates[pk] * 100 : null;
      });
      return b;
    });

    return { months: months, targets: targets };
  } catch(e) {
    return { error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// PRODUCTION STAFF — reads ALL "Month : YYYY" sheets
// Sheet format per month:
//   Dept header row (col A = dept name, col B empty)
//   Column headers row (skipped)
//   Daily data rows: A=date B=permStaff C=on D=off E=al F=sl G=sup H=tot I=dd J=del K=dps
// ════════════════════════════════════════════════════════════
function getStaffData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_STAFF);
    var sheets = ss.getSheets();
    var KEYWORDS  = ['kitchen','steward','dispatch','office'];
    var MONTH_MAP = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,
                     september:8,october:9,november:10,december:11};

    // Match sheet names like "June : 2026" or "May : 2026"
    function parseSheetAsMonth(name) {
      var m = name.trim().match(/^([A-Za-z]+)\s*:\s*(\d{4})$/);
      if (!m) return null;
      var mi = MONTH_MAP[m[1].toLowerCase()];
      if (mi === undefined) return null;
      return { name: name, ts: new Date(parseInt(m[2]), mi, 1).getTime(), year: parseInt(m[2]) };
    }

    function isDeptHdr(cA, cB) {
      if (cB !== '') return false;
      var a = cA.toLowerCase();
      for (var k = 0; k < KEYWORDS.length; k++) if (a.indexOf(KEYWORDS[k]) > -1) return true;
      return false;
    }

    var allSections = [];

    for (var si = 0; si < sheets.length; si++) {
      var sheet     = sheets[si];
      var sheetInfo = parseSheetAsMonth(sheet.getName());
      if (!sheetInfo) continue;

      var all = sheet.getDataRange().getValues();
      var i   = 0;

      while (i < all.length) {
        var cA = String(all[i][0] || '').trim();
        var cB = String(all[i][1] || '').trim();

        if (isDeptHdr(cA, cB)) {
          var deptName = cA;
          i += 2; // skip dept header + column headers row

          var rows = [];
          while (i < all.length) {
            var nA = String(all[i][0] || '').trim();
            var nB = String(all[i][1] || '').trim();
            if (isDeptHdr(nA, nB)) break;
            if (!nA && !nB) { i++; continue; }

            var ps = safeNum(all[i][1]);
            if (ps > 0) {
              var pdVal  = all[i][0];
              var dpsRaw = String(all[i][10] || '');
              rows.push({
                pd:   fmtCellDate(pdVal),
                pdTs: (pdVal instanceof Date && !isNaN(pdVal.getTime())) ? pdVal.getTime() : null,
                ps:   ps,
                on:   safeNum(all[i][2]),
                off:  safeNum(all[i][3]),
                al:   safeNum(all[i][4]),
                sl:   safeNum(all[i][5]),
                sup:  safeNum(all[i][6]),
                tot:  safeNum(all[i][7]),
                dd:   fmtCellDate(all[i][8]),
                del:  safeNum(all[i][9]),
                dps:  (dpsRaw.indexOf('#') > -1 || dpsRaw === '') ? 0 : safeNum(all[i][10])
              });
            }
            i++;
          }

          if (rows.length > 0) {
            var lr      = rows[rows.length - 1];
            var supArr  = rows.filter(function(r){ return r.sup > 0; }).map(function(r){ return r.sup; });
            var dpsArr  = rows.filter(function(r){ return r.dps > 0; }).map(function(r){ return r.dps; });
            var totalDel = rows.reduce(function(s, r){ return s + r.del; }, 0);
            allSections.push({
              name:       deptName,
              sheetName:  sheetInfo.name,
              sheetTs:    sheetInfo.ts,
              permStaff:  lr.ps,
              avgSup:     supArr.length ? Math.round(supArr.reduce(function(a,b){return a+b;},0)/supArr.length) : 0,
              totalDel:   totalDel,
              avgDps:     dpsArr.length ? Math.round(dpsArr.reduce(function(a,b){return a+b;},0)/dpsArr.length) : 0,
              daysLogged: rows.length,
              rows:       rows
            });
          }
        } else {
          i++;
        }
      }
    }

    // Sort newest sheet first; preserve dept order within same sheet
    allSections.sort(function(a, b) { return b.sheetTs - a.sheetTs; });
    return { sections: allSections };
  } catch(e) {
    return { error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// STAFF SUMMARY — reads "Month Summary" sheets
// Expects same dept-section format as daily sheets
// ════════════════════════════════════════════════════════════
function getStaffSummaryData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_STAFF);
    var sheets = ss.getSheets();
    var MONTH_MAP = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,
                     september:8,october:9,november:10,december:11};
    var KEYWORDS  = ['kitchen','steward','dispatch','office'];
    var curYear   = new Date().getFullYear();

    function isDeptHdr(cA, cB) {
      if (cB !== '') return false;
      var a = cA.toLowerCase();
      for (var k = 0; k < KEYWORDS.length; k++) if (a.indexOf(KEYWORDS[k]) > -1) return true;
      return false;
    }

    var results = [];

    for (var si = 0; si < sheets.length; si++) {
      var sheet = sheets[si];
      var name  = sheet.getName().trim();
      var m     = name.match(/^([A-Za-z]+)\s+Summary$/i);
      if (!m) continue;
      var mi = MONTH_MAP[m[1].toLowerCase()];
      if (mi === undefined) continue;

      var all      = sheet.getDataRange().getValues();
      var sections = [];
      var i        = 0;

      while (i < all.length) {
        var cA = String(all[i][0] || '').trim();
        var cB = String(all[i][1] || '').trim();
        if (isDeptHdr(cA, cB)) {
          var deptName = cA;
          i += 2;
          var rows = [];
          while (i < all.length) {
            var nA = String(all[i][0] || '').trim();
            var nB = String(all[i][1] || '').trim();
            if (isDeptHdr(nA, nB)) break;
            if (!nA && !nB) { i++; continue; }
            var ps = safeNum(all[i][1]);
            if (ps > 0) rows.push({ ps: ps, sup: safeNum(all[i][6]), tot: safeNum(all[i][7]), del: safeNum(all[i][9]), dps: safeNum(all[i][10]) });
            i++;
          }
          if (rows.length > 0) {
            var lr     = rows[rows.length - 1];
            var supArr = rows.filter(function(r){ return r.sup > 0; }).map(function(r){ return r.sup; });
            var dpsArr = rows.filter(function(r){ return r.dps > 0; }).map(function(r){ return r.dps; });
            sections.push({
              name:      deptName,
              permStaff: lr.ps,
              avgSup:    supArr.length ? Math.round(supArr.reduce(function(a,b){return a+b;},0)/supArr.length) : 0,
              totalDel:  rows.reduce(function(s,r){return s+r.del;},0),
              avgDps:    dpsArr.length ? Math.round(dpsArr.reduce(function(a,b){return a+b;},0)/dpsArr.length) : 0
            });
          }
        } else {
          i++;
        }
      }

      if (sections.length > 0) {
        results.push({
          label:    m[1] + ' ' + curYear,
          ts:       new Date(curYear, mi, 1).getTime(),
          sections: sections
        });
      }
    }

    results.sort(function(a, b){ return b.ts - a.ts; });
    return { months: results };
  } catch(e) {
    return { error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// WRITE-BACK — Complaints
// ════════════════════════════════════════════════════════════
function updateComplaintsValue(monthLabel, field, value) {
  try {
    var ss     = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet  = null;
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === 1266592099) { sheet = sheets[i]; break; }
    }
    if (!sheet) sheet = ss.getSheetByName('MOM Complaints') || sheets[0];

    var COL = { fo:2, ql:3, hr:4, sl:5, cs:6, dp:7, le:8 };
    var col = COL[field];
    if (!col) throw new Error('Unknown field: ' + field);

    var all = sheet.getDataRange().getValues();
    var targetRow = -1;
    for (var r = 0; r < all.length; r++) {
      if (fmtMonthLabel(all[r][0]) === monthLabel) { targetRow = r + 1; break; }
    }
    if (targetRow === -1) throw new Error('Month not found: ' + monthLabel);

    sheet.getRange(targetRow, col).setValue(Number(value));
    SpreadsheetApp.flush();
    _invalidateCache();
    return { ok: true };
  } catch(e) {
    throw new Error('updateComplaintsValue: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// WRITE-BACK — Production Staff (update existing row)
// sheetName: "June : 2026" (pass from client; falls back to old gid search)
// field: 'on'|'off'|'al'|'sl'|'sup'|'del'
// ════════════════════════════════════════════════════════════
function updateStaffValue(sheetName, deptName, dateStr, field, value) {
  try {
    var ss    = SpreadsheetApp.openById(SS_STAFF);
    var sheet = sheetName ? ss.getSheetByName(sheetName) : null;

    if (!sheet) {
      var sheets = ss.getSheets();
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].getSheetId() === 773931869) { sheet = sheets[i]; break; }
      }
      if (!sheet) {
        for (var j = 0; j < sheets.length; j++) {
          var n = sheets[j].getName().toLowerCase();
          if (n.indexOf('june') > -1 || n.indexOf('jun') > -1) { sheet = sheets[j]; break; }
        }
      }
      if (!sheet) sheet = ss.getSheets()[0];
    }

    var COL = { on:3, off:4, al:5, sl:6, sup:7, del:10 };
    var col = COL[field];
    if (!col) throw new Error('Unknown field: ' + field);

    var all      = sheet.getDataRange().getValues();
    var KEYWORDS = ['kitchen','steward','dispatch','office'];
    var inDept   = false, targetRow = -1;

    for (var r = 0; r < all.length; r++) {
      var cellA = String(all[r][0] || '').trim();
      var cellB = String(all[r][1] || '').trim();
      var isDeptHdr = cellB === '' && (function(a){
        for (var k = 0; k < KEYWORDS.length; k++) {
          if (a.toLowerCase().indexOf(KEYWORDS[k]) > -1) return true;
        }
        return false;
      })(cellA);
      if (isDeptHdr) { inDept = (cellA === deptName); continue; }
      if (inDept && fmtCellDate(all[r][0]) === dateStr) { targetRow = r + 1; break; }
    }
    if (targetRow === -1) throw new Error('Row not found: ' + deptName + ' / ' + dateStr);

    sheet.getRange(targetRow, col).setValue(Number(value));
    SpreadsheetApp.flush();
    _invalidateCache();
    return { ok: true };
  } catch(e) {
    throw new Error('updateStaffValue: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// WRITE-BACK — Add new row to a department section
// sheetName: "June : 2026"
// deptName: e.g. "Kitchen Staff"
// rowData: { pd:'YYYY-MM-DD', dd:'YYYY-MM-DD', on, off, al, sl, sup, del }
// Server calculates ps, tot, dps automatically
// ════════════════════════════════════════════════════════════
function addStaffRow(sheetName, deptName, rowData) {
  try {
    var ss    = SpreadsheetApp.openById(SS_STAFF);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet not found: ' + sheetName);

    var all      = sheet.getDataRange().getValues();
    var KEYWORDS = ['kitchen','steward','dispatch','office'];

    function isDeptHdr(cA, cB) {
      if (cB !== '') return false;
      var a = cA.toLowerCase();
      for (var k = 0; k < KEYWORDS.length; k++) if (a.indexOf(KEYWORDS[k]) > -1) return true;
      return false;
    }

    function parseISO(s) {
      if (!s) return null;
      var p = String(s).split('-');
      return p.length === 3 ? new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2])) : null;
    }

    var on  = Number(rowData.on)  || 0;
    var off = Number(rowData.off) || 0;
    var al  = Number(rowData.al)  || 0;
    var sl  = Number(rowData.sl)  || 0;
    var sup = Number(rowData.sup) || 0;
    var del = Number(rowData.del) || 0;
    var ps  = on + off + al + sl;
    var tot = on + sup;
    var dps = (tot > 0 && del > 0) ? Math.round(del / tot) : 0;

    var pdDate      = parseISO(rowData.pd);
    var ddDate      = parseISO(rowData.dd);
    var pdFormatted = pdDate ? fmtCellDate(pdDate) : '';

    // Scan dept section: find existing row by date, track last data row for fallback insert
    var inDept = false, targetRow = -1, lastDataRow = -1;
    for (var r = 0; r < all.length; r++) {
      var cA = String(all[r][0] || '').trim();
      var cB = String(all[r][1] || '').trim();
      if (isDeptHdr(cA, cB)) {
        if (inDept) break;
        if (cA === deptName) inDept = true;
        continue;
      }
      if (inDept) {
        if (fmtCellDate(all[r][0]) === pdFormatted) targetRow = r + 1;
        if (all[r][0]) lastDataRow = r + 1;
      }
    }
    if (!inDept) throw new Error('Dept not found: ' + deptName);

    if (targetRow > 0) {
      // Row exists — update only INPUT columns; skip formula cols B(ps), H(tot), K(dps)
      sheet.getRange(targetRow, 3, 1, 5).setValues([[on, off, al, sl, sup]]); // C–G: on, off, al, sl, sup
      if (ddDate) sheet.getRange(targetRow, 9, 1, 1).setValue(ddDate);        // I: delivery date
      sheet.getRange(targetRow, 10, 1, 1).setValue(del);                       // J: total deliveries
    } else {
      // No matching date row — insert after last data row
      if (lastDataRow < 1) throw new Error('No data rows found for: ' + deptName);
      sheet.insertRowAfter(lastDataRow);
      sheet.getRange(lastDataRow + 1, 1, 1, 11).setValues([[
        pdDate, ps, on, off, al, sl, sup, tot, ddDate || '', del, dps
      ]]);
    }
    SpreadsheetApp.flush();
    _invalidateCache();
    return { ok: true };
  } catch(e) {
    throw new Error('addStaffRow: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// WRITE-BACK — Financial Cost
// ════════════════════════════════════════════════════════════
function updateFinancialValue(monthLabel, field, value) {
  try {
    var ss    = SpreadsheetApp.openById(SS_FINANCIAL);
    var sheet = ss.getSheetByName('Financial cost') || ss.getSheets()[0];
    var all   = sheet.getDataRange().getValues();

    var hdr = all[0] || [];
    var targetCol = -1;
    var MA2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (var c = 1; c < hdr.length; c++) {
      var raw2 = hdr[c];
      var lbl2 = null;
      if (raw2 instanceof Date && !isNaN(raw2.getTime())) {
        lbl2 = MA2[raw2.getMonth()] + ' ' + raw2.getFullYear();
      } else {
        var h  = String(raw2 || '').trim();
        var mm = h.match(/^([A-Za-z]{3,})\s+(\d{2,4})$/);
        if (mm) lbl2 = mm[1].substring(0,3) + ' ' + (mm[2].length===2?'20'+mm[2]:mm[2]);
      }
      if (lbl2 === monthLabel) { targetCol = c; break; }
    }
    if (targetCol === -1) throw new Error('Month column not found: ' + monthLabel);

    var fieldMap = { revenue: 'monthly revenue', deliveries: 'monthly deliveries', dpd: 'dpd' };
    var searchLbl = (fieldMap[field] || field).toLowerCase();
    var targetRow = -1;
    for (var r = 0; r < all.length; r++) {
      if (String(all[r][0] || '').trim().toLowerCase() === searchLbl) { targetRow = r; break; }
    }
    if (targetRow === -1) throw new Error('Row not found for field: ' + field);

    sheet.getRange(targetRow + 1, targetCol + 1).setValue(Number(value));
    SpreadsheetApp.flush();
    _invalidateCache();
    return { ok: true };
  } catch(e) {
    throw new Error('updateFinancialValue failed: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// CAPACITY — reads CAPACITY sheet (SS_COMPLAINTS workbook)
// Row 1 = headers; data from Row 2.
// Cols A–G per row:
//   A = week range text (e.g. "Jun 1 – Jun 7")
//   B = target DPD
//   C = current average
//   D = gap to fill
//   E = cap fulfilled %
//   F = DPD WoW value
//   G = WoW %
// Lower in sheet: horizontal date/forecast pairs for daily chart
// ════════════════════════════════════════════════════════════
function getCapacityData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('CAPACITY');
    if (!sheet) return { error: 'CAPACITY sheet not found' };

    var all = sheet.getDataRange().getValues();
    var MONTH_ABBR = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

    // ── Weekly summary rows (cols A–G, rows 2+) ──────────────
    var weeklyRows = [];
    for (var r = 1; r < all.length; r++) {
      var wkRaw = all[r][0];
      var wkStr = (wkRaw instanceof Date) ? '' : String(wkRaw || '').trim();
      // Detect a week-range string: contains a dash/em-dash between two date fragments
      if (!wkStr) continue;
      var hasRange = /[–\-]/.test(wkStr) && /[A-Za-z]/.test(wkStr);
      if (!hasRange) continue;
      var target     = safeNum(all[r][1]);
      var currentAvg = safeNum(all[r][2]);
      var gap        = safeNum(all[r][3]);
      var capPct     = safeNum(all[r][4]);
      var dpdWow     = safeNum(all[r][5]);
      var wowPct     = safeNum(all[r][6]);
      weeklyRows.push({ week: wkStr, target: target, currentAvg: currentAvg,
                        gap: gap, capPct: capPct, dpdWow: dpdWow, wowPct: wowPct });
    }

    // ── Daily forecast pairs (horizontal layout further in sheet) ──
    function parseCapDate(v) {
      if (v instanceof Date && !isNaN(v.getTime())) {
        return v.getFullYear()+'-'+pad2(v.getMonth()+1)+'-'+pad2(v.getDate());
      }
      var s = String(v||'').trim();
      var m = s.match(/([A-Za-z]{3})\s+(\d+)[,\s]+(\d{2,4})/);
      if (!m) return null;
      var mo = MONTH_ABBR[m[1].toLowerCase()];
      if (mo === undefined) return null;
      var yr = parseInt(m[3]); if (yr < 100) yr += 2000;
      return yr+'-'+pad2(mo+1)+'-'+pad2(parseInt(m[2]));
    }

    var byDate = {};
    for (var r2 = 0; r2 < all.length; r2++) {
      var row = all[r2];
      for (var c = 0; c + 1 < row.length; c += 2) {
        var ds = parseCapDate(row[c]);
        if (!ds) continue;
        var n = safeNum(row[c+1]);
        if (n > 0) byDate[ds] = n;
      }
    }

    var entries = Object.keys(byDate).sort().map(function(d) {
      return { dateStr: d, forecast: byDate[d] };
    });
    return { entries: entries, weeklyRows: weeklyRows };
  } catch(e) {
    return { error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// DELIVERIES — reads DELIVERIES sheet (actual daily deliveries)
// Layout: multiple column pairs segregated by month.
//   Col A = dates for Jan, Col B = deliveries for Jan
//   Col C = dates for Feb, Col D = deliveries for Feb  …etc.
// Row 1 may contain month/year header labels — skipped.
// ════════════════════════════════════════════════════════════
function getDeliveriesData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('DELIVERIES');
    if (!sheet) return { records: [] };

    var all = sheet.getDataRange().getValues();
    var records = [];
    var seen = {};

    // Each even column (0,2,4,…) = date; next column = delivery count
    for (var r = 1; r < all.length; r++) {
      var row = all[r];
      for (var c = 0; c + 1 < row.length; c += 2) {
        var dv = row[c], cv = row[c + 1];
        if (!dv) continue;
        var ds = null;
        if (dv instanceof Date && !isNaN(dv.getTime())) {
          ds = dv.getFullYear()+'-'+pad2(dv.getMonth()+1)+'-'+pad2(dv.getDate());
        } else {
          var s2 = String(dv).trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s2)) ds = s2.substring(0,10);
        }
        if (!ds || seen[ds]) continue;
        var n2 = safeNum(cv);
        if (n2 > 0) { records.push({ dateStr: ds, actual: n2 }); seen[ds] = true; }
      }
    }
    return { records: records };
  } catch(e) {
    return { error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// WRITE-BACK — add/update an actual delivery record
// dateStr: 'YYYY-MM-DD', count: number
// ════════════════════════════════════════════════════════════
function addDeliveryRecord(dateStr, count) {
  try {
    var ss    = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('DELIVERIES');
    if (!sheet) throw new Error('DELIVERIES sheet not found');

    var parts = dateStr.split('-');
    var dateObj = parts.length === 3
      ? new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]))
      : null;
    // Month index determines which column pair to append to if not found (Jan=0→colA,B; Feb=1→colC,D…)
    var targetMonth = dateObj ? dateObj.getMonth() : -1;

    var all = sheet.getDataRange().getValues();

    // Search all date cells (even-indexed columns) for a matching date
    for (var r = 1; r < all.length; r++) {
      var row = all[r];
      for (var c = 0; c + 1 < row.length; c += 2) {
        var dv = row[c];
        var ds = null;
        if (dv instanceof Date && !isNaN(dv.getTime())) {
          ds = dv.getFullYear()+'-'+pad2(dv.getMonth()+1)+'-'+pad2(dv.getDate());
        } else {
          var s3 = String(dv||'').trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s3)) ds = s3.substring(0,10);
        }
        if (ds === dateStr) {
          sheet.getRange(r + 1, c + 2).setValue(Number(count));
          SpreadsheetApp.flush();
          return { ok: true };
        }
      }
    }

    // Not found — append to the correct month's column pair
    var colBase = targetMonth >= 0 ? targetMonth * 2 : 0; // 0-indexed start column
    var lastRow = 0;
    for (var r2 = 1; r2 < all.length; r2++) {
      if (all[r2][colBase]) lastRow = r2;
    }
    sheet.getRange(lastRow + 2, colBase + 1, 1, 2).setValues([[dateObj || dateStr, Number(count)]]);
    SpreadsheetApp.flush();
    return { ok: true };
  } catch(e) {
    throw new Error('addDeliveryRecord: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// FORECAST sheet — Col A=Date, B=Forecast, C=Actual Delivery, D=%
// ════════════════════════════════════════════════════════════
function getForecastData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('FORECAST');
    if (!sheet) return { records: [] };
    var all = sheet.getDataRange().getValues();
    var records = [];
    for (var r = 1; r < all.length; r++) {
      var dv = all[r][0];
      if (!dv) continue;
      var ds = null;
      if (dv instanceof Date && !isNaN(dv.getTime())) {
        ds = dv.getFullYear()+'-'+pad2(dv.getMonth()+1)+'-'+pad2(dv.getDate());
      } else {
        var sv = String(dv).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(sv)) ds = sv.substring(0, 10);
      }
      if (!ds) continue;
      records.push({
        dateStr:  ds,
        forecast: safeNum(all[r][1]),
        actual:   safeNum(all[r][2]),
        pct:      safeNum(all[r][3])
      });
    }
    return { records: records };
  } catch(e) {
    return { records: [] };
  }
}

// ════════════════════════════════════════════════════════════
// WRITE — actual to DELIVERIES + upsert FORECAST sheet
// ════════════════════════════════════════════════════════════
function saveDeliveryWithForecast(dateStr, count, forecast) {
  try {
    // 1. Write actual to DELIVERIES sheet (existing logic)
    addDeliveryRecord(dateStr, count);

    // 2. Upsert FORECAST sheet
    var ss    = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('FORECAST');
    if (!sheet) {
      sheet = ss.insertSheet('FORECAST');
      sheet.getRange(1, 1, 1, 4).setValues([['Date','Forecast','Actual Delivery','%']]);
    }
    var all  = sheet.getDataRange().getValues();
    var parts = dateStr.split('-');
    var dateObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    var pct = (forecast > 0 && count > 0) ? Math.round(count / forecast * 100) : 0;

    for (var r = 1; r < all.length; r++) {
      var dv = all[r][0], ds = null;
      if (dv instanceof Date && !isNaN(dv.getTime())) {
        ds = dv.getFullYear()+'-'+pad2(dv.getMonth()+1)+'-'+pad2(dv.getDate());
      } else {
        var sv2 = String(dv||'').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(sv2)) ds = sv2.substring(0,10);
      }
      if (ds === dateStr) {
        var existFcst = safeNum(all[r][1]);
        var useFcst   = forecast > 0 ? forecast : (existFcst > 0 ? existFcst : 0);
        var newPct    = (useFcst > 0 && count > 0) ? Math.round(count / useFcst * 100) : 0;
        sheet.getRange(r+1, 1, 1, 4).setValues([[dateObj, useFcst, count, newPct]]);
        SpreadsheetApp.flush();
        return { ok: true };
      }
    }
    // Not found — append
    sheet.appendRow([dateObj, forecast || '', count, pct]);
    SpreadsheetApp.flush();
    _invalidateCache();
    return { ok: true };
  } catch(e) {
    throw new Error('saveDeliveryWithForecast: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════
// LOGISTICS — UPDATES sheet, cols A (week label) + H–J (vehicle counts)
// Row 1 = headers; Chiller Vans=H, 3-Ton Trucks=I, Cafe Vans=J
// ════════════════════════════════════════════════════════════
function getLogisticsData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('UPDATES');
    if (!sheet) return { rows: [] };
    var all = sheet.getDataRange().getValues();
    var rows = [];
    for (var r = 1; r < all.length; r++) {
      var wk  = String(all[r][0] || '').trim();
      if (!wk) continue;
      var cv  = safeNum(all[r][7]);  // H = Chiller Vans
      var tv  = safeNum(all[r][8]);  // I = 3-Ton Trucks
      var cfv = safeNum(all[r][9]);  // J = Cafe Vans
      if (cv === 0 && tv === 0 && cfv === 0) continue;
      rows.push({ week: wk, chillerVans: cv, trucks: tv, cafeVans: cfv });
    }
    return { rows: rows };
  } catch(e) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════
// LOGISTICS STAFF — "Logistics" sheet in SS_COMPLAINTS
// Row 1 = headers; Col A=Date, B=Vans, C=3 Ton Truck, D=Truck Driver,
// E=Cafe Van, F=Helper, G=Supply Chain Truck, H=Total Staff, I=Delivery
//
// Columns are resolved by reading the header row rather than by fixed
// position, so inserting or reordering a column in the sheet no longer
// silently feeds the wrong figure to a tile. The positional defaults
// below are only used if a header cannot be matched.
// ════════════════════════════════════════════════════════════
function getLogisticsStaffData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('Logistics');
    if (!sheet) return { rows: [] };
    var all = sheet.getDataRange().getValues();
    if (all.length < 2) return { rows: [] };

    // Match each output field to its column by header name.
    var HEADER_MAP = [
      { key: 'chillerVan',       fallback: 1, names: ['vans','van','chiller van','chiller vans'] },
      { key: 'truck3ton',        fallback: 2, names: ['3 ton truck','3 ton trucks','3ton truck','three ton truck'] },
      { key: 'truckDriver',      fallback: 3, names: ['truck driver','truck drivers'] },
      { key: 'cafeVan',          fallback: 4, names: ['cafe van','cafe vans','café van'] },
      { key: 'helper',           fallback: 5, names: ['helper','helpers'] },
      { key: 'supplyChainTruck', fallback: 6, names: ['supply chain truck','supply chain trucks','supplychain truck'] },
      { key: 'totalStaff',       fallback: 7, names: ['total staff','total staffs'] },
      { key: 'delivery',         fallback: 8, names: ['delivery','deliveries','total delivery','total deliveries'] },
      // Cost columns (K–M) feed the Logistics cost page.
      { key: 'vanCost',          fallback: 10, names: ['van cost','vans cost','van costs'] },
      { key: 'truckCost',        fallback: 11, names: ['truck cost','trucks cost','truck costs'] },
      { key: 'helperCost',       fallback: 12, names: ['helper cost','helpers cost','helper costs'] }
    ];
    var normHdr = function(v){ return String(v == null ? '' : v).trim().replace(/\s+/g,' ').toLowerCase(); };
    var hdr = (all[0] || []).map(normHdr);
    var colOf = {};
    HEADER_MAP.forEach(function(f){
      var idx = -1;
      for (var i = 0; i < hdr.length; i++) {
        if (hdr[i] && f.names.indexOf(hdr[i]) !== -1) { idx = i; break; }
      }
      colOf[f.key] = (idx !== -1) ? idx : f.fallback;
    });

    var rows = [];
    for (var r = 1; r < all.length; r++) {
      var dv = all[r][0];
      if (!dv) continue;
      var ds = null;
      if (dv instanceof Date && !isNaN(dv.getTime())) {
        ds = dv.getFullYear()+'-'+pad2(dv.getMonth()+1)+'-'+pad2(dv.getDate());
      } else {
        var dp = String(dv).split(/[\/\-]/);
        if (dp.length >= 3) ds = (dp[2].length===4?dp[2]:dp[0])+'-'+pad2(parseInt(dp[1],10))+'-'+pad2(parseInt(dp[0],10));
      }
      if (!ds) continue;
      rows.push({
        ds:               ds,
        chillerVan:       safeNum(all[r][colOf.chillerVan]),
        truck3ton:        safeNum(all[r][colOf.truck3ton]),
        truckDriver:      safeNum(all[r][colOf.truckDriver]),
        cafeVan:          safeNum(all[r][colOf.cafeVan]),
        helper:           safeNum(all[r][colOf.helper]),
        supplyChainTruck: safeNum(all[r][colOf.supplyChainTruck]),
        totalStaff:       safeNum(all[r][colOf.totalStaff]),
        delivery:         safeNum(all[r][colOf.delivery]),
        vanCost:          safeNum(all[r][colOf.vanCost]),
        truckCost:        safeNum(all[r][colOf.truckCost]),
        helperCost:       safeNum(all[r][colOf.helperCost])
      });
    }
    // Diagnostics: what the header row looked like and which column each
    // field resolved to, so a mis-located column is visible on the page
    // instead of silently reading as zero.
    var colLetter = function(i){
      var s = '', n = i;
      while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
      return s;
    };
    var resolved = {};
    Object.keys(colOf).forEach(function(k){
      resolved[k] = { index: colOf[k], letter: colLetter(colOf[k]), header: hdr[colOf[k]] || '' };
    });
    return {
      rows: rows,
      meta: {
        sheetName:   sheet.getName(),
        lastColumn:  sheet.getLastColumn(),
        lastColLetter: colLetter(sheet.getLastColumn() - 1),
        headers:     hdr,
        resolved:    resolved
      }
    };
  } catch(e) { return { rows: [], error: e.message }; }
}

// ════════════════════════════════════════════════════════════
// LOGISTICS INVOICES — supplier invoices, one row per line item
// Sheet "LOGISTICS INVOICES" in SS_COMPLAINTS, created on first save.
// Several invoices may share a month; each keeps its own id so it can be
// listed and removed on its own.
// ════════════════════════════════════════════════════════════
var SHEET_LOGISTICS_INV = 'LOGISTICS INVOICES';
var LOGISTICS_INV_HEADERS = ['Invoice ID','Month','Supplier','Invoice No','Invoice Date',
  'Currency','Line Item','Net Amount','VAT','Line Total','Saved At','Saved By','File URL',
  'Invoice Net','Invoice VAT','Invoice Total','Category'];

function _ensureLogisticsInvSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_LOGISTICS_INV);
  if (!sh) {
    sh = ss.insertSheet(SHEET_LOGISTICS_INV);
    sh.getRange(1, 1, 1, LOGISTICS_INV_HEADERS.length).setValues([LOGISTICS_INV_HEADERS]);
    sh.getRange(1, 1, 1, LOGISTICS_INV_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // "2026-07" is a date as far as Sheets is concerned; left as a date the
  // month can never be matched back to the page's YYYY-MM again.
  try { sh.getRange('B:B').setNumberFormat('@'); } catch (e) {}
  // Sheets created before the invoice-level total columns existed.
  try {
    if (sh.getLastColumn() < LOGISTICS_INV_HEADERS.length) {
      sh.getRange(1, 1, 1, LOGISTICS_INV_HEADERS.length).setValues([LOGISTICS_INV_HEADERS]);
      sh.getRange(1, 1, 1, LOGISTICS_INV_HEADERS.length).setFontWeight('bold');
    }
  } catch (e) {}
  return sh;
}

// Accepts whatever the Month cell turned into and returns YYYY-MM.
function _normYm_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + pad2(v.getMonth() + 1);
  var t = String(v == null ? '' : v).trim();
  var m = t.match(/^(\d{4})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(parseInt(m[2], 10));
  var d = new Date(t);
  if (!isNaN(d.getTime())) return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  return t;
}

// Maps an invoice line to one of the five cost components. Anything that
// matches none of them is "other", which counts as variable — adjustments and
// one-off charges behave like variable spend, not like the fixed fleet.
function _invCategory_(desc) {
  var d = String(desc || '').toLowerCase();
  if (/fuel|diesel|petrol/.test(d))            return 'fuel';
  if (/salik|toll/.test(d))                    return 'salik';
  if (/helper/.test(d))                        return 'helpers';
  if (/truck/.test(d))                         return 'trucks';
  if (/van/.test(d))                           return 'vans';
  return 'other';
}
function _invIsFixedCat_(c) { return c === 'vans' || c === 'trucks' || c === 'helpers'; }

// ── numeric helpers shared by the parser ──────────────────────
function _invNum_(s) {
  if (s === null || s === undefined) return null;
  var t = String(s).replace(/[^0-9.\-]/g, '');
  if (t === '' || t === '-' || t === '.') return null;
  var n = parseFloat(t);
  return isNaN(n) ? null : n;
}
function _invIsAmountLine_(l) { return /^-?[\d,]+\.\d{1,2}$/.test(l); }
function _invAmountsOn_(l) {
  var m = l.match(/-?[\d,]+\.\d{1,2}/g);
  return m ? m.map(_invNum_).filter(function(n){ return n !== null; }) : [];
}

// ── Parse the text of a supplier invoice into a draft ─────────
// Deliberately conservative: anything it cannot read becomes a warning shown
// on the confirm screen rather than a silently wrong number.
function parseLogisticsInvoiceText(text) {
  var warnings = [];
  var raw = String(text || '').replace(/ /g, ' ');
  var lines = raw.split(/\r?\n/).map(function(s){ return s.trim(); });

  var invoiceNo = '', invoiceDate = '', supplier = '', currency = 'AED';

  var mNo = raw.match(/#\s*(INV[-\s]?[A-Za-z0-9\-\/]+)/i);
  if (mNo) invoiceNo = mNo[1].replace(/\s+/g, '-').toUpperCase();

  var mDate = raw.match(/Invoice\s*Date\s*[:\-]?\s*([0-9]{1,2}\s+[A-Za-z]{3,}\s+[0-9]{4})/i);
  if (mDate) invoiceDate = mDate[1];

  if (/\bAED\b/.test(raw)) currency = 'AED';
  else if (/\bQAR\b/.test(raw)) currency = 'QAR';
  else if (/\bSAR\b/.test(raw)) currency = 'SAR';

  // ── Supplier ────────────────────────────────────────────────
  // The vendor block sits above "TAX INVOICE" and above "Bill To".
  // Both anchors are tried because PDF-to-text conversions order the page
  // differently depending on how the original was laid out.
  var isLabel = function(L){ return L.indexOf(':') > -1 || /^POWERED BY/i.test(L); };
  var isNoise = function(L){
    return /@|www\.|\.com|^TRN\b|^VAT\b|United Arab Emirates|^P\.?O\.?\s*Box|^Tel\b|^Phone\b/i.test(L);
  };
  var takeNameFrom = function(idx){
    var block = [];
    for (var j = idx - 1; j >= 0 && block.length < 10; j--) {
      var L = lines[j];
      if (L === '') continue;
      if (isLabel(L)) break;
      block.unshift(L);
    }
    var name = [];
    for (var k = 0; k < block.length; k++) {
      var b = block[k];
      if (isNoise(b)) break;
      if (k > 0 && !/^(LLC|L\.L\.C\.?|FZE|FZCO|WLL|W\.L\.L\.?|LTD|CO\.?)$/i.test(b) && name.length >= 1
          && /[-,\/]|Cluster|Street|Road|Dubai|Abu Dhabi|Sharjah|Ajman/i.test(b)) break;
      name.push(b);
      if (name.length >= 3) break;
    }
    return name.join(' ').replace(/\s+/g, ' ').trim();
  };
  for (var t = 0; t < lines.length && !supplier; t++) {
    if (/TAX\s*INVOICE/i.test(lines[t])) supplier = takeNameFrom(t);
  }
  if (!supplier) {
    for (var t2 = 0; t2 < lines.length && !supplier; t2++) {
      if (/^Bill\s*To\b/i.test(lines[t2])) supplier = takeNameFrom(t2);
    }
  }
  if (!supplier) {
    // Last resort: the first company-looking line on the page.
    for (var t3 = 0; t3 < Math.min(lines.length, 40); t3++) {
      if (/(LLC|L\.L\.C|FZE|FZCO|W\.?L\.?L\.?|LTD)\s*$/i.test(lines[t3]) && !isLabel(lines[t3])) {
        supplier = lines[t3].trim(); break;
      }
    }
  }

  if (!supplier)    warnings.push('Supplier name could not be read — please type it in.');
  if (!invoiceNo)   warnings.push('Invoice number could not be read — please type it in.');
  if (!invoiceDate) warnings.push('Invoice date could not be read — please pick it.');

  // ── Line items ──────────────────────────────────────────────
  // The invoice's own totals are extracted first: they are the oracle the
  // line reading is checked against.
  var subTotal = null, vatTotal = null, grandTotal = null;
  var mSub = raw.match(/Sub\s*Total\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i);
  if (mSub) { subTotal = _invNum_(mSub[1]); vatTotal = _invNum_(mSub[2]); grandTotal = _invNum_(mSub[3]); }
  if (subTotal === null || vatTotal === null) {
    var mTax = raw.match(/Standard\s*Rate\s*\([\d.]+%\)\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i);
    if (mTax) { if (subTotal === null) subTotal = _invNum_(mTax[1]); if (vatTotal === null) vatTotal = _invNum_(mTax[2]); }
  }
  if (grandTotal === null) {
    var mBal = raw.match(/Balance\s*Due\s*[A-Z]{0,3}\s*([\d,]+\.\d{2})/i);
    if (mBal) grandTotal = _invNum_(mBal[1]);
  }
  if (grandTotal === null && subTotal !== null && vatTotal !== null) grandTotal = subTotal + vatTotal;

  // Item headers are numbered 1, 2, 3 … The number may share a line with the
  // description or sit on its own, depending on whether the converter kept the
  // invoice table. Requiring the next expected number rejects the hundreds of
  // "11650 184.8" toll rows and lines like "18 helpers- *1800".
  var starts = [], expected = 1;
  for (var a = 0; a < lines.length; a++) {
    var L2 = lines[a];
    var inline = L2.match(/^(\d{1,2})\s+([A-Za-z#].*)$/);
    if (inline && parseInt(inline[1], 10) === expected) {
      starts.push({ i: a, name: inline[2].trim() }); expected++; continue;
    }
    if (/^\d{1,2}$/.test(L2) && parseInt(L2, 10) === expected) {
      for (var nx = a + 1; nx < Math.min(a + 4, lines.length); nx++) {
        if (lines[nx] === '') continue;
        if (/^[A-Za-z#]/.test(lines[nx])) { starts.push({ i: a, name: lines[nx].trim() }); expected++; }
        break;
      }
    }
  }

  // Each item's block, reduced to an ordered run of amounts and rate markers.
  var TOKEN = /(\d{1,2}(?:\.\d{1,2})?\s*%)|(-?[\d,]*\d\.\d{1,2})/g;
  // The last item ends where the invoice's summary begins. Without this the
  // final block swallows Sub Total and Balance Due, and their figures get read
  // as if they were that item's own.
  // Searched only after the last item begins: these invoices print "Balance
  // Due" in the header too, and anchoring on that would put the summary
  // before every item and disable the bound entirely.
  var summaryAt = lines.length;
  var lastStart = starts.length ? starts[starts.length - 1].i : 0;
  for (var sIdx = lastStart + 1; sIdx < lines.length; sIdx++) {
    if (/^(sub\s*total|balance\s*due|tax\s*summary|total\s+AED)/i.test(lines[sIdx])) { summaryAt = sIdx; break; }
  }
  var blocks = [];
  for (var b2 = 0; b2 < starts.length; b2++) {
    var from = starts[b2].i;
    var to = (b2 + 1 < starts.length) ? starts[b2 + 1].i : lines.length;
    if (from < summaryAt && to > summaryAt) to = summaryAt;
    var toks = [], m2;
    for (var li = from; li < to; li++) {
      TOKEN.lastIndex = 0;
      while ((m2 = TOKEN.exec(lines[li])) !== null) {
        if (m2[1]) toks.push({ pct: true });
        else toks.push({ n: _invNum_(m2[2]) });
      }
    }
    blocks.push({ name: String(starts[b2].name || '')
                          .replace(/(\s+\d[\d,\.]{2,})+\s*$/, '')
                          .replace(/\s+/g, ' ').trim(), toks: toks });
  }

  // Three ways of reading a block. Which one is right depends on how the
  // converter laid the table out, so rather than assume, all three are tried
  // and the one whose line totals reconcile with the invoice is kept.
  function readBlock(bk, mode) {
    var toks = bk.toks, nums = [], pctAt = -1, i2;
    for (i2 = 0; i2 < toks.length; i2++) {
      if (toks[i2].pct) { if (pctAt < 0) pctAt = nums.length; }
      else nums.push(toks[i2].n);
    }
    if (!nums.length) return null;
    var total = null, tax = null;
    if (mode === 'afterRate') {
      if (pctAt < 0 || pctAt >= nums.length) return null;
      total = nums[pctAt];
      tax = pctAt > 0 ? nums[pctAt - 1] : null;
    } else if (mode === 'lastTwo') {
      total = nums[nums.length - 1];
      tax = nums.length > 1 ? nums[nums.length - 2] : null;
    } else { // largest
      var bi = 0;
      for (i2 = 1; i2 < nums.length; i2++) if (nums[i2] > nums[bi]) bi = i2;
      total = nums[bi];
      tax = bi > 0 ? nums[bi - 1] : null;
    }
    if (total === null) return null;
    if (tax !== null && total < tax) { var t3 = total; total = tax; tax = t3; }
    var taxable = (tax !== null) ? (total - tax) : total;
    return {
      category: _invCategory_(bk.name),
      description: bk.name || 'Line item',
      taxable: Math.round(taxable * 100) / 100,
      vat: tax === null ? 0 : Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100
    };
  }

  // Some converters keep each item's figures beside its description; others
  // (Drive's, for these invoices) print every description first, then every
  // "qty rate taxable tax rate%" row, then every line total. Block-based
  // reading cannot work on the second kind, because item 1's figures land
  // after item 2's description.
  //
  // What holds in both: the two amounts immediately before a rate marker are
  // that line's taxable amount and its tax, and the rate markers occur in item
  // order. Pairing those with the item names in order reads either layout.
  function readByRateMarkers() {
    var toks = [], m3;
    for (var li2 = 0; li2 < Math.min(summaryAt, lines.length); li2++) {
      TOKEN.lastIndex = 0;
      while ((m3 = TOKEN.exec(lines[li2])) !== null) {
        if (m3[1]) toks.push({ pct: true });
        else toks.push({ n: _invNum_(m3[2]) });
      }
    }
    var figures = [];
    for (var k3 = 0; k3 < toks.length; k3++) {
      if (!toks[k3].pct) continue;
      var pair = [];
      for (var j3 = k3 - 1; j3 >= 0 && pair.length < 2; j3--) {
        if (toks[j3].n !== undefined) pair.push(toks[j3].n);
      }
      if (pair.length < 2) continue;
      var tax3 = pair[0], taxable3 = pair[1];
      figures.push({ taxable: Math.round(taxable3 * 100) / 100,
                     vat: Math.round(tax3 * 100) / 100,
                     total: Math.round((taxable3 + tax3) * 100) / 100 });
    }
    var out3 = [];
    var n3 = Math.min(figures.length, blocks.length);
    for (var q3 = 0; q3 < n3; q3++) {
      out3.push({ category: _invCategory_(blocks[q3].name),
                  description: blocks[q3].name || ('Line ' + (q3 + 1)),
                  taxable: figures[q3].taxable, vat: figures[q3].vat, total: figures[q3].total });
    }
    return out3;
  }

  var best = null;
  var pairRead = readByRateMarkers();
  if (pairRead.length) {
    var pairSum = 0;
    pairRead.forEach(function(x){ pairSum += x.total; });
    pairSum = Math.round(pairSum * 100) / 100;
    best = { mode: 'rateMarkers', items: pairRead, sum: pairSum, count: pairRead.length,
             full: pairRead.length >= blocks.length,
             err: (grandTotal !== null) ? Math.abs(pairSum - grandTotal) : 0 };
  }

  ['afterRate', 'lastTwo', 'largest'].forEach(function(mode){
    var its = [];
    for (var k2 = 0; k2 < blocks.length; k2++) {
      var it2 = readBlock(blocks[k2], mode);
      if (it2) its.push(it2);
    }
    var sum2 = 0;
    its.forEach(function(x){ sum2 += x.total; });
    sum2 = Math.round(sum2 * 100) / 100;
    var err = (grandTotal !== null) ? Math.abs(sum2 - grandTotal) : (its.length ? 0 : Infinity);
    var cand = { mode: mode, items: its, sum: sum2, err: err, count: its.length,
                 full: its.length >= blocks.length };
    if (!best) { best = cand; return; }
    // A reading that recovers every line beats one that merely adds up.
    if (cand.full !== best.full) { if (cand.full) best = cand; return; }
    if (cand.err < best.err - 0.005) best = cand;
    else if (Math.abs(cand.err - best.err) <= 0.005 && cand.count > best.count) best = cand;
  });

  var items = best ? best.items : [];
  var readMode = best ? best.mode : 'none';

  var sumTotal = 0, sumTaxable = 0;
  items.forEach(function(it){ sumTotal += it.total; sumTaxable += it.taxable; });
  sumTotal = Math.round(sumTotal * 100) / 100;
  sumTaxable = Math.round(sumTaxable * 100) / 100;

  var biggest = 0;
  items.forEach(function(it){ if (it.total > biggest) biggest = it.total; });
  if (grandTotal && items.length && (items.length < 3 || biggest > grandTotal * 0.7)) {
    warnings.push('The reader only recovered ' + items.length + ' line'
      + (items.length === 1 ? '' : 's') + ' from this invoice'
      + (biggest > grandTotal * 0.7 ? ', one of them holding most of the total' : '')
      + '. The breakdown is unreliable — open "Show the text read from the PDF" below and send that text so '
      + 'the reader can be fixed for this layout.');
  }
  var bad = items.filter(function(it){ return it.taxable < 0; });
  if (bad.length) {
    warnings.push(bad.length + ' line' + (bad.length === 1 ? '' : 's') + ' came out with a negative net amount ('
      + bad.map(function(b){ return b.description; }).join(', ') + ') — those were misread. '
      + 'The invoice total below is still correct; fix or delete those lines.');
  }
  if (!items.length) warnings.push('No line items were recognised — add them by hand below, and send me the extracted text so the reader can be tuned.');
  if (grandTotal !== null && items.length && Math.abs(sumTotal - grandTotal) > 1) {
    warnings.push('Line items add up to ' + sumTotal.toFixed(2) + ' but the invoice total reads '
      + grandTotal.toFixed(2) + ' — check the lines below.');
  }
  if (subTotal !== null && items.length && Math.abs(sumTaxable - subTotal) > 1) {
    warnings.push('Net line amounts add up to ' + sumTaxable.toFixed(2)
      + ' but the invoice sub-total reads ' + subTotal.toFixed(2) + '.');
  }

  var ym = '';
  if (invoiceDate) {
    var d = new Date(invoiceDate);
    if (!isNaN(d.getTime())) ym = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  return {
    supplier: supplier, invoiceNo: invoiceNo, invoiceDate: invoiceDate, ym: ym, currency: currency,
    items: items, subTotal: subTotal, vatTotal: vatTotal, grandTotal: grandTotal,
    sumTotal: sumTotal, sumTaxable: sumTaxable, warnings: warnings, readMode: readMode,
    diag: { headersFound: starts.length, blocks: blocks.length, lines: lines.length,
            headerNames: starts.map(function(x){ return x.name; }).slice(0, 12) },
    rawText: raw.length > 12000 ? raw.substring(0, 12000) + '\n… (truncated)' : raw
  };
}

// ── PDF → text, via Drive's PDF-to-Doc conversion (with OCR) ───
// Uses the Drive REST API with the script's own OAuth token, so the Advanced
// Drive Service does not need enabling by hand. DriveApp is referenced when
// filing the original, which is what grants the Drive scope.
function _ocrPdfToText_(blob, name) {
  var token = ScriptApp.getOAuthToken();
  var boundary = '-----UMPInvoiceBoundary' + Date.now();
  var meta = { name: 'ump-ocr-' + (name || 'invoice'), mimeType: 'application/vnd.google-apps.document' };

  var pre = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
          + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: application/pdf\r\n\r\n';
  var post = '\r\n--' + boundary + '--\r\n';
  var payload = Utilities.newBlob(pre).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob(post).getBytes());

  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=en',
    { method: 'post', contentType: 'multipart/related; boundary=' + boundary,
      payload: payload, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });

  if (res.getResponseCode() >= 300) {
    throw new Error('Could not convert the PDF (Drive said ' + res.getResponseCode() + '). '
      + 'Re-authorise the script from the Apps Script editor and try again.');
  }
  var fileId = JSON.parse(res.getContentText()).id;
  var text = '';
  try {
    text = DocumentApp.openById(fileId).getBody().getText();
  } finally {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  }
  return text;
}

// Converts a file already in Drive, so the PDF bytes cross the network once
// instead of being uploaded again just to be read.
function _ocrDriveFileToText_(fileId, name) {
  var token = ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?ocrLanguage=en',
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ name: 'ump-ocr-' + (name || 'invoice'),
                                mimeType: 'application/vnd.google-apps.document' }),
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) {
    throw new Error('Could not convert the PDF (Drive said ' + res.getResponseCode() + ').');
  }
  var docId = JSON.parse(res.getContentText()).id;
  var text = '';
  try { text = DocumentApp.openById(docId).getBody().getText(); }
  finally { try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {} }
  return text;
}

// Keeps the original PDFs together so a saved figure can be traced back.
function _umpInvoiceFolder_() {
  var it = DriveApp.getFoldersByName('UMP Logistics Invoices');
  return it.hasNext() ? it.next() : DriveApp.createFolder('UMP Logistics Invoices');
}

// ── Called from the page: read an uploaded PDF into a draft ────
function parseLogisticsInvoiceUpload(base64, filename) {
  try {
    var bytes = Utilities.base64Decode(base64);
    var blob  = Utilities.newBlob(bytes, 'application/pdf', filename || 'invoice.pdf');

    // File it once, then convert that copy in place. Falls back to sending the
    // bytes again only if filing failed.
    var stored = null, storedId = null;
    try {
      var f = _umpInvoiceFolder_().createFile(blob);
      stored = f.getUrl(); storedId = f.getId();
    } catch (e) { /* filing is a convenience; never block the parse on it */ }

    var text = storedId ? _ocrDriveFileToText_(storedId, filename)
                        : _ocrPdfToText_(blob, filename);
    var draft = parseLogisticsInvoiceText(text);
    draft.fileUrl = stored;
    draft.ok = true;
    if (!text || !text.replace(/\s/g, '')) {
      draft.warnings.push('No text came back from the PDF at all — it may be a scan of an image.');
    }
    return draft;
  } catch (e) {
    return { ok: false, error: e.message, warnings: [], items: [] };
  }
}

// Re-reads an invoice from the PDF already filed in Drive. Rows saved by an
// earlier version of the reader carry its mistakes; this re-parses them with
// the current one without the PDF being uploaded again.
function _driveIdFromUrl_(url) {
  var m = String(url || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

// Re-reads every stored invoice that still has its PDF, a few at a time so a
// run stays inside the Apps Script time limit. The caller repeats while
// "remaining" is above zero.
function reparseAllStoredInvoices(max) {
  max = max || 3;
  var res = { ok: true, build: UMP_BUILD, updated: [], skipped: [], failed: [], remaining: 0 };
  try {
    var ss = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sh = ss.getSheetByName(SHEET_LOGISTICS_INV);
    if (!sh) return { ok: false, error: 'No LOGISTICS INVOICES sheet found.' };

    var all = sh.getDataRange().getValues();
    var seen = {}, list = [];
    for (var r = 1; r < all.length; r++) {
      var id = String(all[r][0] || '');
      if (!id || seen[id]) continue;
      seen[id] = 1;
      list.push({ id: id, ym: _normYm_(all[r][1]), supplier: String(all[r][2] || ''),
                  invoiceNo: String(all[r][3] || ''), currency: String(all[r][5] || 'AED'),
                  fileUrl: String(all[r][12] || '') });
    }

    var done = 0;
    for (var i = 0; i < list.length; i++) {
      var inv = list[i];
      if (!inv.fileUrl) { res.skipped.push(inv.invoiceNo || inv.id); continue; }
      if (done >= max) { res.remaining++; continue; }
      try {
        var d = reparseStoredInvoice(inv.fileUrl);
        if (!d || !d.ok || !d.items || !d.items.length) {
          res.failed.push((inv.invoiceNo || inv.id) + ': ' + ((d && d.error) || 'no line items recovered'));
          done++; continue;
        }
        // Remove the old rows first so a blank invoice number cannot leave a
        // duplicate behind.
        _deleteInvoiceRows_(sh, inv.id, inv.supplier, inv.invoiceNo);
        var sv = saveLogisticsInvoice({
          ym: inv.ym || d.ym, supplier: d.supplier || inv.supplier,
          invoiceNo: d.invoiceNo || inv.invoiceNo, invoiceDate: d.invoiceDate || '',
          currency: d.currency || inv.currency, items: d.items, fileUrl: inv.fileUrl,
          replace: true, invoiceNet: d.subTotal, invoiceVat: d.vatTotal, invoiceTotal: d.grandTotal
        });
        if (sv && sv.ok) res.updated.push((inv.invoiceNo || inv.id) + ' (' + d.items.length + ' lines)');
        else res.failed.push((inv.invoiceNo || inv.id) + ': ' + ((sv && sv.error) || 'save failed'));
        done++;
      } catch (e) {
        res.failed.push((inv.invoiceNo || inv.id) + ': ' + e.message);
        done++;
      }
    }
    _invalidateCache();
    return res;
  } catch (e) { return { ok: false, error: e.message }; }
}

function reparseStoredInvoice(fileUrl) {
  try {
    var id = _driveIdFromUrl_(fileUrl);
    if (!id) {
      return { ok: false, warnings: [], items: [],
               error: 'No stored PDF is linked to this invoice — add it again instead.' };
    }
    var text  = _ocrDriveFileToText_(id, 'reread');
    var draft = parseLogisticsInvoiceText(text);
    draft.fileUrl = fileUrl;
    draft.ok = true;
    return draft;
  } catch (e) {
    return { ok: false, warnings: [], items: [], error: e.message };
  }
}

function saveLogisticsInvoice(payload) {
  try {
    if (!payload) throw new Error('Nothing to save.');
    var items = (payload.items || []).filter(function(it){
      return String(it.description || '').trim() !== '' || _invNum_(it.total) !== null;
    });
    if (!items.length) throw new Error('Add at least one line item before saving.');
    if (!payload.ym) throw new Error('Pick the month this invoice belongs to.');

    var ss = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sh = _ensureLogisticsInvSheet_(ss);
    var all = sh.getDataRange().getValues();

    var supplier  = String(payload.supplier  || '').trim();
    var invoiceNo = String(payload.invoiceNo || '').trim();

    // An edit or re-read names the rows it is replacing, so the old ones go
    // even when the invoice number is blank or has changed.
    if (payload.replaceId) {
      try { _deleteInvoiceRows_(sh, payload.replaceId, supplier, invoiceNo); } catch (e) {}
      all = sh.getDataRange().getValues();
    }

    // Same supplier + invoice number already stored? Replace it rather than
    // silently double-counting the month.
    var dupId = null;
    for (var r = 1; r < all.length; r++) {
      if (String(all[r][2]).trim().toLowerCase() === supplier.toLowerCase() &&
          String(all[r][3]).trim().toLowerCase() === invoiceNo.toLowerCase() && invoiceNo) {
        dupId = String(all[r][0]); break;
      }
    }
    if (dupId && !payload.replace) {
      return { ok: false, duplicate: true,
               error: 'Invoice ' + invoiceNo + ' from ' + supplier + ' is already saved.' };
    }
    if (dupId) _deleteInvoiceRows_(sh, dupId);

    var id = 'INV' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    var now = new Date();
    var who = '';
    try { who = Session.getActiveUser().getEmail() || ''; } catch (e) {}

    // The invoice's own stated totals are authoritative. Line items are a
    // breakdown and may be read imperfectly; the bill's own Sub Total is a
    // single figure and is what the cost must be based on.
    var sumNet = 0, sumVat = 0, sumTot = 0;
    items.forEach(function(it){
      var n = _invNum_(it.taxable) || 0, v = _invNum_(it.vat) || 0;
      var t = _invNum_(it.total); if (t === null) t = n + v;
      sumNet += n; sumVat += v; sumTot += t;
    });
    var hdrNet = _invNum_(payload.invoiceNet);
    var hdrVat = _invNum_(payload.invoiceVat);
    var hdrTot = _invNum_(payload.invoiceTotal);
    if (hdrTot === null || hdrTot <= 0) { hdrNet = sumNet; hdrVat = sumVat; hdrTot = sumTot; }
    if (hdrNet === null) hdrNet = hdrTot - (hdrVat || 0);
    if (hdrVat === null) hdrVat = hdrTot - hdrNet;

    var rows = items.map(function(it){
      var net = _invNum_(it.taxable), vat = _invNum_(it.vat), tot = _invNum_(it.total);
      if (tot === null) tot = (net || 0) + (vat || 0);
      if (net === null) net = tot - (vat || 0);
      return [id, payload.ym, supplier, invoiceNo, payload.invoiceDate || '',
              payload.currency || 'AED', String(it.description || '').trim(),
              net, vat || 0, tot, now, who, payload.fileUrl || '',
              hdrNet, hdrVat, hdrTot,
              String(it.category || _invCategory_(it.description))];
    });
    var startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 2, rows.length, 1).setNumberFormat('@');
    sh.getRange(startRow, 1, rows.length, LOGISTICS_INV_HEADERS.length).setValues(rows);
    _invalidateCache();
    return { ok: true, id: id, lines: rows.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Returns how many rows were removed so the caller can tell "deleted" from
// "matched nothing" — the two used to be indistinguishable.
function _deleteInvoiceRows_(sh, id, supplier, invoiceNo) {
  var all = sh.getDataRange().getValues();
  var want = String(id == null ? '' : id).trim();
  var wSup = String(supplier || '').trim().toLowerCase();
  var wNo  = String(invoiceNo || '').trim().toLowerCase();
  var removed = 0;
  for (var r = all.length - 1; r >= 1; r--) {
    var rowId = String(all[r][0] == null ? '' : all[r][0]).trim();
    var hit = (want !== '' && rowId === want);
    // Fall back to supplier + invoice number so a row whose id no longer
    // lines up can still be removed rather than being stuck on the page.
    if (!hit && wNo !== '') {
      hit = (String(all[r][3] || '').trim().toLowerCase() === wNo) &&
            (wSup === '' || String(all[r][2] || '').trim().toLowerCase() === wSup);
    }
    if (hit) { sh.deleteRow(r + 1); removed++; }
  }
  return removed;
}

function deleteLogisticsInvoice(id, supplier, invoiceNo) {
  try {
    var ss = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sh = ss.getSheetByName(SHEET_LOGISTICS_INV);
    if (!sh) return { ok: false, removed: 0, error: 'The LOGISTICS INVOICES sheet was not found.' };
    var removed = _deleteInvoiceRows_(sh, id, supplier, invoiceNo);
    _invalidateCache();
    if (!removed) {
      return { ok: false, removed: 0,
               error: 'Nothing matched that invoice in the sheet (id ' + id + ').' };
    }
    return { ok: true, removed: removed };
  } catch (e) {
    return { ok: false, removed: 0, error: e.message };
  }
}

// Grouped back into invoices for the page.
function getLogisticsInvoiceData() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(_CACHE_INV);
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  try {
    var ss = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sh = ss.getSheetByName(SHEET_LOGISTICS_INV);
    if (!sh) return { invoices: [] };
    var all = sh.getDataRange().getValues();
    if (all.length < 2) return { invoices: [] };

    var byId = {}, order = [];
    for (var r = 1; r < all.length; r++) {
      var id = String(all[r][0] || '');
      if (!id) continue;
      if (!byId[id]) {
        var dv = all[r][4], ds = '';
        if (dv instanceof Date && !isNaN(dv.getTime())) {
          ds = dv.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dv.getMonth()] + ' ' + dv.getFullYear();
        } else { ds = String(dv || ''); }
        byId[id] = { id: id, ym: _normYm_(all[r][1]), supplier: String(all[r][2] || ''),
                     invoiceNo: String(all[r][3] || ''), invoiceDate: ds,
                     currency: String(all[r][5] || 'AED'), items: [],
                     net: 0, vat: 0, total: 0,
                     sumNet: 0, sumVat: 0, sumTotal: 0,
                     hdrNet: safeNum(all[r][13]), hdrVat: safeNum(all[r][14]), hdrTotal: safeNum(all[r][15]),
                     savedBy: String(all[r][11] || ''), fileUrl: String(all[r][12] || '') };
        order.push(id);
      }
      var inv = byId[id];
      var net = safeNum(all[r][7]), vat = safeNum(all[r][8]), tot = safeNum(all[r][9]);
      var cat = String(all[r][16] || '').trim().toLowerCase();
      if (!cat) cat = _invCategory_(all[r][6]);
      inv.items.push({ description: String(all[r][6] || ''), taxable: net, vat: vat, total: tot, category: cat });
      inv.sumNet += net; inv.sumVat += vat; inv.sumTotal += tot;
    }
    var out = order.map(function(id){
      var v = byId[id];
      var rd = function(n){ return Math.round(n * 100) / 100; };
      v.sumNet = rd(v.sumNet); v.sumVat = rd(v.sumVat); v.sumTotal = rd(v.sumTotal);
      // Prefer the invoice's own totals; fall back to the line sum for rows
      // saved before those columns existed.
      var useHdr = v.hdrTotal > 0;
      v.net   = rd(useHdr ? v.hdrNet   : v.sumNet);
      v.vat   = rd(useHdr ? v.hdrVat   : v.sumVat);
      v.total = rd(useHdr ? v.hdrTotal : v.sumTotal);
      v.fromHeader = useHdr;
      v.linesMismatch = (v.sumTotal > 0 && Math.abs(v.sumTotal - v.total) > 1);
      return v;
    });
    var payload = { invoices: out, build: UMP_BUILD };
    try {
      var j = JSON.stringify(payload);
      if (j.length <= 90000) cache.put(_CACHE_INV, j, _CACHE_TTL);
    } catch (e) {}
    return payload;
  } catch (e) { return { invoices: [], error: e.message }; }
}

// ════════════════════════════════════════════════════════════
// WOW DISTRICT — WOW DISTRICT sheet (read-only summary)
// Row 1 = headers (Col A = week range, remaining = district acronyms)
// ════════════════════════════════════════════════════════════
function getWowDistrictData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('WOW DISTRICT');
    if (!sheet) return { headers: [], rows: [] };
    var all = sheet.getDataRange().getValues();
    if (all.length < 2) return { headers: [], rows: [] };
    var hdr = (all[0] || []).slice(1).map(function(h){ return String(h||'').trim(); });
    var rows = [];
    for (var r = 1; r < all.length; r++) {
      var wk = String(all[r][0] || '').trim();
      if (!wk) continue;
      var vals = [];
      for (var c = 1; c <= hdr.length; c++) vals.push(all[r][c] !== undefined ? all[r][c] : null);
      rows.push({ week: wk, values: vals });
    }
    return { headers: hdr, rows: rows };
  } catch(e) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════
// DISTRICT DELIVERIES — editable daily delivery by district
// Row 1 = headers (Col A = date, remaining = districts + Total)
// ════════════════════════════════════════════════════════════
function getDistrictDeliveriesData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('DISTRICT DELIVERIES');
    if (!sheet) return { headers: [], rows: [] };
    var all = sheet.getDataRange().getValues();
    if (all.length < 2) return { headers: [], rows: [] };
    var fullHdr = (all[0] || []).map(function(h){ return String(h||'').trim(); });

    // Only read up to and including the first 'Total' column to avoid duplicate summary columns
    var endCol = fullHdr.length;
    for (var c = 1; c < fullHdr.length; c++) {
      if (fullHdr[c].toLowerCase() === 'total') { endCol = c + 1; break; }
    }
    var hdr = fullHdr.slice(1, endCol); // district headers (no date col)

    var rows = [];
    for (var r = 1; r < all.length; r++) {
      var dv = all[r][0];
      if (!dv) continue;
      var ds = null;
      if (dv instanceof Date && !isNaN(dv.getTime())) {
        ds = dv.getFullYear()+'-'+pad2(dv.getMonth()+1)+'-'+pad2(dv.getDate());
      } else {
        ds = String(dv).trim();
        if (!ds) continue;
      }
      var vals = [];
      for (var c2 = 1; c2 < endCol; c2++) vals.push(safeNum(all[r][c2]));
      rows.push({ dateStr: ds, values: vals, sheetRow: r + 1 });
    }
    return { headers: hdr, rows: rows };
  } catch(e) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════
// WRITE-BACK — update Target DPD in CAPACITY sheet (Col B)
// weekStr: week range text matching Col A, e.g. "Jun 1 – Jun 7"
// ════════════════════════════════════════════════════════════
function updateCapacityTarget(weekStr, newTarget) {
  try {
    var ss    = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('CAPACITY');
    if (!sheet) throw new Error('CAPACITY sheet not found');
    var all = sheet.getDataRange().getValues();
    for (var r = 1; r < all.length; r++) {
      if (String(all[r][0]||'').trim() === weekStr) {
        sheet.getRange(r + 1, 2).setValue(Number(newTarget));
        SpreadsheetApp.flush();
        _invalidateCache();
        return { ok: true };
      }
    }
    throw new Error('Week row not found: ' + weekStr);
  } catch(e) { throw new Error('updateCapacityTarget: ' + e.message); }
}

// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// DISTRICT SHIFTS — Early Morning / Morning / Evening per district,
// plus one note per day. Held on its own sheet so DISTRICT DELIVERIES keeps
// its existing shape; the district figures there stay authoritative and are
// rewritten from the shift totals whenever a day is saved.
// ════════════════════════════════════════════════════════════
var SHEET_DISTRICT_SHIFTS = 'DISTRICT SHIFTS';
var DISTRICT_SHIFT_NAMES  = ['Evening', 'Morning', 'Early Morning'];

function _shiftKey_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function _isShiftWord_(s) {
  var k = _shiftKey_(s);
  return k === 'evening' || k === 'morning' || k === 'early morning';
}

// Districts are whatever DISTRICT DELIVERIES lists, minus its Total column,
// so the two sheets cannot drift apart.
function _districtNames_(ss) {
  var d = getDistrictDeliveriesData(ss);
  return (d.headers || []).filter(function(h){ return h.toLowerCase().indexOf('total') === -1; });
}

// Reads whatever header shape the sheet already uses rather than imposing one.
// The sheet in use carries the district on row 1 and the shift on row 2, with
// data from row 3; a single header row is also accepted.
function _dsLayout_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var top = sh.getRange(1, 1, Math.min(2, Math.max(sh.getLastRow(), 1)), lastCol).getValues();
  var row1 = top[0] || [];
  var row2 = top.length > 1 ? top[1] : [];

  var twoRow = false;
  for (var c = 1; c < lastCol; c++) { if (_isShiftWord_(row2[c])) { twoRow = true; break; } }

  var colOf = {}, notesCol = -1;
  // A merged district cell reports its value only in the first column of the
  // merge, so the last district seen carries forward across its shifts.
  var carry = '';
  for (var c2 = 1; c2 < lastCol; c2++) {   // column A is the date
    var a = String(row1[c2] == null ? '' : row1[c2]).trim();
    var b = twoRow ? String(row2[c2] == null ? '' : row2[c2]).trim() : '';
    if (a) carry = a;
    var combined = twoRow ? (_shiftKey_(carry) + ' ' + _shiftKey_(b)).trim() : _shiftKey_(a);
    if (!combined) continue;
    if (combined.indexOf('note') > -1 || combined.indexOf('remark') > -1 || combined.indexOf('comment') > -1) {
      if (notesCol === -1) notesCol = c2;
      continue;
    }
    if (colOf[combined] === undefined) colOf[combined] = c2;
  }
  return { twoRow: twoRow, dataStart: twoRow ? 3 : 2, colOf: colOf, notesCol: notesCol, lastCol: lastCol };
}

function _ensureDistrictShiftSheet_(ss, districts) {
  var sh = ss.getSheetByName(SHEET_DISTRICT_SHIFTS);
  if (sh) return sh;               // an existing sheet is used exactly as it stands
  sh = ss.insertSheet(SHEET_DISTRICT_SHIFTS);
  var r1 = ['Date'], r2 = [''];
  districts.forEach(function(d){
    DISTRICT_SHIFT_NAMES.forEach(function(sn, i){ r1.push(i === 0 ? d : ''); r2.push(sn); });
  });
  r1.push('Notes'); r2.push('');
  sh.getRange(1, 1, 1, r1.length).setValues([r1]).setFontWeight('bold');
  sh.getRange(2, 1, 1, r2.length).setValues([r2]).setFontWeight('bold');
  sh.setFrozenRows(2);
  sh.setFrozenColumns(1);
  return sh;
}

function _normDateStr_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  }
  var t = String(v == null ? '' : v).trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.substring(0, 10);
  // M/D/YYYY as the sheet displays it
  var m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + pad2(parseInt(m[1], 10)) + '-' + pad2(parseInt(m[2], 10));
  var d = new Date(t);
  if (!isNaN(d.getTime())) return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  return t.substring(0, 10);
}

function getDistrictShiftData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sh = ss.getSheetByName(SHEET_DISTRICT_SHIFTS);
    if (!sh) return { byDate: {}, shifts: DISTRICT_SHIFT_NAMES };
    var lay = _dsLayout_(sh);
    var all = sh.getDataRange().getValues();
    if (all.length < lay.dataStart) return { byDate: {}, shifts: DISTRICT_SHIFT_NAMES, layout: lay.twoRow ? 'two-row' : 'single-row' };

    var byDate = {};
    for (var r = lay.dataStart - 1; r < all.length; r++) {
      var ds = _normDateStr_(all[r][0]);
      if (!ds) continue;
      var rec = { values: {}, notes: lay.notesCol > -1 ? String(all[r][lay.notesCol] || '') : '', sheetRow: r + 1 };
      for (var key in lay.colOf) {
        if (!lay.colOf.hasOwnProperty(key)) continue;
        rec.values[key] = safeNum(all[r][lay.colOf[key]]);
      }
      byDate[ds] = rec;
    }
    return { byDate: byDate, shifts: DISTRICT_SHIFT_NAMES, layout: lay.twoRow ? 'two-row' : 'single-row' };
  } catch (e) { return { byDate: {}, shifts: DISTRICT_SHIFT_NAMES, error: e.message }; }
}

// Saves a day's shift figures exactly as entered, into whatever columns the
// sheet already has, and mirrors the summed district totals into DISTRICT
// DELIVERIES. A district whose three shifts are all blank is left alone there
// rather than being overwritten with a zero.
function saveDistrictShiftRow(payload) {
  try {
    if (!payload || !payload.dateStr) throw new Error('No date given.');
    var ss = SpreadsheetApp.openById(SS_COMPLAINTS);
    var districts = _districtNames_(ss);
    var sh = _ensureDistrictShiftSheet_(ss, districts);
    var lay = _dsLayout_(sh);

    var all = sh.getDataRange().getValues();
    var target = -1;
    for (var r = lay.dataStart - 1; r < all.length; r++) {
      if (_normDateStr_(all[r][0]) === payload.dateStr) { target = r + 1; break; }
    }
    if (target === -1) {
      target = Math.max(sh.getLastRow() + 1, lay.dataStart);
      var parts = payload.dateStr.split('-');
      sh.getRange(target, 1).setValue(
        new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
    }

    var vals = payload.values || {};
    var totals = [], unmatched = [];
    districts.forEach(function(d){
      var sum = 0, touched = false;
      DISTRICT_SHIFT_NAMES.forEach(function(sn){
        var key = _shiftKey_(d + ' ' + sn);
        var raw = vals[key];
        var n = safeNum(raw);
        sum += n;
        if (raw !== undefined && raw !== null && String(raw) !== '') touched = true;
        var col = lay.colOf[key];
        if (col !== undefined) sh.getRange(target, col + 1).setValue(n);
        else unmatched.push(d + ' ' + sn);
      });
      totals.push({ district: d, total: sum, touched: touched });
    });

    if (lay.notesCol > -1) {
      sh.getRange(target, lay.notesCol + 1).setValue(String(payload.notes || ''));
    } else if (payload.notes) {
      // No notes column in the sheet — add one rather than dropping the note.
      var at = sh.getLastColumn() + 1;
      sh.getRange(1, at).setValue('Notes').setFontWeight('bold');
      sh.getRange(target, at).setValue(String(payload.notes));
      lay.notesCol = at - 1;
    }

    var mirrored = 0;
    if (payload.sheetRow) {
      var dd = ss.getSheetByName('DISTRICT DELIVERIES');
      if (dd) {
        var ddHdr = dd.getRange(1, 1, 1, Math.max(dd.getLastColumn(), 1)).getValues()[0];
        for (var t = 0; t < totals.length; t++) {
          if (!totals[t].touched && totals[t].total === 0) continue;
          for (var c3 = 1; c3 < ddHdr.length; c3++) {
            if (_shiftKey_(ddHdr[c3]) === _shiftKey_(totals[t].district)) {
              dd.getRange(payload.sheetRow, c3 + 1).setValue(totals[t].total);
              mirrored++;
              break;
            }
          }
        }
      }
    }

    SpreadsheetApp.flush();
    _invalidateCache();
    return { ok: true, totals: totals, mirrored: mirrored, row: target,
             layout: lay.twoRow ? 'two-row' : 'single-row',
             unmatched: unmatched.slice(0, 8), unmatchedCount: unmatched.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// WRITE-BACK — update a DISTRICT DELIVERIES row
// sheetRow: 1-based row number; colIdxs: 1-based col numbers; values: matching array
// ════════════════════════════════════════════════════════════
function updateDistrictRow(sheetRow, colIdxs, values) {
  try {
    var ss    = SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('DISTRICT DELIVERIES');
    if (!sheet) throw new Error('DISTRICT DELIVERIES sheet not found');
    for (var i = 0; i < colIdxs.length; i++) {
      sheet.getRange(sheetRow, colIdxs[i]).setValue(Number(values[i]));
    }
    SpreadsheetApp.flush();
    _invalidateCache();
    return { ok: true };
  } catch(e) { throw new Error('updateDistrictRow: ' + e.message); }
}

function pad2(n){ return String(n).length===1?'0'+n:String(n); }

// ── HELPERS ───────────────────────────────────────────────────
function safeNum(v) {
  var s = String(v || '').replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtCellDate(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    try {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), 'd MMM EEE');
    } catch(e) {
      return Utilities.formatDate(val, 'Asia/Dubai', 'd MMM EEE');
    }
  }
  return String(val || '').trim();
}

// ── ACCESS CONTROL ───────────────────────────────────────────
// Sheet: "Access Control" in SS_FINANCIAL
// Columns: A=Email  B=Password  C=Role  D=ResetToken  E=ResetExpiry  F=Status
// Roles: super-admin | admin | editor | viewer
// Status: approved (all users); sheet is auto-migrated on first call
var SUPER_ADMINS = ['k.lanot@calo.app', 'a.mohamed@calo.app'];

function _isSuperAdmin(email) {
  return SUPER_ADMINS.indexOf((email||'').trim().toLowerCase()) >= 0;
}

function _acSheet() {
  var ss = SpreadsheetApp.openById(SS_FINANCIAL);
  var sh = ss.getSheetByName('Access Control');
  if (!sh) {
    // Brand-new sheet — create with headers and seed Super Admins
    sh = ss.insertSheet('Access Control');
    sh.appendRow(['Email','Password','Role','ResetToken','ResetExpiry','Status']);
    SUPER_ADMINS.forEach(function(e) {
      sh.appendRow([e, '', 'super-admin', '', '', 'approved']);
    });
    return sh;
  }

  // Migrate existing sheet: add Status column if missing, fix Super Admin roles
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var hasStatus = headers.indexOf('Status') >= 0;
  if (!hasStatus) {
    var statusCol = sh.getLastColumn() + 1;
    sh.getRange(1, statusCol).setValue('Status');
    var lastRow = sh.getLastRow();
    if (lastRow > 1) {
      for (var r = 2; r <= lastRow; r++) {
        sh.getRange(r, statusCol).setValue('approved');
      }
    }
  }

  // Upgrade Super Admin role in sheet if still 'admin'
  var allVals = sh.getDataRange().getValues();
  for (var i = 1; i < allVals.length; i++) {
    var rowEmail = String(allVals[i][0]||'').trim().toLowerCase();
    var rowRole  = String(allVals[i][2]||'').trim();
    if (_isSuperAdmin(rowEmail) && rowRole !== 'super-admin') {
      sh.getRange(i+1, 3).setValue('super-admin');
    }
  }

  return sh;
}

// Register — auto-approved as Viewer (@calo.app only)
function registerUser(email, password) {
  try {
    email = (email||'').trim().toLowerCase();
    if (!email.endsWith('@calo.app')) return {ok:false, err:'Only @calo.app emails are allowed.'};
    if (!password || password.length < 6) return {ok:false, err:'Password must be at least 6 characters.'};
    var sheet = _acSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]||'').trim().toLowerCase() === email) {
        return {ok:false, err:'This email is already registered.'};
      }
    }
    var role = _isSuperAdmin(email) ? 'super-admin' : 'viewer';
    sheet.appendRow([email, password, role, '', '', 'approved']);
    return {ok:true, role:role, email:email};
  } catch(e) { return {ok:false, err:e.message}; }
}

// Get all users — Super Admin only
function getUsers(callerEmail) {
  try {
    if (!_isSuperAdmin((callerEmail||'').trim().toLowerCase())) return {ok:false, err:'Not authorized.'};
    var sheet = _acSheet();
    var rows = sheet.getDataRange().getValues();
    // Determine which column is Status (may be col 5 or 6 depending on migration)
    var headers = rows[0];
    var statusIdx = headers.indexOf('Status');
    if (statusIdx < 0) statusIdx = 5;
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var e = String(rows[i][0]||'').trim().toLowerCase();
      if (!e) continue;
      out.push({
        email:    e,
        role:     String(rows[i][2]||'viewer').trim(),
        status:   String(rows[i][statusIdx]||'approved').trim() || 'approved',
        hasPass:  !!(String(rows[i][1]||'').trim()),
        password: String(rows[i][1]||'').trim(),
        hasToken: !!(String(rows[i][3]||'').trim())
      });
    }
    return {ok:true, users:out};
  } catch(e) { return {ok:false, err:e.message}; }
}

// Update a user's role — Super Admin only; cannot change other Super Admins
function updateUserRole(callerEmail, targetEmail, newRole) {
  try {
    if (!_isSuperAdmin(callerEmail)) return {ok:false, err:'Not authorized.'};
    targetEmail = (targetEmail||'').trim().toLowerCase();
    // Super Admins can change any role including super-admin
    var sheet = _acSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]||'').trim().toLowerCase() !== targetEmail) continue;
      sheet.getRange(i+1,3).setValue((newRole||'viewer').trim());
      return {ok:true};
    }
    return {ok:false, err:'User not found.'};
  } catch(e) { return {ok:false, err:e.message}; }
}

// Remove a user — Super Admin only; cannot remove Super Admins
function removeUser(callerEmail, targetEmail) {
  try {
    if (!_isSuperAdmin(callerEmail)) return {ok:false, err:'Not authorized.'};
    targetEmail = (targetEmail||'').trim().toLowerCase();
    if (_isSuperAdmin(targetEmail)) return {ok:false, err:'Cannot remove a Super Admin.'};
    var sheet = _acSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]||'').trim().toLowerCase() !== targetEmail) continue;
      sheet.deleteRow(i+1);
      return {ok:true};
    }
    return {ok:false, err:'User not found.'};
  } catch(e) { return {ok:false, err:e.message}; }
}

// User changes their own password
function changeOwnPassword(email, currentPass, newPass) {
  try {
    email = (email||'').trim().toLowerCase();
    if (!newPass || newPass.length < 6) return {ok:false, err:'New password must be at least 6 characters.'};
    var sheet = _acSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]||'').trim().toLowerCase() !== email) continue;
      var stored = String(rows[i][1]||'').trim();
      if (stored && stored !== currentPass) return {ok:false, err:'Current password is incorrect.'};
      sheet.getRange(i+1,2).setValue(newPass);
      return {ok:true};
    }
    return {ok:false, err:'User not found.'};
  } catch(e) { return {ok:false, err:e.message}; }
}

function checkLogin(email, password) {
  try {
    var sheet = _acSheet(); // also runs migration (adds Status col, upgrades SA roles)
    var rows  = sheet.getDataRange().getValues();
    var headers = rows[0];
    var statusIdx = headers.indexOf('Status');
    if (statusIdx < 0) statusIdx = 5;
    for (var i = 1; i < rows.length; i++) {
      var rowEmail  = String(rows[i][0] || '').trim().toLowerCase();
      var rowPass   = String(rows[i][1] || '').trim();
      var rowRole   = String(rows[i][2] || 'viewer').trim();
      var rowStatus = String(rows[i][statusIdx] || 'approved').trim() || 'approved';
      if (!rowEmail) continue;
      if (rowEmail !== email.trim().toLowerCase()) continue;
      if (rowStatus === 'rejected') return {ok:false, err:'Your access has been revoked. Contact your administrator.'};
      // New user — no password set yet
      if (!rowPass) return {ok: false, newUser: true, email: rowEmail};
      if (rowPass === password) return {ok: true, role: rowRole, email: rowEmail};
      return {ok: false};
    }
    return {ok: false};
  } catch(e) {
    return {ok: false, err: e.message};
  }
}

// Add a user by email — Super Admin only; user sets their own password on first login
function addUserByAdmin(callerEmail, targetEmail) {
  try {
    if (!_isSuperAdmin((callerEmail||'').trim().toLowerCase())) return {ok:false, err:'Not authorized.'};
    targetEmail = (targetEmail||'').trim().toLowerCase();
    if (!targetEmail.endsWith('@calo.app')) return {ok:false, err:'Only @calo.app emails are allowed.'};
    var sheet = _acSheet();
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]||'').trim().toLowerCase() === targetEmail) {
        return {ok:false, err:'This email is already in the system.'};
      }
    }
    var role = _isSuperAdmin(targetEmail) ? 'super-admin' : 'viewer';
    sheet.appendRow([targetEmail, '', role, '', '', 'approved']);
    return {ok:true, email:targetEmail};
  } catch(e) { return {ok:false, err:e.message}; }
}

// Called when a new user sets their password for the first time
function setPassword(email, newPass) {
  try {
    if (!newPass || newPass.length < 6) return {ok: false, err: 'Password must be at least 6 characters.'};
    var sheet = _acSheet();
    var rows  = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var rowEmail = String(rows[i][0] || '').trim().toLowerCase();
      if (rowEmail !== email.trim().toLowerCase()) continue;
      var rowPass = String(rows[i][1] || '').trim();
      if (rowPass) return {ok: false, err: 'Password already set. Use Forgot Password to reset.'};
      sheet.getRange(i + 1, 2).setValue(newPass); // col B
      // Mark as approved when setting password for first time (Super Admin pre-seeded users)
      if (!String(rows[i][5]||'').trim()) sheet.getRange(i+1,6).setValue('approved');
      var rowRole = String(rows[i][2] || 'viewer').trim();
      return {ok: true, role: rowRole, email: rowEmail};
    }
    return {ok: false, err: 'Email not found.'};
  } catch(e) {
    return {ok: false, err: e.message};
  }
}

// Sends a password-reset email with a 1-hour token
function sendPasswordReset(email) {
  try {
    var sheet = _acSheet();
    var rows  = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var rowEmail = String(rows[i][0] || '').trim().toLowerCase();
      if (rowEmail !== email.trim().toLowerCase()) continue;
      // Generate token
      var token   = Utilities.getUuid();
      var expiry  = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      sheet.getRange(i + 1, 4).setValue(token);  // col D
      sheet.getRange(i + 1, 5).setValue(expiry.toISOString()); // col E
      // Build reset link — get the deployed web app URL
      var appUrl  = ScriptApp.getService().getUrl();
      var link    = appUrl + '?reset=' + token;
      MailApp.sendEmail({
        to: rowEmail,
        subject: 'CALO UMP Dashboard — Password Reset',
        htmlBody:
          '<p>Hi,</p>' +
          '<p>Click the link below to reset your password. This link expires in 1 hour.</p>' +
          '<p><a href="' + link + '" style="background:#00C07F;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset My Password</a></p>' +
          '<p>If you did not request this, ignore this email.</p>' +
          '<p>— CALO UMP Operations Dashboard</p>'
      });
      return {ok: true};
    }
    // Always return ok to avoid email enumeration
    return {ok: true};
  } catch(e) {
    return {ok: false, err: e.message};
  }
}

// Sends a password-reset link for targetEmail TO the calling Super Admin's email
function sendPasswordResetToAdmin(callerEmail, targetEmail) {
  try {
    if (!_isSuperAdmin((callerEmail||'').trim().toLowerCase())) return {ok:false, err:'Not authorized.'};
    var sheet = _acSheet();
    var rows  = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var rowEmail = String(rows[i][0] || '').trim().toLowerCase();
      if (rowEmail !== (targetEmail||'').trim().toLowerCase()) continue;
      var token  = Utilities.getUuid();
      var expiry = new Date(Date.now() + 60 * 60 * 1000);
      sheet.getRange(i + 1, 4).setValue(token);
      sheet.getRange(i + 1, 5).setValue(expiry.toISOString());
      var appUrl = ScriptApp.getService().getUrl();
      var link   = appUrl + '?reset=' + token;
      MailApp.sendEmail({
        to: callerEmail.trim().toLowerCase(),
        subject: 'CALO UMP — Password Reset Link for ' + targetEmail,
        htmlBody:
          '<p>Hi Super Admin,</p>' +
          '<p>Here is the password reset link for <strong>' + targetEmail + '</strong>. Share it with the user or use it to set their password. Expires in 1 hour.</p>' +
          '<p><a href="' + link + '" style="background:#00C07F;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password for ' + targetEmail + '</a></p>' +
          '<p>— CALO UMP Operations Dashboard</p>'
      });
      return {ok: true};
    }
    return {ok: false, err: 'User not found.'};
  } catch(e) { return {ok: false, err: e.message}; }
}

// Validates a reset token, returns email if valid
function validateResetToken(token) {
  try {
    if (!token) return {ok: false};
    var sheet = _acSheet();
    var rows  = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var storedToken = String(rows[i][3] || '').trim();
      var expiryStr   = String(rows[i][4] || '').trim();
      if (storedToken !== token) continue;
      if (!expiryStr) return {ok: false, err: 'Token invalid.'};
      if (new Date() > new Date(expiryStr)) return {ok: false, err: 'Reset link has expired. Please request a new one.'};
      return {ok: true, email: String(rows[i][0]).trim().toLowerCase()};
    }
    return {ok: false, err: 'Invalid or expired reset link.'};
  } catch(e) {
    return {ok: false, err: e.message};
  }
}

// Sets a new password using a valid reset token
function resetPasswordWithToken(token, newPass) {
  try {
    if (!newPass || newPass.length < 6) return {ok: false, err: 'Password must be at least 6 characters.'};
    var sheet = _acSheet();
    var rows  = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var storedToken = String(rows[i][3] || '').trim();
      var expiryStr   = String(rows[i][4] || '').trim();
      if (storedToken !== token) continue;
      if (!expiryStr || new Date() > new Date(expiryStr)) return {ok: false, err: 'Reset link has expired.'};
      sheet.getRange(i + 1, 2).setValue(newPass); // col B — new password
      sheet.getRange(i + 1, 4).setValue('');      // col D — clear token
      sheet.getRange(i + 1, 5).setValue('');      // col E — clear expiry
      var rowRole = String(rows[i][2] || 'viewer').trim();
      return {ok: true, role: rowRole, email: String(rows[i][0]).trim().toLowerCase()};
    }
    return {ok: false, err: 'Invalid or expired reset link.'};
  } catch(e) {
    return {ok: false, err: e.message};
  }
}

// ── COMMENTS ─────────────────────────────────────────────────
// Sheet: "Comments" in SS_FINANCIAL
// Columns: A=Timestamp  B=Email  C=Page  D=Text
function getComments(page) {
  try {
    var ss    = SpreadsheetApp.openById(SS_FINANCIAL);
    var sheet = ss.getSheetByName('Comments');
    if (!sheet) return [];
    var rows  = sheet.getDataRange().getValues();
    var out   = [];
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][2]||'').trim().toLowerCase() !== (page||'').toLowerCase()) continue;
      out.push({time: rows[i][0], email: String(rows[i][1]||''), text: String(rows[i][3]||'')});
    }
    return out;
  } catch(e) { return []; }
}

function addComment(page, text) {
  try {
    if (!text || !text.trim()) return {ok: false, err: 'Empty comment.'};
    var email = Session.getActiveUser().getEmail();
    var ss    = SpreadsheetApp.openById(SS_FINANCIAL);
    var sheet = ss.getSheetByName('Comments');
    if (!sheet) {
      sheet = ss.insertSheet('Comments');
      sheet.appendRow(['Timestamp','Email','Page','Text']);
    }
    sheet.appendRow([new Date(), email, page||'', text.trim()]);
    return {ok: true};
  } catch(e) { return {ok: false, err: e.message}; }
}

function fmtMonthLabel(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    try {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), 'MMMM yyyy');
    } catch(e) {
      return Utilities.formatDate(val, 'Asia/Dubai', 'MMMM yyyy');
    }
  }
  return String(val || '').trim();
}
