# Tests for CaloDeliveries.gs

Apps Script has no test runner, so these stub the four globals the file
touches — `SpreadsheetApp`, `PropertiesService`, `UrlFetchApp`, `Utilities` —
and `eval` the real `.gs` source. There is no copy of the logic here: if the
shipped file changes, these run against the change.

    node tests/filter.test.js         # which rows count as a delivery
    node tests/sync-window.test.js    # the Sunday-to-Saturday window
    node tests/year-rollover.test.js  # any column, and the turn of the year
    node tests/manpower.test.js       # agency cost, and projecting a part-month
    node tests/template-neutral.test.js   # template/ carries no market's data

`sync-window.test.js` also covers `caloCheckHistory()`, which is read-only.

`filter.test.js` pins the request format and proves `caloFindFilter()` picks
the dashboard's own filter — `skipped=false`, `status=[upcoming,
paymentRequired]` — over the ten alternatives, rather than landing on it by
luck.

`sync-window.test.js` fixes the clock at Thursday 2026-11-05 and the sheet at
the real DELIVERIES layout: the 2026 block from row 134, October in S/T,
November in U/V, dates as Date objects. It covers week arithmetic across the
month boundary, the window edges, the days-vs-weeks guard on the arguments,
and the two cases where a zero is refused — a future day not generated yet,
and a settled day the API suddenly reports as empty.

`year-rollover.test.js` sets the clock to Sunday 2026-12-27, the first week
whose forward edge falls in January, and gives the fixture a full twelve-month
2026 block. It checks that a date is found in whichever column pair it sits in
— January in A/B, June in K/L, December in W/X — and then that the sync builds
the 2027 block itself: copied from 2026 for its formatting, re-dated, counts
blanked so no 2025 figure survives the copy, February stopping at the 28th and
at the 29th in a leap year. It also covers `caloEnsureYear()` refusing a year
older than the tab, refusing a two-digit year, and doing nothing when asked for
a year already there.

`manpower.test.js` covers the outsourced-manpower reader and the month-end
projection. It pulls the server block out of `Dashboard.gs` and `_mpProject_`
out of `Index.html` rather than keeping a copy, so both run against the shipped
code. It fixes the sheets' own quirks in place — `"01-Oct-2026"` text dates, a
double shift being one head and two shifts, a punch nobody closed — and pins the
projection: days up to the last logged one are actual, with a missing one
counted as a genuine zero rather than guessed at, and only the days beyond that
are filled in from the same weekday earlier in the month. One case records what
the flat run-rate would have said instead (5400 against 5340), which is the
whole reason the weekday split is there.

`template-neutral.test.js` is the odd one out: it reads files rather than
running the code. It proves `template/` holds no UAE workbook id, no delivery
figures in `CALO_TRUTH`, and no demo data in `Index.html` — the UAE copy falls
back to five months of real figures when the sheets are empty, and a new
market's sheets are empty. It also diffs `template/` against the live files
and fails on any difference not on a list of deliberate ones, so a template
that has fallen behind says so instead of being quietly out of date.

All four exit non-zero on failure, and `.github/workflows/tests.yml` runs all
four on every push and pull request, so a change that breaks one says so on
GitHub rather than waiting for someone to remember to run them.

Paths are resolved from the test file's own directory, so the suites run from
any working directory and on any checkout.
