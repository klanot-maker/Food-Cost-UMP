// ============================================================
// KMP OPERATION DASHBOARD — Config.gs
// ============================================================
//
//  >>> THIS IS THE ONLY FILE YOUR MARKET NEEDS TO CHANGE. <<<
//
// Everything below describes ONE market: which spreadsheets it reads,
// what its money is called, and who administers it. Nothing here is
// logic — it is a list of facts about your operation.
//
// The other files (Dashboard.gs, Index, LiveDeliveryStats.gs,
// SlackMonthlySummary.gs) are the shared template. If you change those,
// you take ownership of them and future template fixes stop arriving
// cleanly. Put your own additions in a separate file instead.
//
// AFTER EDITING: run  cfgSelfTest()  from the Apps Script editor.
// It checks every id, opens every spreadsheet, and tells you in plain
// words what is wrong. Do that BEFORE deploying — a bad id here shows
// up as an empty dashboard, not as an error message.
//
// THIS IS THE TEMPLATE COPY. Every value below is a placeholder. Fill them
// in for your market, then run cfgSelfTest() — it opens every workbook and
// names anything that is wrong in plain words. Do that BEFORE deploying.
// ============================================================

var CFG = {

  // ── Who this dashboard is for ──────────────────────────────
  // Shown in the page title and the sidebar.
  market:  '',                 // e.g. 'Bahrain', 'KSA', 'Qatar', 'Kuwait'

  // Calo kitchen code for this market: AE001 (UAE), BH001 (Bahrain),
  // SA001 (KSA), QA001 (Qatar), KW001 (Kuwait).
  // Used by the live delivery figures. Leave '' if you are not using them.
  kitchen: '',

  // ── Money ──────────────────────────────────────────────────
  // Currency label shown on every figure in the dashboard.
  currency: '',                // e.g. 'BHD', 'SAR', 'QAR', 'KWD'

  // How many units of your currency make one US dollar.
  // The dashboard shows a USD figure beside each local one.
  //   AED 3.67   BHD 0.376   SAR 3.75   QAR 3.64   KWD 0.307
  fxToUsd: 0,

  // ── Where the data lives ───────────────────────────────────
  // The long id in the middle of a Google Sheets URL:
  //   docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
  //
  // UAE keeps these in three SEPARATE workbooks. If your market keeps
  // everything in ONE workbook, put the SAME id in all three lines — the
  // dashboard does not care how many files there are, only where each tab
  // lives. cfgSelfTest() will mention it and carry on.
  //
  // Use YOUR OWN workbooks. Pointing these at another market's files would
  // show you their operation, and would let anyone you give the dashboard
  // to read their numbers.
  src: {
    // Tabs expected: Financial cost, Access Control, Comments
    financial:  '',

    // Tabs expected: CAPACITY, DELIVERIES, DISTRICT DELIVERIES,
    // WOW DISTRICT, DOD Complaint, MOM Complaints, Logistics,
    // FORECAST, UPDATES, Comments, DISTRICT SHIFTS, LOGISTICS INVOICES
    complaints: '',

    // Tabs expected: one tab per staff month (names vary by market)
    staff:      '',

    // The gid of the "DOD Complaint" tab INSIDE the complaints workbook.
    // Open that tab and read the number after #gid= in the address bar.
    dodGid:     0
  },

  // ── Who can administer this dashboard ──────────────────────
  // These accounts always have full access, even if the Access Control
  // tab is empty or broken. Keep at least two, so one person leaving
  // cannot lock the market out.
  superAdmins: []              // e.g. ['you@calo.app', 'colleague@calo.app']
};


// ============================================================
// ACCESSORS — the rest of the project reads config through these.
// ------------------------------------------------------------
// Why functions and not plain constants: every .gs file in an Apps
// Script project shares one global space, and the ORDER the files load
// in is not guaranteed. A constant in one file that reads CFG from
// another can therefore run before CFG exists. A function body does not
// run until it is called, by which time every file has loaded. This is
// the same reason SlackMonthlySummary.gs resolves its id through a
// function rather than a constant.
// ============================================================

/** The config object, with a readable error if the file is missing. */
function _cfg_() {
  if (typeof CFG === 'undefined' || !CFG) {
    throw new Error('Config.gs is missing from this project. The dashboard ' +
                    'cannot run without it. Copy Config.gs from the template.');
  }
  return CFG;
}

/** One spreadsheet id, checked. Throws naming the exact setting at fault. */
function _cfgId_(which) {
  var src = _cfg_().src || {};
  var id  = src[which];
  if (!id || typeof id !== 'string' || id.length < 20) {
    throw new Error('Config.gs: src.' + which + ' is not set to a valid ' +
                    'spreadsheet id. Open Config.gs and paste the id from ' +
                    'that workbook\'s URL. Then run cfgSelfTest().');
  }
  return id;
}

function SS_FINANCIAL_()      { return _cfgId_('financial'); }
function SS_COMPLAINTS_()     { return _cfgId_('complaints'); }
function SS_STAFF_()          { return _cfgId_('staff'); }
function GID_DOD_COMPLAINT_() { return Number(_cfg_().src.dodGid || 0); }

function CFG_MARKET_()   { return String(_cfg_().market || 'KMP'); }
function CFG_KITCHEN_()  { return String(_cfg_().kitchen || ''); }
// These two fall back to something deliberately wrong-looking rather than to
// UAE's values. A dashboard quietly labelling Bahraini dinars as AED, and
// converting them at 3.67, would look entirely normal.
function CFG_CURRENCY_() { return String(_cfg_().currency || '???'); }
function CFG_FX_USD_()   { var n = Number(_cfg_().fxToUsd); return n > 0 ? n : 1; }

function CFG_SUPER_ADMINS_() {
  var list = _cfg_().superAdmins || [];
  return list.map(function(e) { return String(e || '').trim().toLowerCase(); })
             .filter(function(e) { return e; });
}

/** Everything the browser needs, handed to the page by doGet. */
function CFG_FOR_UI_() {
  return {
    market:   CFG_MARKET_(),
    currency: CFG_CURRENCY_(),
    fxToUsd:  CFG_FX_USD_(),
    kitchen:  CFG_KITCHEN_()
  };
}


// ============================================================
// cfgSelfTest — run this from the editor after editing Config.gs.
// It reports in plain words, and never changes anything.
// ============================================================
function cfgSelfTest() {
  var out = [], ok = true;
  function pass(m) { out.push('  OK    ' + m); }
  function fail(m) { out.push('  WRONG ' + m); ok = false; }
  function warn(m) { out.push('  note  ' + m); }

  out.push('KMP config check — ' + new Date());
  out.push('');

  // --- identity -------------------------------------------------
  try {
    var c = _cfg_();
    pass('Config.gs found.');
    if (c.market)   pass('Market: ' + c.market);
    else            fail('market is empty. Set it to your market name.');
    if (c.currency) pass('Currency: ' + c.currency + '   (1 USD = ' + CFG_FX_USD_() + ' ' + c.currency + ')');
    else            fail('currency is empty.');
    if (!c.kitchen) warn('kitchen is empty — live delivery stats will be off. Fine if you do not use them.');
    else            pass('Kitchen code: ' + c.kitchen);
  } catch (e) {
    fail(e.message);
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  // --- admins ---------------------------------------------------
  var admins = CFG_SUPER_ADMINS_();
  if (!admins.length)      fail('superAdmins is empty. Nobody could recover access if Access Control broke.');
  else if (admins.length < 2) warn('Only one super admin (' + admins[0] + '). Two is safer.');
  else                     pass(admins.length + ' super admins: ' + admins.join(', '));

  // --- the three workbooks -------------------------------------
  // Tabs the code looks up by exact name. The staff workbook has one tab
  // per month, and those names differ by market, so only that it opens
  // is checked here.
  var want = {
    financial:  ['Access Control'],
    complaints: ['CAPACITY', 'DELIVERIES', 'DISTRICT DELIVERIES', 'WOW DISTRICT',
                 'DOD Complaint', 'MOM Complaints', 'Logistics', 'FORECAST',
                 'UPDATES', 'DISTRICT SHIFTS', 'LOGISTICS INVOICES'],
    staff:      []
  };
  var seenIds = {};

  Object.keys(want).forEach(function(which) {
    out.push('');
    var id;
    try { id = _cfgId_(which); }
    catch (e) { fail(e.message); return; }

    if (seenIds[id]) warn('src.' + which + ' points at the same workbook as src.' + seenIds[id] + '. That is fine if your market keeps everything in one file.');
    else seenIds[id] = which;

    var ss;
    try { ss = SpreadsheetApp.openById(id); }
    catch (e) {
      fail('src.' + which + ': cannot open that workbook. Either the id is wrong, ' +
           'or this Google account has no access to it. (' + e.message + ')');
      return;
    }
    var wbName = ss.getName();
    pass('src.' + which + ' opens: "' + wbName + '"');

    // A workbook whose name does not mention this market is worth a second
    // look. Filling these ids in with whichever ones were to hand — another
    // market's, to see the dashboard working — produces a dashboard that
    // works perfectly and shows the wrong operation. Nothing about it looks
    // wrong, and the Edit buttons on every page write back to whatever is
    // configured here.
    var mk = String(_cfg_().market || '').trim();
    if (mk && wbName.toLowerCase().indexOf(mk.toLowerCase()) < 0) {
      warn('   "' + wbName + '" does not mention "' + mk + '". Check this is ' +
           'YOUR workbook and not one borrowed to get started — the dashboard ' +
           'reads AND writes to it.');
    }

    var have = ss.getSheets().map(function(s) { return s.getName(); });
    want[which].forEach(function(tab) {
      if (have.indexOf(tab) >= 0) pass('   tab "' + tab + '" found');
      else fail('   tab "' + tab + '" NOT FOUND in "' + ss.getName() + '". ' +
                'The dashboard reads tabs by exact name — rename it, or this ' +
                'section will show nothing with no error.');
    });
  });

  // --- which tab the financial reader will actually use ---------
  // getFinancialData asks for a tab called 'Financial cost' and SILENTLY
  // FALLS BACK to the first tab in the workbook when it is missing. UAE's
  // tab was called 'Summary' and ran on that fallback for a long time; it
  // was renamed in November 2026 so the lookup now succeeds by name. The
  // fallback remains the reason a market whose workbook opens on some other
  // tab can read it and show plausible-looking nonsense, so the tab that
  // will really be used is named explicitly here.
  out.push('');
  try {
    var ssF   = SpreadsheetApp.openById(_cfgId_('financial'));
    var named = ssF.getSheetByName('Financial cost');
    if (named) {
      pass('Financial figures will be read from tab "Financial cost".');
    } else {
      var first = ssF.getSheets()[0];
      warn('No tab called "Financial cost" — the reader falls back to the FIRST tab, ' +
           'which here is "' + first.getName() + '". Check that is the one holding ' +
           'revenue, wastage and other cost. If it is not, rename the correct tab ' +
           'to "Financial cost".');
    }
  } catch (e) { fail('Could not determine the financial tab: ' + e.message); }

  // --- the DOD gid ---------------------------------------------
  out.push('');
  try {
    var gid = GID_DOD_COMPLAINT_();
    if (!gid) {
      fail('src.dodGid is 0. Open the DOD Complaint tab and copy the number after #gid= in the URL.');
    } else {
      var ssC = SpreadsheetApp.openById(_cfgId_('complaints'));
      var match = ssC.getSheets().filter(function(s) { return s.getSheetId() === gid; });
      if (match.length) pass('src.dodGid ' + gid + ' points at tab "' + match[0].getName() + '"');
      else fail('src.dodGid ' + gid + ' does not match any tab in the complaints workbook.');
    }
  } catch (e) { fail('dodGid check failed: ' + e.message); }

  out.push('');
  out.push(ok ? '=== ALL CHECKS PASSED — safe to deploy. ==='
              : '=== PROBLEMS FOUND — fix the WRONG lines above before deploying. ===');

  var text = out.join('\n');
  Logger.log(text);
  return text;
}
