// ============================================================
// CALO LIVE PROBE — a throwaway tool, not part of the dashboard
// ============================================================
// Purpose: prove that Apps Script can reach the Calo dashboard's
// API and authenticate against it, BEFORE any real code is written.
//
// Nothing in this file touches a spreadsheet. It only fetches a URL
// and prints what came back. It is safe to run as often as you like,
// and safe to delete once the real sync exists.
//
// ── WHERE THE SETTINGS LIVE ─────────────────────────────────
// Not in this file. In Apps Script:
//
//   ⚙ Project Settings  →  Script Properties  →  Add script property
//
// That keeps the token out of the code, so it is never copied into
// GitHub and never appears in a screenshot of this file.
//
// Add these properties:
//
//   CALO_LIVE_URL      the full URL from the Copy-as-cURL
//                      Use {{DATE}} anywhere the date appears and it
//                      will be replaced, e.g.
//                      https://.../deliveries?date={{DATE}}
//
//   CALO_AUTH_HEADER   the NAME of the auth header, exactly as the
//                      browser sent it. Usually one of:
//                        Authorization        (token logins)
//                        x-api-key            (API-key logins)
//                        Cookie               (session logins)
//
//   CALO_AUTH_VALUE    the VALUE of that header, in full, e.g.
//                        Bearer eyJhbGciOi...
//
//   CALO_METHOD        optional. 'get' (default) or 'post'.
//   CALO_BODY          optional. Only for post — the JSON request
//                      body, again with {{DATE}} where the date goes.
//
// ── HOW TO RUN ──────────────────────────────────────────────
//   1. Click CaloLiveProbe in the file list on the left.
//      (The Run menu only lists functions from the open file.)
//   2. Choose  caloProbe  in the dropdown, then Run.
//   3. Read the execution log.
//
// A note on Cookie auth: if the dashboard logs you in with a session
// cookie, a copied cookie WILL work today and WILL stop working when
// that session expires — days, sometimes hours. That is fine for this
// probe, but it cannot be the basis of the daily sync. If the probe
// only works with Cookie, we need a proper token or API key before
// going further. The probe says so in its own output.
// ============================================================


/** Run this one. Fetches the URL and prints everything useful. */
function caloProbe() {
  var out = [];
  function say(s) { out.push(s); }

  var p        = PropertiesService.getScriptProperties();
  var url      = p.getProperty('CALO_LIVE_URL');
  var hName    = p.getProperty('CALO_AUTH_HEADER');
  var hValue   = p.getProperty('CALO_AUTH_VALUE');
  var method   = (p.getProperty('CALO_METHOD') || 'get').toLowerCase();
  var body     = p.getProperty('CALO_BODY');

  say('CALO LIVE PROBE — ' + new Date());
  say('');

  // ── settings present? ─────────────────────────────────────
  if (!url) {
    say('STOP: Script Property CALO_LIVE_URL is not set.');
    say('      Project Settings → Script Properties → Add script property.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }
  if (!hName || !hValue) {
    say('note: no auth header set. Trying without one — expect 401 or 403');
    say('      unless the endpoint is open.');
    say('');
  }

  // ── today's date, in the market's own timezone ────────────
  // getTimeZone() is the SCRIPT's timezone, which is what the person
  // reading the dashboard sees. Using UTC here would ask for the wrong
  // day for several hours each evening in the Gulf.
  var tz   = Session.getScriptTimeZone();
  var date = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  say('Asking for date: ' + date + '   (timezone ' + tz + ')');

  url = url.replace(/\{\{DATE\}\}/g, date);
  if (body) body = body.replace(/\{\{DATE\}\}/g, date);

  // The URL is printed so a typo is visible, but anything that looks
  // like a token inside it is masked first — the log is the thing
  // people paste into chat.
  say('URL:            ' + _probeMask_(url));
  say('Method:         ' + method.toUpperCase());
  say('Auth header:    ' + (hName ? hName + ': ' + _probeMask_(hValue) : '(none)'));
  say('');

  // ── the call ──────────────────────────────────────────────
  var headers = {};
  if (hName && hValue) headers[hName] = hValue;

  var opts = {
    method: method,
    headers: headers,
    muteHttpExceptions: true,   // read the error instead of throwing on it
    followRedirects: true
  };
  if (method === 'post' && body) {
    opts.contentType = 'application/json';
    opts.payload     = body;
    say('Request body:   ' + body);
    say('');
  }

  var res, started = new Date().getTime();
  try {
    res = UrlFetchApp.fetch(url, opts);
  } catch (e) {
    say('THE CALL FAILED BEFORE IT GOT AN ANSWER.');
    say('  ' + e.message);
    say('');
    say('Usually one of:');
    say('  • the URL is malformed');
    say('  • the host is not reachable from Google (internal-only / VPN-only)');
    say('  • Apps Script has not been authorised for external requests yet —');
    say('    run it once more and accept the permission dialog');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }
  var ms = new Date().getTime() - started;

  // ── what came back ────────────────────────────────────────
  var code = res.getResponseCode();
  var text = res.getContentText();
  var type = (res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');

  say('HTTP ' + code + '   (' + ms + ' ms, ' + text.length + ' characters, ' + (type || 'no content-type') + ')');
  say('');

  if (code === 200) {
    say('REACHED IT. Apps Script can call this endpoint.');
  } else if (code === 401 || code === 403) {
    say('REACHED IT, BUT WAS REFUSED (' + code + ').');
    say('The host answered, so the URL is right and Google can see it.');
    say('The credential is the problem: wrong header name, a value that');
    say('was truncated when copied, or a session that has since expired.');
  } else if (code === 404) {
    say('REACHED THE HOST, BUT NOT THAT PATH (404). Check the URL.');
  } else if (code >= 500) {
    say('THE SERVER ERRORED (' + code + '). The request may be the wrong shape —');
    say('check the method and, for POST, the body.');
  }
  say('');

  // HTML back from something that should return JSON almost always means
  // a login page, which reads as success to a script that does not look.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    say('CAREFUL: the response is a WEB PAGE, not data.');
    say('This is what a login screen looks like to a script. Treat it as');
    say('"not authenticated", whatever the status code says.');
    say('');
  }

  say('─── first 3000 characters of the response ───');
  say(text.substring(0, 3000));
  if (text.length > 3000) say('… (' + (text.length - 3000) + ' more characters)');

  var full = out.join('\n');
  Logger.log(full);
  return full;
}


/** The same call for one chosen day, e.g. caloProbeFor('2026-11-03'). */
function caloProbeFor(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) {
    throw new Error('Pass a date as yyyy-mm-dd, e.g. caloProbeFor(\'2026-11-03\')');
  }
  var p   = PropertiesService.getScriptProperties();
  var url = p.getProperty('CALO_LIVE_URL');
  if (!url) throw new Error('CALO_LIVE_URL is not set in Script Properties.');

  // Pin the date by freezing it into the URL, then run the normal probe
  // against that. The original property is put back afterwards, so this
  // leaves no trace even if the call throws.
  var original = url;
  try {
    p.setProperty('CALO_LIVE_URL', url.replace(/\{\{DATE\}\}/g, ymd));
    return caloProbe();
  } finally {
    p.setProperty('CALO_LIVE_URL', original);
  }
}


/** Lists which settings are set, without printing the secret ones. */
function caloProbeSettings() {
  var p = PropertiesService.getScriptProperties();
  var keys = ['CALO_LIVE_URL', 'CALO_AUTH_HEADER', 'CALO_AUTH_VALUE', 'CALO_METHOD', 'CALO_BODY'];
  var out = ['Script Properties — ' + new Date(), ''];
  keys.forEach(function(k) {
    var v = p.getProperty(k);
    if (!v) { out.push('  (not set)  ' + k); return; }
    out.push('  set        ' + k + ' = ' + _probeMask_(v));
  });
  var text = out.join('\n');
  Logger.log(text);
  return text;
}


/**
 * Hides anything that looks like a credential, so the log can be shared.
 * Long unbroken runs of token-ish characters are the giveaway; ordinary
 * words and URL paths are left alone so the output stays readable.
 */
function _probeMask_(s) {
  s = String(s || '');
  return s.replace(/[A-Za-z0-9_\-\.]{24,}/g, function(m) {
    return m.substring(0, 4) + '…' + (m.length - 8) + ' hidden…' + m.substring(m.length - 4);
  });
}
