# Time Block

A Vite + React SPA for **time-blocking**: sign in with Google, overlay your real calendar events on a day/week grid, draft ordered block lists ("plans") anchored to a start or end time, run a plan against the clock, and push blocks to Google Calendar.

Your plan, block library, archived plans, settings, guest lists, and sync state persist in **Firebase Firestore** and follow you across devices. A small token-exchange backend in `server/` keeps Google Calendar access working long-term. Sign-in is required — there's no local-only mode.

## What you can do

- **Plan** — Build one or more plans (ordered blocks with durations). Anchor each plan with **Starts** or **Ends**; scrub times and drag stacks on the calendar.
- **Run** — **Start plan** when you're near the plan's time window; track progress, mark blocks finished, insert delays, and sync while executing.
- **Sync to Google Calendar** — **Add to calendar** / **Update calendar** on one or more writable calendars; invite guests without sending email.
- **Block library** — Reusable blocks organized by category; add from the picker or a block's ··· menu.
- **Archived plans** — Archive plans off Home; search, folder, and **Duplicate plan** back when needed.
- **Settings** — Synced prefs for defaults, hidden calendars, time/duration step (1–15 min), undo windows, auto-end timing, export/import, and saved guest users.

See **How Time Block works** in the app menu for a user-facing walkthrough.

## Setup

### 1. Install and run

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3410](http://localhost:3410).

### 2. Google Cloud Console

1. Create a project (or pick an existing one) in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API**.
3. Configure the [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) (External is fine for personal use). Add scopes:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events` (requested when you tap **Add to calendar**)
   - `openid`, `email`, `profile` (for Firebase Auth — usually added automatically when you sign in)
4. Create credentials → **OAuth client ID** → Application type **Web application**.
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost:3410`
   - `http://127.0.0.1:3410`
   - Your GitHub Pages origin (e.g. `https://<user>.github.io`)
6. Copy the client ID into `.env`:

```env
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
```

### 3. Firebase (cross-device sync)

1. In the [Firebase console](https://console.firebase.google.com/), add Firebase to the same GCP project (or create one).
2. Create a **Web app** and copy its config into `.env`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=1:123456789:web:...
```

3. Enable **Firestore** (native mode) and deploy security rules from this repo:

```bash
firebase deploy --only firestore:rules --project your-project-id
```

4. In **Authentication → Sign-in method**, enable **Google** and paste the same OAuth **Web client ID** from step 2.

Restart `npm run dev` after changing `.env`.

If the OAuth app is in **Testing** mode, add your Google account as a test user.

Redeploy the auth backend after pulling changes (it forwards the Google `id_token` needed for Firebase):

```bash
# see server/README.md
gcloud functions deploy auth ...
```

## How it works (technical)

1. **Sign in** — Google's authorization-code flow exchanges a code for access + refresh tokens via the backend in `server/`. The refresh token keeps Calendar API access working long-term. The returned ID token also signs you into Firebase Auth for Firestore.
2. **Load user data** — On sign-in, a Firestore listener on `users/{uid}` loads the live plan, block library, archived plans, settings, saved calendar users, target calendar id, push history, and executing group id. Edits from another device show up in real time; local writes debounce ~2s.
3. **Calendars** — Toggle which calendars appear on the grid (hidden ids from Settings are omitted). Events load for the visible FullCalendar range.
4. **Plan & execute** — Groups and tasks are edited in memory via `usePlan`; stack times are derived from anchor + tasks (`resolveStack`). Execution mode locks one group to Starts, tracks `intendedEndAt` and per-block `done`, and syncs `executingGroupId` across devices.
5. **Add / Update calendar** — Push resolved blocks to writable calendars; track `PushedEvent` / `PushSnapshot` for idempotent updates and drift icons. Optional guests per calendar (`sendUpdates: none`).
6. **Settings** — `users/{uid}.settings` holds planning defaults, hidden calendar ids, time step, undo seconds, and auto-end hours.

For every interaction and data field, see [`SPEC.md`](./SPEC.md). For navigating the codebase, see [`AGENTS.md`](./AGENTS.md).

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Local development server |
| `npm run build`| Typecheck + production build |
| `npm run test` | Unit tests (Vitest) |
| `npm run lint` | Lint (oxlint) |
| `npm run preview` | Preview the production build |

## Stack

- Vite + React 19 + TypeScript
- FullCalendar (`timeGrid` + `interaction`)
- Google Identity Services + `gapi.client` Calendar v3
- Firebase Auth + Firestore
- Vitest + oxlint
