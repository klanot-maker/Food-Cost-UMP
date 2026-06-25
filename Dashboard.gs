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
var _CACHE_OPS   = 'ump_ops_v1';
var _CACHE_TTL   = 300; // seconds (5 min)

function _invalidateCache() {
  try {
    var c = CacheService.getScriptCache();
    c.remove(_CACHE_CAP);
    c.remove(_CACHE_FIN);
    c.remove(_CACHE_STAFF);
    c.remove(_CACHE_OPS);
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
    districtDel: getDistrictDeliveriesData(ss)
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
    logisticsRows:      getLogisticsStaffData(ssC).rows || []
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
// Row 1 = headers; Col A=Delivery Date, B=Chiller Van, C=3 Ton Truck,
// D=Truck Driver, E=Cafe Van, F=Helper, G=Total Staff
// ════════════════════════════════════════════════════════════
function getLogisticsStaffData(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(SS_COMPLAINTS);
    var sheet = ss.getSheetByName('Logistics');
    if (!sheet) return { rows: [] };
    var all = sheet.getDataRange().getValues();
    if (all.length < 2) return { rows: [] };
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
        ds:          ds,
        chillerVan:  safeNum(all[r][1]),
        truck3ton:   safeNum(all[r][2]),
        truckDriver: safeNum(all[r][3]),
        cafeVan:     safeNum(all[r][4]),
        helper:      safeNum(all[r][5]),
        totalStaff:  safeNum(all[r][6])
      });
    }
    return { rows: rows };
  } catch(e) { return { rows: [], error: e.message }; }
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
          '<p><a href="' + link + '" style="background:#00B368;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset My Password</a></p>' +
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
          '<p><a href="' + link + '" style="background:#00B368;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password for ' + targetEmail + '</a></p>' +
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
