# StudentMate

StudentMate is an offline-first academic management PWA for college and university students.

## Development

```bash
npm install
npm run dev
npm run test
npm run build
npm run preview
```

Academic data is intended to remain local to the browser. The application uses IndexedDB through Dexie.js for persistent storage and a service worker for offline asset caching.

## Privacy and storage

- No account or backend is required.
- Academic records are stored in browser IndexedDB.
- PDF text and OCR processing happen locally in the browser.
- IndexedDB and theme settings are not encrypted by this application.
- Backup JSON files contain academic data and should be stored securely.
- Restores are merge-only and do not overwrite existing records by matching ID.

## Backup and restore

Use **Backup** in the application to download the full JSON database. Restore files are validated before a preview is shown. Only missing record IDs are added; existing records remain unchanged.

## Offline limitations

- Core application assets require a successful first load.
- OCR language resources may require an initial network download. Required PDF/OCR resources may not be available until cached by the browser.
- Service-worker updates activate immediately and do not delete IndexedDB data.
- OCR language data is downloaded for the first OCR use and cached by the browser. Offline OCR may not work until that resource is available locally.
- IndexedDB contents are not encrypted and can be accessed by anyone with access to the browser profile or device.

## Deployment

Build with `npm run build` and serve the `dist` directory.

- Netlify: [netlify.toml](./netlify.toml)
- Vercel: [vercel.json](./vercel.json)
- Cloudflare Pages or other static hosts: configure an SPA fallback to `index.html`; [public/_redirects](./public/_redirects) is included for compatible hosts.

## Verification

```bash
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm audit
```

## Synthetic real-world testing

Synthetic Playwright workflows run in isolated browser contexts and a separate temporary persistent profile. They seed no real student data and do not modify the user's normal browser profile.

```bash
npm run test:synthetic
npm run test:e2e
```

## Dashboard calculations

- Overall attendance combines only attended/present and student-absent sessions across the current semester.
- Teacher absence, cancellations, holidays, and rescheduled originals are excluded.
- Display percentages are rounded to the nearest integer; exact underlying values drive eligibility.
- Subjects below target are determined with the exact percentage and individual attendance target.
- Today's lectures exclude matching calendar holidays and recorded off/cancelled sessions.
- SGPA and CGPA are displayed only when entered marks and a grading scale provide enough data.

## Phase 14 commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm audit
```

## PWA installation

Serve the built application over HTTPS. Supported browsers may offer installation from the address bar or StudentMate's Settings page.

- The manifest includes named application and standalone display metadata.
- PNG 192×192 and 512×512 icons are included.
- The service worker precaches application assets and falls back to `index.html` for SPA routes.
- Updates activate immediately and do not clear IndexedDB.

## Demo mode

Open **Settings** and choose **Enter demo mode** to use an isolated `StudentMate-Demo` IndexedDB database containing fictional records only.

- Demo data never enters the real `StudentMate` database.
- Reset demo affects only the demo database.
- Exit demo returns to the real database.

## Security headers

Netlify and Vercel configurations include CSP and browser hardening headers. A generic static host should support a matching `_headers` or server-header configuration. CSP permits local application assets, workers/blobs, inline styles used by React, and the initial Tesseract language-data download from jsDelivr.

No local academic data is intentionally transmitted to a third party. However, browser access to local data is not protected by application encryption.
