# Setting up the KMP Operation Dashboard

The dashboard is named **KMP Operation Dashboard** throughout — the page
title, the sidebar, the footer, the password-reset emails, the exported PDF
footer, and the Drive folder invoices are filed in.

If this copy is for a market that is not KMP, change the name before you
deploy: search all five files for `KMP` and replace it. Be careful with
`KMP_BUILD` and `KMP_BUILD_UI` — they are a matched pair across
`Dashboard.gs` and `Index.html`, and the page warns on every load if they
disagree, so rename both or neither.

> **This file is not part of the project. Do not paste it into Apps Script.**
>
> It is instructions, written in English, not code. Apps Script will try to
> read it as JavaScript and stop on the first line with
> `SyntaxError: Invalid or unexpected token`. If that has already happened,
> open the file's ⋮ menu in the editor and choose **Remove** — nothing else
> is affected.
>
> Keep this open in a browser or a text editor while you work. Only the five
> files listed in step 2 go into Apps Script.

This folder is a working copy of the UAE dashboard with every UAE-specific
value taken out. Nothing in here points at UAE's data, and nothing you do in
here can reach it.

You should need to edit exactly one file: **Config.gs**. The rest is shared
template. If you find yourself changing `Dashboard.gs` or `Index.html` to make
something work, say so — it probably means a market fact is still hardcoded
somewhere it should not be, and it is better fixed for everyone than patched
once here.

Budget about two hours, most of it spent on the spreadsheets rather than the
script.

---

## 1. The three workbooks

The dashboard reads from Google Sheets. It never writes to them except for
the `DELIVERIES` tab and the `LOGISTICS INVOICES` tab, which it creates.

UAE uses three separate workbooks. **You can use one, two or three** — the
dashboard only cares which workbook each tab lives in, so if everything for
your market sits in one file, put that same id in all three lines of
`Config.gs`. `cfgSelfTest()` will mention it and carry on.

Tabs are found **by exact name**, including capitals and spaces. A tab called
`Deliveries` will not be found when the code is looking for `DELIVERIES` — and
it fails silently, showing an empty section rather than an error. This is the
single most common reason a new market's dashboard looks half-broken.

**Financial workbook**

| Tab | What it holds |
|---|---|
| `Financial cost` | Monthly revenue, deliveries, DPD, food cost %, wastage and other cost lines |
| `Access Control` | Who may open the dashboard, and what they may see |
| `Comments` | Notes left on the financial page |

**Operations workbook**

| Tab | What it holds |
|---|---|
| `CAPACITY` | Kitchen capacity by day |
| `DELIVERIES` | Daily delivery counts — **filled automatically**, see step 5 |
| `DISTRICT DELIVERIES` | Deliveries split by district |
| `WOW DISTRICT` | Week-on-week district movement |
| `DOD Complaint` | Day-on-day complaints |
| `MOM Complaints` | Month-on-month complaints |
| `Logistics` | Fleet and route figures |
| `LOGISTICS INVOICES` | Supplier invoice line items (created on first save) |
| `FORECAST` | Forecast figures |
| `UPDATES` | Change notes shown in the sidebar |
| `DISTRICT SHIFTS` | Shift plan by district |
| `Comments` | Notes left on the operations pages |

**Staff workbook** — one tab per month. The names vary by market (UAE uses
`June : 2026`), so nothing checks them; the dashboard reads whichever tabs are
there.

### Getting the structure without inheriting the data

**Do not build these tabs by hand from the list above.** The column layouts
matter as much as the tab names — which column holds "Spilled", which row
holds the targets — and they are not written down anywhere except in the
sheets themselves. A tab with the right name and the wrong columns reads as
zeros, silently.

Copy, then empty:

1. Ask the UAE owner to open each workbook and do **File → Make a copy**.
2. They share the copy with you, or move it into your market's folder.
3. **In your copy**, clear the data but keep the structure:

| Tab | Delete | Keep |
|---|---|---|
| `Financial cost` | every month column except the labels in column A | column A, and the row order — the reader finds the wastage and other-cost blocks by walking down the labels |
| `MOM Complaints` | every row from row 2 down | **row 1** — it holds the complaint targets, not a header |
| `DOD Complaint` | every data row | the header row |
| `CAPACITY`, `Logistics`, `FORECAST`, `DISTRICT DELIVERIES`, `WOW DISTRICT`, `DISTRICT SHIFTS` | every data row | the header row |
| `DELIVERIES` | **nothing** — see below | everything |
| `Access Control` | every row | the header row, then add yourself |
| `UPDATES`, `Comments` | every row | the header row |
| staff month tabs | all but one month, and the rows inside it | one tab as the shape to copy for your own months |

`DELIVERIES` is the exception. Its year blocks are dates with no numbers in
them until the sync runs, so **delete the count column only and leave the
dates**. If you delete the year blocks too, `caloEnsureYear()` can rebuild
them — but it copies the layout from a year that is already there, so leave
at least one.

Nothing in the scripts reads a cell by its position in UAE's file. Everything
is found by tab name, by header text, or by walking the labels in column A.
That is why clearing the numbers is enough and no re-mapping is needed.

4. Check you cleared everything: open each tab and look for a figure you
   recognise as UAE's. Then run `cfgSelfTest()` — it will not catch leftover
   data, but it will catch a tab you renamed or deleted by accident.

---

## 2. The Apps Script project

1. Open your **operations workbook** → Extensions → Apps Script.
2. Delete the `Code.gs` file the new project starts with.
3. Create these **five files and no others**, and paste the contents in:

   | Create it as | Name it | Paste in |
   |---|---|---|
   | Script | `Config` | `1-Config.txt` |
   | Script | `Dashboard` | `2-Dashboard.txt` |
   | Script | `CaloDeliveries` | `3-CaloDeliveries.txt` |
   | Script | `SlackMonthlySummary` | `4-SlackMonthlySummary.txt` |
   | **HTML** | `Index` | `5-Index.html.txt` |

   Apps Script adds the extension itself, so type the name without one.

   **`Index` must be created as an HTML file** — File → New → HTML file.
   Pasted into a script file it is thousands of syntax errors.

   **`SETUP.md` is not one of the five.** It is this document. Pasting it in
   gives `SyntaxError: Invalid or unexpected token` on line 1.

4. Save.

---

## 3. Fill in Config.gs

Every field is blank or zero. Fill in:

```js
market:   'Bahrain',          // shown in the page title and sidebar
kitchen:  'BH001',            // AE001 UAE, BH001 Bahrain, SA001 KSA,
                              // QA001 Qatar, KW001 Kuwait
currency: 'BHD',
fxToUsd:  0.376,              // local units per 1 USD

src: {
  financial:  'paste the id from the workbook URL',
  complaints: '…',
  staff:      '…',
  dodGid:     0               // the number after #gid= when the
},                            // "DOD Complaint" tab is open

superAdmins: ['you@calo.app', 'someone.else@calo.app']
```

The id is the long middle part of the address:
`docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

**Keep at least two super admins.** They are the accounts that can still get
in when the `Access Control` tab is empty or wrong, which it will be on your
first day. One name means one person leaving locks the market out.

Then run **`cfgSelfTest()`** from the editor. It opens every workbook, checks
every tab name, and reports in plain words. Do this before deploying — a
wrong id shows up as an empty dashboard, not as an error message.

---

## 4. Deploy

Deploy → New deployment → Web app.

- Execute as: **Me**
- Who has access: **Anyone within Calo**

Open the URL. You should see your market's name in the sidebar and your
currency on every figure.

If figures are labelled **`???`**, `Config.gs` is not reaching the page —
either `currency` is still blank or the project is missing `Config.gs`.
That label is deliberate: the alternative was defaulting to AED, which looks
completely normal and is wrong.

**Saving in the editor does not change what the web app serves.** You have to
deploy again. The build date in the sidebar tells you which version you are
actually looking at; more time has been lost to this than to anything else in
this project.

---

## 5. Automatic delivery numbers (optional, worth doing)

`CaloDeliveries.gs` fills the `DELIVERIES` tab from the Calo API every
morning, including a week of forecast, so nobody types delivery counts by
hand. It writes to that one tab and nothing else.

1. **Get an API key** for the Calo stats gateway and put it in
   Project Settings → Script Properties as **`CALO_API_KEY`**.
   Keep it there. It does not belong in a file, a message or a repository.

2. Run **`caloDiagnose()`**. It proves the key works and works out how the
   gateway wants its filters spelled.

3. **Fill in `CALO_TRUTH`** at the top of `CaloDeliveries.gs`: six settled
   days of delivery counts for your kitchen, read off the Calo dashboard by
   eye. Use yesterday and the five days before it — a day still filling up
   keeps changing, and will make a correct filter look wrong. Include a
   Friday and a Saturday if you can; they differ most from the rest of the
   week, so a filter that is quietly counting something extra shows up there
   first.

4. Run **`caloFindFilter()`**. It tries every plausible filter against those
   six days and keeps the one that reproduces all six exactly. Unfiltered,
   this endpoint also counts cancelled, skipped, paused and suspended
   deliveries — in UAE that is 300–500 a day, and the same number divides
   into every per-delivery cost figure on the financial page. This step is
   why the sync refuses to run until it has been done.

5. Run **`caloPreviewSync()`**. It shows exactly what would change and
   writes nothing. Read it before step 6.

6. Run **`caloSyncDeliveries()`**, then **`caloInstallDailySync()`**.

From then on it runs each morning over last week, this week and next week —
three whole weeks, Sunday to Saturday. Past days get corrected, future days
are counts of deliveries already scheduled, so they climb through the week as
orders arrive. It never writes a zero over a figure that is already there.

It also builds the next year's block in the `DELIVERIES` tab when the window
first reaches it, copying the layout from the year above.

---

## 6. The Slack summary (optional)

`SlackMonthlySummary.gs` posts a monthly figure summary. Put your webhook in
Script Properties as `SLACK_WEBHOOK_URL` and add a monthly trigger. Amounts
are labelled with `CFG.currency`, so this needs nothing market-specific.

---

## What is deliberately empty

The UAE dashboard ships with five months of real figures built into
`Index.html`, so that a page opened before the sheets answer still has
something to draw. In this copy those are empty, and the dashboard shows
"no data yet" instead.

That is not an oversight. A new market's sheets are empty on day one, which
is exactly the state that triggers the fallback — so the built-in figures
would have appeared on your screen, correctly formatted, labelled as yours,
with nothing to suggest they were not.

The same goes for `CALO_TRUTH`, which is UAE's delivery counts, and for every
spreadsheet id in `Config.gs`.

Three tab lookups also changed. The UAE copy finds `MOM Complaints` and one
staff tab by hardcoded tab id, falling back to a tab named after June, then
to the first tab in the workbook. Tab ids belong to the workbook they were
created in, and two of those lookups **write** — so in your workbook they
were three ways to save a figure into the wrong month. The template finds
tabs by name, and refuses rather than guessing.

---

## Keeping up with the template

`template/` is a copy, and copies fall behind. `tests/template-neutral.test.js`
checks that every line differing from the live UAE files is one of a listed
set of deliberate changes, so if the UAE copy moves on, the test says so
rather than letting the template quietly go stale.

If you change something here that every market would want, raise it against
the shared files rather than keeping it to yourself — otherwise the next
market copies the old version and makes the same change again.
