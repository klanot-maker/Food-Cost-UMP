# PETTY CASH APP

Phone web app for the **W/H Petty Cash 2026** sheet. You take or upload a photo of an invoice, Gemini on Vertex AI reads the receipt #, the invoice date and the total including VAT, and you check the details before saving them as a new ledger row.

| Column | Filled by |
|---|---|
| A Entry Date | Today's date (Dubai), shown as `dd-MMM-yy` |
| B Transaction Type | Dropdown: Withdraw / Deposit |
| C Payment For | Dropdown: the 5 categories |
| D Receipt # / E Invoice Date / F Amount | Read from the photo; you can edit them before saving |
| G Balance | `=SUM($F$3:F<row>)`. Withdraw is saved as a negative amount, Deposit as a positive one |
| I Invoice Photo | Link to the photo, saved in the Drive folder *Petty Cash Receipts 2026* |

## Install (one time)

1. Open the sheet, then **Extensions → Apps Script**.
2. Create `Code.gs` and `Index.html` (File → New → HTML, named `Index`) and paste in these files.
3. **Project Settings**: tick *Show "appsscript.json"* and paste in `appsscript.json`.
4. **Project Settings → Script Properties**: add `VERTEX_API_KEY` = your Google Cloud / Vertex AI API key (starts with `AQ.`).
5. In the editor, run **`setupSheet`** once and approve the permissions. On the **Petty Cash** tab it:
   - writes the headers A–I (Entry Date … Invoice Photo) and an `Opening Bal.` row 3 of 0,
   - sets Balance to the running-sum formula, dates to `dd-MMM-yy`, and adds the B/C dropdowns,
   - (re)builds the **Monthly Summary** tab: month picker in B4, per-category breakdown, all-months table with filters.
6. **Deploy → New deployment → Web app**. Open the URL on your phone and add it to your home screen.
   After changing the code later, use **Deploy → Manage deployments → Edit → Version: New version** so the phone link picks it up.

Access is set to *Only myself*. To let warehouse staff use it, change `webapp.access` to `DOMAIN`. Anyone who can open the app can then add rows and use your API key.

