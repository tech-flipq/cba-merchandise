# CBA Durga Puja 2026 T-Shirt Order — Quick Deploy

This package preserves the existing HTML/Tailwind design and replaces the Apps Script submission call with a Netlify Function that writes to Google Sheets.

## Deploy on Netlify

1. Create a GitHub repository and upload this folder, or drag the folder into a new Netlify project using Git-based deploy.
2. In Netlify, add environment variables:
   - `GOOGLE_SPREADSHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `RECAPTCHA_SECRET_KEY`
3. In Google Cloud, enable the Google Sheets API and create a Service Account.
4. Create/download a JSON key for that Service Account.
5. Copy `client_email` to `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
6. Copy `private_key` to `GOOGLE_PRIVATE_KEY` exactly (Netlify supports multiline secrets).
7. Share the existing Google Sheet with the Service Account email as Editor.
8. Add your Netlify production domain to the allowed domains in your reCAPTCHA v3 configuration.
9. Redeploy.

## Images

Images are served locally from `public/images`; there are no Google Drive reads or Base64 conversions during page load.

## Important

The payment reference is recorded as `PAYMENT_REFERENCE_RECEIVED`; this does not independently confirm that payment was received.
