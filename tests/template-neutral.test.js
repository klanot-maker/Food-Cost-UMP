// The template must carry no market's data.
//
// A new market's sheets are empty on day one, which is exactly the state
// that makes a dashboard fall back to its built-in demo figures. In the UAE
// copy those figures are UAE's real ones. Shipped as a template, they would
// appear on someone else's screen, correctly formatted, labelled as theirs,
// with nothing to suggest they were not.
//
// This also watches for drift: template/ holds copies of files that keep
// being worked on, and a copy that silently falls years behind is worse
// than no copy. Every line that differs from the live UAE file has to be
// one of the differences listed here.
const fs   = require('fs');
const path = require('path');
const ROOT = '/home/user/Food-Cost-UMP';
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};

const FILES = ['Config.gs', 'Dashboard.gs', 'CaloDeliveries.gs', 'SlackMonthlySummary.gs', 'Index.html'];

// ── the template exists and is complete ─────────────────────
FILES.concat(['SETUP.md']).forEach(f => {
  t('template has ' + f, fs.existsSync(path.join(ROOT, 'template', f)), true);
});

// ── no UAE workbook is reachable from it ────────────────────
// These ids are the whole of UAE's data. A template that still carried one
// would show a new market UAE's operation, and would hand anyone they
// shared the dashboard with a way into it.
const UAE_IDS = [
  '1JvHBdSaeh6c2KIktDAOTub93jTOqs5znszzwKEdbe1o',
  '1j1wZ3z3YMvWhDpQbzYTNUAWlaj2rRt1RwP1ENSX3Lr0',
  '1fA1ytS34bcUf-xua55d_RWCgmBwrZEYlvhQtSNwGPwE'
];
FILES.forEach(f => {
  const s = read('template/' + f);
  t('no workbook id in ' + f, UAE_IDS.filter(id => s.includes(id)), []);
});

// ── Config.gs is a form, not a filled-in one ────────────────
{
  const s = read('template/Config.gs');
  global.SpreadsheetApp    = { openById: () => { throw new Error('not in this test'); } };
  global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
  global.Logger            = { log: () => {} };
  eval(s);
  t('market blank',        CFG.market, '');
  t('kitchen blank',       CFG.kitchen, '');
  t('currency blank',      CFG.currency, '');
  t('fx rate not set',     CFG.fxToUsd, 0);
  t('no workbook ids',     [CFG.src.financial, CFG.src.complaints, CFG.src.staff], ['', '', '']);
  t('no dod gid',          CFG.src.dodGid, 0);
  t('no super admins',     CFG.superAdmins, []);
  // The accessors must not quietly stand in UAE's answers for a blank field.
  t('currency falls back loud', CFG_CURRENCY_(), '???');
  t('fx falls back to 1',       CFG_FX_USD_(), 1);
  t('cfgSelfTest is there',     typeof cfgSelfTest, 'function');
}

// ── no delivery figures to prove a filter against ───────────
{
  const s = read('template/CaloDeliveries.gs');
  const block = s.match(/var CALO_TRUTH = \{([\s\S]*?)\n\};/)[1];
  const live  = block.split('\n').filter(l => /^\s*'\d{4}-\d{2}-\d{2}'/.test(l));
  t('CALO_TRUTH has no days', live, []);
  t('and says to fill it in', /FILL THIS IN BEFORE RUNNING caloFindFilter/.test(s), true);
}

// ── the dashboard has nothing to show until the sheets do ───
{
  const s = read('template/Index.html').split('\n');
  const take = (startsWith) => {
    const i = s.findIndex(l => l.startsWith(startsWith));
    let d = 0;
    for (let j = i; j < s.length; j++) {
      d += (s[j].match(/\{/g) || []).length - (s[j].match(/\}/g) || []).length;
      if (d === 0) return s.slice(i, j + 1).join('\n');
    }
  };
  const DATA = {};
  eval(take('var FIN_FALLBACK = {') + '\n' + take('function loadFallbackData(') + '\nloadFallbackData();');

  t('no demo months',      FIN_FALLBACK.months, []);
  t('no demo revenue',     Object.keys(FIN_FALLBACK.kpis.revenue), []);
  t('no demo wastage',     FIN_FALLBACK.wastage, []);
  t('no demo other costs', FIN_FALLBACK.other, []);
  t('no demo complaints',  DATA.complaints.months, []);
  t('no demo staff',       DATA.staff.sections, []);
  t('complaint targets kept', DATA.complaints.targets.fo, 0.007);

  const head = s.slice(0, 20).join('\n');
  t('currency fallback is loud', /\|\| '\?\?\?';/.test(head), true);
  t('no 3.67 fallback',          /\|\|\s*3\.67/.test(head), false);
}

// ── the Slack post is in the market's own money ─────────────
{
  const s = read('template/SlackMonthlySummary.gs');
  t('money line uses the config', /':   ' \+ CFG_CURRENCY_\(\)/.test(s), true);
  t('no AED literal left',        /'AED/.test(s.replace(/^\s*\/\/.*$/gm, '')), false);
}

// ── drift: every difference from the live file is deliberate ─
// If this fails after a change to a UAE file, copy the file into template/
// and re-apply the differences listed here. A template that quietly stops
// matching the thing it is a template of helps nobody.
const EXPECTED = {
  'Dashboard.gs': ['Country names are address noise',
                   "own market's if invoices here print one",
                   'Bahrain|Saudi Arabia|Qatar|Kuwait|Oman',
                   'United Arab Emirates|^P\\.?O\\.?'],
  'SlackMonthlySummary.gs': ['The currency comes from Config.gs', 'is correct in UAE and wrong everywhere else',
                             'possible way, since the number beside it still looked right.',
                             "CFG_CURRENCY_() + ' '", "':   ' + CFG_CURRENCY_()", "AED ' + _slkNum_(cur, 2)",
                             "'   ' + _slkDelta_(cur, prev);"]
};
Object.keys(EXPECTED).forEach(f => {
  const a = read(f).split('\n'), b = read('template/' + f).split('\n');
  const onlyIn = (x, y) => x.filter(l => l.trim() && y.indexOf(l) < 0);
  const changed = onlyIn(a, b).concat(onlyIn(b, a));
  const unexplained = changed.filter(l => !EXPECTED[f].some(m => l.includes(m)));
  t(f + ': differences are all accounted for', unexplained, []);
});

// Config.gs, CaloDeliveries.gs and Index.html differ on purpose and by a
// lot, so they are checked by the assertions above rather than by diff.
// What is worth knowing is that nothing ELSE in them drifted.
[['CaloDeliveries.gs', '_caloSync_'], ['CaloDeliveries.gs', 'caloEnsureYear'],
 ['CaloDeliveries.gs', '_caloGrowForWindow_'], ['Dashboard.gs', 'getDeliveriesData'],
 ['Config.gs', 'CFG_FOR_UI_'], ['Index.html', 'function init()']].forEach(([f, fn]) => {
  t(f + ' still has ' + fn, read('template/' + f).includes(fn), true);
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
