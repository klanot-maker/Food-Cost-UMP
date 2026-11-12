# PETTY CASH APP

Phone web app for the **W/H Petty Cash 2026** sheet. You take or upload a photo of an invoice, Claude reads the receipt #, the invoice date and the total including VAT, and you check the details before saving them as a new ledger row.

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
4. **Project Settings → Script Properties**: add `ANTHROPIC_API_KEY` = your Anthropic API key.
5. In the editor, run **`setupSheet`** once and approve the permissions. It:
   - deletes the stray `06/03/2026` and `Cash Balances` rows at the bottom,
   - resets every Balance cell to the running-sum formula (closing balance stays **248.35**),
   - sets columns A and E to `dd-MMM-yy`, adds the B/C dropdowns below the existing history and the *Invoice Photo* header,
   - builds the **Monthly Summary** tab: a month picker in B4, a per-category breakdown, and an all-months table with filters.
6. **Deploy → New deployment → Web app**. Open the URL on your phone and add it to your home screen.

Access is set to *Only myself*. To let warehouse staff use it, change `webapp.access` to `DOMAIN`. Anyone who can open the app can then add rows and use your API key.

Older rows keep their free-text *Payment For*, so in the Monthly Summary they are counted under **Other / older entries**.
