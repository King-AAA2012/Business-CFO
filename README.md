# AI Business CFO

Billing, inventory, barcodes, bank/UPI reconciliation, GST and an AI CFO for Indian small businesses. Runs on your own computer; data is stored in `data/cfo.db` (SQLite).

## Run

Needs [Node.js](https://nodejs.org) 22.13 or newer (the LTS download is fine).

### Windows
Double-click `start.bat`.

### Mac
1. Download: green **Code** button → **Download ZIP** on GitHub, and unzip it (or `git clone https://github.com/King-AAA2012/Business-CFO.git`).
2. Double-click **`start.command`**.
   - The first time, macOS may say it "cannot be opened because it is from an unidentified developer". Right-click (or Control-click) `start.command` → **Open** → **Open**. You only do this once.
   - If it says you don't have permission, open Terminal in the folder and run `chmod +x start.command`, or just run `bash start.command`.
3. If Node.js is missing, the launcher offers to install it with Homebrew, or opens nodejs.org so you can install it.
4. The first run installs components (about a minute), then the app opens in your browser. Keep the Terminal window open while you use it; close it to stop.

### Any system (terminal)
```
npm install
npm start
```

- This computer: http://localhost:4600
- Phones on the same Wi-Fi: `https://<your-computer-IP>:4643` (printed at startup). Accept the certificate warning once. HTTPS is needed for the phone camera scanner.
- Different port: `PORT=4610 npm start` (Mac/Linux) or `set PORT=4610 && npm start` (Windows).
- On a Mac, allow incoming connections if macOS asks, so phones can reach it.

First visit creates the owner account. Add staff under Settings → Staff.

## Barcodes

Every product gets a barcode automatically (in-store EAN-13 starting with `2`, so it never clashes with brand barcodes). If a product already has a maker's barcode, scan it into the product's Barcode field.

- **Print:** Barcode labels page, or Labels on any product. Label rolls (50×25, 38×25, 40×30, 58×40, 100×50 mm) or A4 sticker sheets (65/40/24/12 per page). EAN-13, Code 128, QR or QR + barcode.
- **Scan:** USB/Bluetooth scanners work on every page (they type the code and press Enter). Phone camera on the Scan page, the scan button, the POS and stocktake. A photo of a barcode also works.
- A scan opens the exact product: stock, price, cost, margin, batches, expiry, sales speed, with Sell / Adjust / Label actions. Batch codes scan too.

## Bank & UPI

- **UPI:** add your UPI ID under Bank & UPI. Every invoice shows a UPI QR with the amount and invoice number filled in; POS has a UPI checkout; print a counter standee.
- **Bank accounts:** IFSC lookup fills bank and branch. Multiple bank, cash, UPI and card accounts with transfers between them.
- **Statement import + reconciliation:** import the CSV from net banking. Lines are matched to payments already recorded, and UPI/NEFT credits that carry the invoice number (or the customer's name and the exact amount) are recorded against the invoice automatically. The rest get one-click suggestions, or become expenses.
- **Live bank feed (optional):** RBI Account Aggregator via Setu. Needs a Setu FIU account; add keys in Settings → Integrations.
- **Payment links (optional):** Razorpay keys in Settings → Integrations. Invoices get a pay-by-link button; paid links are recorded (webhook, or "Check online payment").

## Features

1. Owner and staff logins with roles
2. POS quick billing with scanner, cash change and UPI QR checkout, 80 mm receipts
3. GST tax invoices: HSN, CGST/SGST or IGST by state, round off, amount in words, UPI QR, bank details
4. Quotations that convert to invoices
5. Purchase orders that become purchase bills when goods arrive
6. Credit notes (sales returns) that restock and refund or reduce the balance
7. Per-product HSN and GST rate, prices with or without GST
8. Batch and expiry tracking, oldest-expiry-first selling
9. Reorder plan from sales speed (days of stock left) with one-click purchase orders
10. Dead stock and ABC analysis
11. Stocktake by scanning, posts differences as adjustments
12. Stock adjustments with reasons (damage, expiry, theft) counted in P&L
13. Weighted-average costing; profit per product
14. CSV product import/export and bulk price changes
15. Product photos
16. Customers and suppliers with GSTIN, state, ledgers and printable statements
17. Credit limits with warnings at billing
18. WhatsApp invoice sharing and payment reminders
19. Expenses with categories, part payments and due dates
20. Recurring expenses (rent, salaries) posted automatically
21. 30/60/90-day cash-flow forecast
22. Profit & loss with 12-month chart
23. GST summary: GSTR-1 B2B, B2C, HSN and credit-note tables, CSV export
24. Day book with opening and closing balances per account
25. Dashboard with trends, expense breakdown, best sellers, dues and alerts
26. Command palette (Ctrl+K) to search everything
27. Activity log, backup and restore, dark and light themes, mobile layout
28. AI CFO: answers from your live numbers; uses a local Ollama model if you pick one in Settings → AI

## Data

Back up from Settings → Backup. To move to another PC, copy the `data` folder (or restore a backup file).
