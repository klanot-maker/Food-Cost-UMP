# UMP Operations Dashboard

Google Apps Script web app reporting on Calo's UAE logistics and delivery
operation. This repository is the source of truth for the code; the Apps
Script project is what actually runs.

## The two copies

Nothing here executes. Google runs the copy in Apps Script. A commit changes
the live dashboard only after the files are put into Apps Script **and a new
version is deployed** (Deploy → Manage deployments → ✏️ → New version).

The sidebar shows the build the server reports beside the build the page was
built with. If they disagree, the deploy did not take.

## Files

| File | Role |
|---|---|
| `Config.gs` | **The only file a market changes.** Workbook ids, market, currency, FX rate, admins |
| `Dashboard.gs` | Backend: sheet parsers, cache, auth, write-backs |
| `Index.html` | The whole front end. Named `Index` because `doGet` asks for that name |
| `SlackMonthlySummary.gs` | Monthly financial summary posted to Slack |

Every `.gs` file shares one global scope and they load in **no guaranteed
order**, so a constant in one file must never read a value from another. That
is why config is reached through functions (`SS_FINANCIAL_()`, not
`SS_FINANCIAL`).

After editing `Config.gs`, run **`cfgSelfTest()`** from the editor. It opens
every workbook, checks every tab the parsers look up by name, and reports in
plain words. A wrong id otherwise shows up as an empty page with no error.

## Where the data comes from

Three workbooks, set in `Config.gs`. One market may keep all three in a single
file — put the same id in all three slots.

| Source | Tab | Feeds |
|---|---|---|
| financial | `Financial cost`, **else the first tab** | Revenue, wastage, other cost, DPD |
| financial | `Access Control` | Login and roles |
| complaints | `DISTRICT DELIVERIES` | Daily deliveries (`Total` is a `=SUM()`) |
| complaints | `CAPACITY`, `FORECAST`, `DOD Complaint`, `MOM Complaints`, `Logistics`, `WOW DISTRICT`, `DISTRICT SHIFTS`, `LOGISTICS INVOICES`, `UPDATES` | the rest |
| staff | one tab per month, e.g. `October : 2026` | Manpower |

**The financial reader falls back to the first tab in the workbook when no tab
is called `Financial cost`.** UAE runs on that fallback — its tab is named
`Summary`. The fallback is silent, so a market whose workbook opens on some
other tab will show figures that look plausible and are wrong. `cfgSelfTest()`
names the tab that will really be read.

Month tabs are matched as `/^([A-Za-z]+)\s*:\s*(\d{4})$/`, so both
`October : 2026` and `January: 2026` are accepted.

## Live updates

Sheet edits reach the dashboard without a Refresh. Cache keys carry a
generation counter plus each workbook's Drive last-modified time, rounded to
the minute, so an edit produces a different key and the stale entry is never
looked up again. Worst case about a minute.

Payloads over ~90 KB are split across numbered cache chunks; the head is
written last, so a half-written set can never be read back.

## Deliveries: two tabs, one of them an archive

`DISTRICT DELIVERIES` holds the current figures — one row per day, districts
across, a `Total` column that sums them. It is maintained daily.

`DELIVERIES` is an older year-block archive: each even column a date, the next
its count, one pair per month. **UAE's stops at December 2022.**

Until November 2026 the code read only the archive, so every lookup for a
recent date missed and three features silently returned 0: the Operation
Overview delivery counts, logistics cost per delivery, and Forecast vs
Actuals. `getDeliveriesData` now reads the district tab first and uses the
archive only for dates the district tab does not carry.

## Live delivery stats from the Calo API — not available

`LiveDeliveryStats.gs` was removed in November 2026. It is in the git history
if it is ever wanted back. Two independent reasons it never worked:

1. **Nothing called it.** `getLiveDeliveryStats` had zero callers — no button,
   no page. Only `syncDeliveriesToSheet`, run by hand, did anything, and it
   wrote into the archive tab above.
2. **The endpoint cannot answer the question.** `/ext/v1/stats/deliveries`
   returns one all-time, all-market total (~60.2 million and drifting upward
   between calls). Roughly 25 date-filter spellings were tried; all were
   ignored. A 400 proved `filter` is an object parameter, but
   `filter[day][gte]=…` was accepted and changed nothing.

The Calo MCP connector does expose per-day, per-kitchen data
(`get_delivery_stats_by_day`, `get_delivery_list`), but it is not reachable
from Apps Script — it goes through Calo's internal gateway, not the public
REST API this key opens. Rebuilding this means finding a REST route that
honours a date filter.

Note also that `get_delivery_stats_by_day` counts **meal items, not
deliveries**. Feeding it into a column labelled deliveries would corrupt DPD,
which is the denominator for per-delivery cost on the Financial page.

## Before copying this to another market

1. Edit `Config.gs` only, then run `cfgSelfTest()`.
2. Confirm which tab the financial reader resolves to — do not rely on order.
3. Keep `Config.gs` and your own new files as yours; leave the rest as the
   template, or template fixes stop merging cleanly.
