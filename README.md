# Timeblock

A Vite + React SPA that signs in with Google, shows your calendars, and lets you draft local time-block tasks that start or end at a chosen time — then clear them or push them onto a real Google Calendar.

No backend. Tasks live in `localStorage` until you clear them or commit them.

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

1. **Sign in** — Google Identity Services issues an access token in the browser (token model; no server). The token is stored in `localStorage` and restored on refresh; if it expired, the app silently re-requests one for returning users.
2. **Calendars** — Toggle which calendars appear. Events load for the visible FullCalendar range.
3. **Plan** — Build an ordered task list, then set **Ends at** / **Starts at** for the whole stack. Save and reload named lists anytime.
4. **Add to calendar** — Push the stacked tasks to a Google calendar. The local list stays put. You’ll get a warning if you already pushed a list for that day.

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Local development server |
| `npm run build`| Typecheck + production build |
| `npm run preview` | Preview the production build |

## Stack

- Vite + React + TypeScript
- FullCalendar (`timeGrid` / `dayGrid`)
- Google Identity Services + `gapi.client` Calendar v3
