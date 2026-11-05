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
is called `Financial cost`.** UAE ran on that fallback for a long time — its
tab was named `Summary`, and was renamed in November 2026 so the lookup now
succeeds by name. The fallback is silent, so a market whose workbook opens on
some other tab will show figures that look plausible and are wrong. Every
market should name the tab rather than rely on ordering; `cfgSelfTest()` reports
which tab will really be read.

Month tabs are matched as `/^([A-Za-z]+)\s*:\s*(\d{4})$/`, so both
`October : 2026` and `January: 2026` are accepted.

## Live updates

Sheet edits reach the dashboard without a Refresh. Cache keys carry a
generation counter plus each workbook's Drive last-modified time, rounded to
the minute, so an edit produces a different key and the stale entry is never
looked up again. Worst case about a minute.

Payloads over ~90 KB are split across numbered cache chunks; the head is
written last, so a half-written set can never be read back.

## Deliveries: two tabs that disagree

`DELIVERIES` is the maintained tab and the one that wins.

**Its layout is easy to misread.** Year blocks are stacked *vertically*, each
block twelve month column-pairs wide (even column a date, the next its count)
and about thirty-two rows tall. UAE's run 2022, 2023, 2024, 2025, 2026 down
the sheet — rows 1, 34, 67, 100 and 133. Reading only the top rows shows 2022
and hides everything after it. `_dlvFromLegacyTab_` walks every row.

`DISTRICT DELIVERIES` holds the same days broken out by emirate, with a
`Total` column that is a `=SUM()` of them. It is read only to fill dates
`DELIVERIES` does not carry.

**The two do not always agree.** For 1–3 Nov 2026 they differ by up to 400
(e.g. 2 Nov: 5567 vs 5603). Nobody should assume they are interchangeable;
`DELIVERIES` wins because it is what the operation maintains and what the
Forecast page writes back to.

Note that `DELIVERIES` carries figures for dates in the future — 6 and 7 Nov
were populated on 5 Nov — so it holds planned deliveries, not only settled
actuals.

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
