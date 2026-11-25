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
