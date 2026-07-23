# Timeblock

A Vite + React SPA that signs in with Google, shows your calendars, and lets you draft local time-block tasks that start or end at a chosen time — then clear them or push them onto a real Google Calendar.

Your plan, saved lists, and target calendar sync across devices via your Google Drive's hidden app-data folder (see `server/README.md` for the small token-exchange backend that keeps you signed in long-term). Sign-in is required — there's no local-only mode.

## Setup

### 1. Install and run

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 2. Google Cloud Console

1. Create a project (or pick an existing one) in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API**.
3. Configure the [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) (External is fine for personal use). Add scopes:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events` (requested only when you tap **Add to calendar**)
4. Create credentials → **OAuth client ID** → Application type **Web application**.
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
6. Copy the client ID into `.env`:

```env
VITE_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
```

Restart `npm run dev` after changing `.env`.

If the OAuth app is in **Testing** mode, add your Google account as a test user.

## How it works

1. **Sign in** — Google's authorization-code flow exchanges a code for an access + refresh token via the backend in `server/`. The refresh token keeps you signed in long-term (tokens auto-refresh while the tab is open, and on return visits, with no extra click). Signing in also grants Drive's `drive.appdata` scope, needed for sync.
2. **Load your plan** — On sign-in, the app fetches your plan, saved lists, and target calendar from Drive (a brief loading state). While the tab stays open, it polls Drive every ~20s (and on tab focus) so edits from another device show up here too.
3. **Calendars** — Toggle which calendars appear. Events load for the visible FullCalendar range.
4. **Plan** — Build an ordered task list, then set **Ends at** / **Starts at** for the whole stack. Save and reload named lists anytime — edits sync to Drive a couple seconds after you stop typing.
5. **Add to calendar** — Push the stacked tasks to a Google calendar. The plan stays put. You’ll get a warning if you already pushed a list for that day.

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Local development server |
| `npm run build`| Typecheck + production build |
| `npm run test` | Unit tests (Vitest) |
| `npm run preview` | Preview the production build |

## Stack

- Vite + React + TypeScript
- FullCalendar (`timeGrid`)
- Google Identity Services + `gapi.client` Calendar v3
