# StudentMate Development Plan

## 1. Project Inspection Status

**Inspected:** `D:\Project\StudentMate`

**Repository state:** The workspace currently contains no source files, package manifest, lockfile, README, database code, or existing UI implementation. It is not a git repository in the current environment.

**Inspection findings:**

- No existing React, Vite, TypeScript, or Tailwind setup was found.
- No existing Dexie/IndexedDB database was found.
- No existing PWA manifest or service worker was found.
- No existing test suite or test configuration was found.
- No existing components or reusable application architecture are available to preserve.
- No existing build, lint, or runtime errors can be established until the project is initialized.

**Readiness:** Ready for a fresh implementation, provided the requested stack is approved.

## 2. Recommended Architecture

### Application foundation

- React + TypeScript + Vite
- Tailwind CSS for the design system
- Reusable, accessible UI components
- React Router for application navigation
- Recharts for data visualization
- Lucide React for icons
- Vitest and React Testing Library for unit/component tests
- Playwright for targeted end-to-end tests

### Data and offline storage

- Dexie.js over IndexedDB
- Versioned schema migrations
- Separate normalized stores for:
  - semesters
  - subjects
  - timetable rules
  - calendar events
  - class sessions
  - attendance records
  - attendance change logs
  - schedule change logs
  - assessments
  - marks
  - grading scales
  - application settings
  - import jobs
- Transactional writes and explicit validation at repository boundaries
- Archive-first subject deletion instead of destructive historical deletion
- Non-destructive restores with duplicate detection and confirmation

### Domain organization

- `src/domain/`: attendance, grading, assessments, calendar, and timetable calculations
- `src/data/`: Dexie schema, migrations, repositories, and backup validation
- `src/features/`: route-level modules and feature-specific components
- `src/components/`: reusable layout and UI primitives
- `src/lib/`: shared utilities
- `src/test/`: test setup and fixtures

### PWA strategy

- Web App Manifest
- Service worker and offline asset caching
- Offline fallback for navigation
- Cache document-processing libraries only after they are explicitly needed and downloaded
- No academic data should leave the browser

## 3. Implementation Phases

### Phase 1: Project inspection and planning
- [x] Inspect the workspace.
- [x] Identify the available and missing infrastructure.
- [x] Prepare the architecture and implementation sequence.
- [x] Obtain review approval and begin implementation.

### Phase 2: Project setup and design system
- [x] Initialize the React, TypeScript, and Vite project.
- [x] Add the required foundation dependencies.
- [x] Configure Tailwind and a reusable UI foundation.
- [x] Establish application routing and responsive shell.
- [x] Configure theme support and PWA-ready metadata.
- [x] Configure Vitest and React Testing Library.
- [x] Establish build and test scripts.

**Phase 1 and 2 verification:**

- Added the React 19, TypeScript, Vite, Tailwind CSS, React Router, Dexie, Recharts, Lucide React, Vitest, and PWA foundation.
- Added a responsive desktop/mobile application shell.
- Added functional light/dark/system theme selection and persisted theme preference.
- Added online/offline status indicators.
- Added PWA manifest and generated service worker assets.
- Added the initial dashboard and settings routes with real empty-state behavior.
- Added one foundation component test.
- Changed files include `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.mjs`, `vitest.config.mts`, `index.html`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/App.test.tsx`, `src/test/setup.ts`, PWA metadata in `public/favicon.svg`, and `README.md`.
- Verification:
  - `npm run test`: passed, 1 test.
  - `npm run build`: passed; PWA service worker and manifest generated.
  - `npm audit --omit=dev`: 0 production dependency vulnerabilities.
- No remaining known implementation errors in the foundation.

### Phase 3: IndexedDB architecture and settings
- [x] Define the versioned Dexie schema.
- [x] Implement migrations and database health checks.
- [x] Create repositories and validation helpers.
- [x] Add application settings and theme persistence.

**Phase 3 verification:**

- Added normalized Dexie entities for semesters, subjects, timetable rules, calendar events, class sessions, attendance, change logs, assessments, marks, grading scales, settings, and import jobs.
- Added database schema version 1 with indexed lookup fields.
- Added database settings initialization and settings read/write helpers.
- Added database health checks and local database status in Settings.
- Added shared date, name, and numeric range validation.
- Added fake IndexedDB test support and schema/validation tests.
- Changed files include `src/data/models.ts`, `src/data/database.ts`, `src/data/settings.ts`, `src/data/health.ts`, `src/data/validation.ts`, `src/data/database.test.ts`, and `src/test/setup.ts`.
- Verification:
  - `npm run test`: passed, 4 tests across 2 files.
  - `npm run build`: passed; PWA assets regenerated.

### Phase 4: Subjects and semesters
- [x] Implement semester management.
- [x] Implement subject CRUD and archival.
- [x] Prevent destructive deletion of subjects with historical records.

**Phase 4 verification:**

- Added semester creation, editing, date validation, and current-semester enforcement.
- Added subject creation and editing with semester, code, faculty, credits, kind, attendance target, and color.
- Added subject archival and archived-subject filtering.
- Added duplicate subject-code protection within a semester.
- Added safe deletion: subjects with timetable, session, attendance, assessment, or mark history are blocked and must be archived.
- Added responsive subject cards and forms for desktop and mobile.
- Changed files include `src/data/academicRepositories.ts`, `src/App.tsx`, `src/styles.css`, and subject repository tests in `src/data/database.test.ts`.
- Verification:
  - `npm run test`: passed, 6 tests across 2 files.
  - `npm run build`: passed; PWA assets regenerated.

### Phase 5: Timetable and academic calendar
- [x] Implement recurring Monday-to-Sunday timetable rules.
- [x] Detect overlaps and support cancellations/rescheduling.
- [x] Implement calendar events and conflict detection.
- [x] Keep timetable, calendar events, and actual sessions separate.

**Phase 5 verification:**

- Added a Monday-to-Sunday timetable interface with subject, time, room, faculty, type, recurrence, and schedule date fields.
- Added overlap detection before saving timetable rules.
- Added academic calendar event CRUD for holidays, examinations, vacations, college events, deadlines, and special days.
- Added date-range conflict lookup without modifying existing class sessions.
- Added 3 timetable/calendar tests.
- Changed files include `src/data/timetableCalendar.ts`, timetable/calendar routes and editors in `src/App.tsx`, responsive styles in `src/styles.css`, and tests in `src/data/database.test.ts`.
- Verification:
  - `npm run test`: passed, 9 tests across 2 files.
  - `npm run build`: passed; PWA service worker and manifest regenerated.
  - `npm audit --omit=dev`: 0 vulnerabilities.
  - Full audit initially found 4 moderate build-tool-chain vulnerabilities in `glob` and `minimatch`; patched overrides were added and the final full audit reports 0 vulnerabilities.

### Phase 6: Attendance and class-off management
- [x] Implement class sessions and attendance statuses.
- [x] Implement exact attendance calculations and rounding rules.
- [x] Implement holiday, absence, cancellation, and rescheduling exclusions.
- [x] Add bulk marking and attendance history.

**Phase 6 verification:**

- Added actual class-session and attendance-record repositories.
- Added present, absent, extra, and rescheduled attendance marks.
- Added scheduled, conducted, teacher-absent, cancelled, and holiday session statuses.
- Added exact attendance formulas, nearest-integer display rounding, maximum bunk calculation, and required classes for the target.
- Added whole-day bulk marking and extra lecture creation.
- Added subject-wise attendance summaries and a daily session interface.
- Historical attendance records are retained when a session status changes.
- Added 6 focused attendance tests covering rounding, exclusions, bunk calculations, required classes, and extra/rescheduled records.
- Verification:
  - `npm run test`: passed, 15 tests across 3 files.
  - `npm run build`: passed; PWA assets regenerated.
  - `npm audit`: 0 vulnerabilities.

### Phase 7: Internal marks and grade calculators
- [x] Implement assessment structures and marks.
- [x] Implement configurable grading scales.
- [x] Implement SGPA and cumulative CGPA calculations.
- [x] Implement required-marks and target-grade calculations.

**Phase 7 verification:**

- Added assessment and mark repositories for assignments, quizzes, mid-semesters, practicals, and other assessments.
- Added configurable grading scales with percentage boundaries and grade points.
- Added weighted assessment percentages, SGPA, credit-weighted CGPA, grade-boundary lookup, and required-marks calculations.
- Added a responsive Academics interface for subject selection, assessment entry, marks, grade cards, and scale configuration.
- Added 6 focused grade and marks tests.
- Verification:
  - `npm run test`: passed, 21 tests across 4 files.
  - `npm run build`: passed; PWA assets regenerated.
  - `npm audit`: 0 vulnerabilities.

### Phase 8: Smart PDF and image import
- [x] Implement local PDF and image intake.
- [x] Integrate PDF.js and Tesseract.js as needed.
- [x] Add confidence indicators and editable review flows.
- [x] Require explicit confirmation before writes.

**Phase 8 verification:**

- Added PDF text extraction through PDF.js and local image OCR through Tesseract.js.
- Added PDF, PNG, JPEG, and WebP validation with a 15 MB file limit.
- Added local extraction review with confidence indicators, editable values, weekday/time/date controls, and removal actions.
- Added explicit confirmation before calendar or timetable records are written.
- Added import-job persistence and a confirmed state.
- Added 4 import validation and parsing tests.
- Verification:
  - `npm run test`: passed, 25 tests across 5 files.
  - `npm run build`: passed; PDF worker and OCR-ready modules were emitted for local lazy use.
  - `npm audit`: 0 vulnerabilities.

### Phase 9: Analytics and reports
- [x] Implement attendance, academic, and assessment visualizations.
- [x] Implement report summaries and export flows.
- [x] Implement attendance prediction from exact underlying values.

**Phase 9 verification:**

- Added Recharts attendance and assessment charts.
- Added subject-level insight cards with target, bunk, and required-class projections.
- Added CSV attendance export with exact values and CSV semester reports with credits and assessment percentages.
- Added 2 report-input tests.
- Verification:
  - `npm run test`: passed, 27 tests across 6 files.
  - `npm run build`: passed; PWA assets regenerated.
  - `npm audit`: 0 vulnerabilities.
  - The build reported a non-blocking large-chunk advisory caused by the visualization/document tooling bundle.

### Phase 10: Backup and restore
- [x] Implement full JSON backup and validated restore.
- [x] Implement CSV attendance export and semester report export.
- [x] Add duplicate detection and a restore confirmation step.

**Phase 10 verification:**

- Added complete JSON database backup with format, backup version, database version, and creation date.
- Added malformed JSON, backup format, version, table shape, row ID, and size validation.
- Added restore preview with additions and duplicate counts.
- Added merge-only restore that never overwrites an existing matching ID.
- Added a confirmation screen before restore writes.
- Added 3 backup and restore tests.
- Verification:
  - `npm run test`: passed, 30 tests across 7 files.
  - `npm run build`: passed; PWA assets regenerated.
  - `npm audit`: 0 vulnerabilities.

### Phase 11: PWA and offline support
- [x] Configure asset caching and offline fallback.
- [x] Test first-load, installed, and offline behavior.
- [x] Show online/offline status.

**Phase 11 verification:**

- Configured Workbox navigation fallback to `index.html`, asset precaching, outdated-cache cleanup, immediate activation, and client takeover.
- Added install-prompt handling and an Install app action when the browser makes installation available.
- Added persistent offline banner and existing online/offline indicators.
- Added an offline-event UI test.
- Verified the generated `dist/sw.js` precaches application assets and registers a navigation route for `/index.html`.
- Verified `dist/manifest.webmanifest` includes standalone display, app scope, orientation, theme, and icons.
- Verification:
  - `npm run test`: passed, 31 tests across 7 files.
  - `npm run build`: passed; PWA assets regenerated.
  - `npm audit`: 0 vulnerabilities.

### Phase 12: Security, testing, and deployment
- [ ] Validate imported and persisted data.
- [ ] Restrict file types and upload sizes.
- [ ] Add database, calculation, import, and UI tests.
- [ ] Run responsive and offline testing.
- [ ] Fix failures and prepare static-host deployment output.

## 4. First Implementation Scope

If review approves implementation, Phase 1 and Phase 2 should begin as the initial implementation slice:

1. Initialize the project and inspect the generated dependency manifest and lockfile.
2. Add the framework, styling, icon, routing, and testing dependencies.
3. Create the responsive application shell and theme foundation.
4. Add initial routes and useful empty states.
5. Configure PWA metadata and test tooling.
6. Verify lint, build, and tests before reporting completion.

Later modules must remain pending until the requested review and approval milestone.
