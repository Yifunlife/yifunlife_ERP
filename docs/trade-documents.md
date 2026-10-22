# Trade documents and Hotmail sending

Entry: `/trade-documents`; also available from the account menu and quotation history.

## Customer workflow

1. Sign in to the quotation system using the employee account.
2. Connect the employee's own Hotmail. Open the Microsoft link, enter the code displayed by this site and approve the requested permissions. The page automatically detects completion. Never enter a device code supplied by someone else.
3. Select equipment PI, design PI, equipment CI or equipment contract. Enter customer details and line items, or explicitly import a USD quotation. Check actual quantities, fees and negotiated price before proceeding.
4. Generate the PDF. All four documents use the supplied Office template as a retained PDF background. The original Office files are unchanged. Equipment documents retain the HK company and HSBC details; design PI retains the Australian company and WESTPAC details. Sample customer, dates and amounts are removed.
5. Review every PDF page, recipient, subject, body and authorised sender. Tick the confirmation box, then send. Customer attachments are PDF only.

The original invoice templates contain one summary row. A package total is placed in that row and the full goods/service schedule is appended, with cent-rounded totals matching the main page. Contract clauses, branding, bank details and signature spaces remain; only mapped business fields and the selected cost checkboxes are filled. The original nine-page contract numbering describes its main body; its goods schedule has separate numbering. No signature is generated.

## Runtime configuration

Apply only `drizzle/0026_trade_documents.sql` to the existing database. It adds three tables and one index; it does not alter quotations, products, customers or user accounts.

- `MICROSOFT_CLIENT_ID`: existing Yifun Sales Workbench Outlook application; supports personal Microsoft accounts, with public client flows enabled.
- `MAIL_TOKEN_KEY`: random 32-byte AES-GCM key encoded as base64. Configure as a Worker secret. Do not rotate without a reauthorisation plan, because existing mailbox tokens and pending device codes become unreadable.

No client secret, web callback, SMTP password or mailbox password is needed. Device-code authorisation uses the `consumers` authority and requests only `offline_access User.Read Mail.Send`. The site reads the account profile to identify the sender, and does not request inbox-reading permission. Refresh tokens and private device codes are encrypted with employee email as authenticated additional data. Browser responses contain only the public user code and account address, never tokens.

Each mailbox ID is unique across employee connections. Every stored document, PDF and send operation is checked against the authenticated employee. The authenticated PDF endpoint reads from private R2 keys; the public catalogue image endpoint cannot retrieve those keys. Disconnecting deletes this site's stored token and outstanding device flow; users can also revoke the application grant from their Microsoft account.

## Sending and recovery

Generation freezes the PDF, mail recipient, subject and body. Confirmation sends that exact stored PDF, checked by SHA-256. An atomic database transition from `ready` to `sending` prevents duplicate-click sends. Changing form or mail content invalidates the current review and requires regeneration. Drafts can be reopened from the employee's own recent documents.

`accepted` means Microsoft returned HTTP 202, not customer delivery. A copy is requested in the sender's Sent Items. Network interruption, ambiguous success and upstream server errors are `uncertain`, and are never automatically retried. A stale `sending` record must also be checked in Sent Items before creating another send. Definite rejection is `failed`. No deliveries or customer receipts are inferred.

PDFs are limited to 2.5 MB / 50 pages for direct Graph attachments. The embedded static OFL font supports Latin, punctuation and common simplified Chinese (GB2312). Unsupported characters fail visibly with a request to use English spelling. Full-font embedding is intentional: runtime subsetting produced PDFs with extractable text but missing rendered glyphs. Prices support six decimal places; line amounts and totals round to cents.

## Verification

`node --test tests/trade-documents.test.cjs tests/trade-pdf.test.cjs`

The tests cover employee isolation, PDF validation, reviewed attachment hashes, unchanged sender, duplicate requests, ambiguous sends, private encrypted device codes, poll throttling, all four templates, long schedules, unsupported glyphs, field overflow and monetary rounding. Visual QA must additionally render and inspect generated PDF pages; text extraction alone does not validate visible glyphs.

Production mailbox authorisation and a recipient-approved test send are separate from mocked transport tests. Do not claim successful delivery from a build, token request or Graph HTTP 202.
