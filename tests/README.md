# Tests for CaloDeliveries.gs

Apps Script has no test runner, so these stub the four globals the file
touches — `SpreadsheetApp`, `PropertiesService`, `UrlFetchApp`, `Utilities` —
and `eval` the real `.gs` source. There is no copy of the logic here: if the
shipped file changes, these run against the change.

    node tests/filter.test.js        # which rows count as a delivery
    node tests/sync-window.test.js   # the Sunday-to-Saturday window

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

Both exit non-zero on failure.
