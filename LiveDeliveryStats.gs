// ============================================================
// LIVE DELIVERY STATS — @calo/dashboard-sdk API
// ============================================================
// The SDK itself cannot run here: Apps Script has no npm. It is a
// client over an HTTP API though, so this calls that API directly.
//
// Base URL: https://0t42vvmg9i.execute-api.us-east-1.amazonaws.com
//
// ── The key does NOT go in this file ────────────────────────
// Anyone with edit access to the project can read the source, so a
// key pasted here is a key handed out. Put it in Script Properties:
//
//   Project Settings (⚙) → Script Properties → Add script property
//     Property:  CALO_API_KEY
//     Value:     <your key>
//
// Nothing else needs changing once it is there.
//
// ── Finding the route ───────────────────────────────────────
// Run probeDashboardApi() and read the execution log. It reports
// which paths answer and which header the key belongs in. Send me
// that output — not the key — and I will wire the live tile in.
// ============================================================

var CALO_API_BASE     = 'https://0t42vvmg9i.execute-api.us-east-1.amazonaws.com';
var CALO_API_KEY_PROP = 'CALO_API_KEY';
var CALO_API_CACHE_TTL = 60;   // seconds — live figures, so far shorter than the sheets

function _caloApiKey_() {
  var k = PropertiesService.getScriptProperties().getProperty(CALO_API_KEY_PROP);
  if (!k) {
    throw new Error('No API key stored. Project Settings → Script Properties → add '
      + CALO_API_KEY_PROP + ' with the key as its value.');
  }
  return k;
}

// One authenticated GET. headerStyle picks how the key is presented;
// probeDashboardApi() works out which one this API wants.
function callDashboardApi(path, params, headerStyle) {
  var key = _caloApiKey_();
  var url = CALO_API_BASE + (path.charAt(0) === '/' ? path : '/' + path);
  if (params) {
    var q = Object.keys(params)
      .filter(function(k){ return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
    if (q.length) url += (url.indexOf('?') > -1 ? '&' : '?') + q.join('&');
  }
  var headers = { 'Accept': 'application/json' };
  if (headerStyle === 'bearer')      headers['Authorization'] = 'Bearer ' + key;
  else if (headerStyle === 'apikey') headers['Authorization'] = key;
  else                               headers['x-api-key'] = key;   // the API Gateway default

  var res = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code >= 300) {
    throw new Error('API returned ' + code + ' for ' + path + ': ' + body.substring(0, 300));
  }
  try { return JSON.parse(body); } catch (e) { return body; }
}

// Tries each path against each header style and reports what came back.
// Nothing is written anywhere — it only reads.
function probeDashboardApi(paths) {
  var key;
  try { key = _caloApiKey_(); }
  catch (e) { Logger.log('STOPPED: ' + e.message); return e.message; }
  Logger.log('Key found (' + key.length + ' characters). Probing ' + CALO_API_BASE + '\n');

  var candidates = paths || [
    '/', '/stats', '/delivery', '/deliveries', '/delivery/stats', '/deliveries/stats',
    '/stats/delivery', '/stats/deliveries', '/delivery-stats', '/dashboard/stats',
    '/meal-stats', '/stats/meals', '/v1/stats', '/v1/delivery/stats'
  ];
  var styles = ['x-api-key', 'bearer', 'apikey'];
  var out = [], hits = [];

  candidates.forEach(function(p) {
    styles.forEach(function(style) {
      var url = CALO_API_BASE + p;
      var headers = { 'Accept': 'application/json' };
      if (style === 'bearer')      headers['Authorization'] = 'Bearer ' + key;
      else if (style === 'apikey') headers['Authorization'] = key;
      else                         headers['x-api-key'] = key;
      var code, snippet;
      try {
        var res = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
        code = res.getResponseCode();
        snippet = res.getContentText().substring(0, 160).replace(/\s+/g, ' ');
      } catch (e) { code = 'ERR'; snippet = e.message.substring(0, 160); }
      var line = _caloPad_(p, 24) + ' ' + _caloPad_(style, 10) + ' ' + code + '  ' + snippet;
      out.push(line);
      // 404 means no such route; anything else is worth a look.
      if (code !== 404 && code !== 403) hits.push(line);
    });
  });

  Logger.log(out.join('\n'));
  Logger.log('\n──────── anything that is not 404/403 ────────');
  Logger.log(hits.length ? hits.join('\n') : 'Nothing answered — the routes are different. '
    + 'Send me the SDK README, or one real request from DevTools → Network.');
  return hits;
}

// Once the route is known, put it here and this returns live figures,
// cached briefly so a page refresh does not hammer the API.
var CALO_DELIVERY_STATS_PATH = '';   // ← e.g. '/stats/deliveries'

function getLiveDeliveryStats(params) {
  if (!CALO_DELIVERY_STATS_PATH) {
    return { ok: false, error: 'The delivery stats route is not set yet — run probeDashboardApi() first.' };
  }
  var ck = 'calo_live_' + Utilities.base64Encode(CALO_DELIVERY_STATS_PATH + JSON.stringify(params || {}));
  try {
    var hit = CacheService.getScriptCache().get(ck);
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  try {
    var data = callDashboardApi(CALO_DELIVERY_STATS_PATH, params);
    var payload = { ok: true, data: data, fetchedAt: new Date().toISOString() };
    try { CacheService.getScriptCache().put(ck, JSON.stringify(payload), CALO_API_CACHE_TTL); } catch (e) {}
    return payload;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _caloPad_(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }
