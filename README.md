# Timeblock

A Vite + React SPA that signs in with Google, shows your calendars, and lets you draft local time-block tasks that start or end at a chosen time — then clear them or push them onto a real Google Calendar.

Your plan, saved lists, and target calendar sync across devices via **Firebase Firestore** (see `server/README.md` for the small token-exchange backend that keeps Google Calendar access working long-term). Sign-in is required — there's no local-only mode.

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
   - `openid`, `email`, `profile` (for Firebase Auth — usually added automatically when you sign in)
4. Create credentials → **OAuth client ID** → Application type **Web application**.
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
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

Redeploy the auth backend after pulling changes (it now forwards the Google `id_token` needed for Firebase):

```bash
# see server/README.md
gcloud functions deploy auth ...
```

## How it works

1. **Sign in** — Google's authorization-code flow exchanges a code for access + refresh tokens via the backend in `server/`. The refresh token keeps Calendar API access working long-term. The returned ID token also signs you into Firebase Auth for Firestore.
2. **Load your plan** — On sign-in, a Firestore listener on `users/{uid}` loads your plan, saved lists, and target calendar (brief loading state). Edits from another device show up in real time.
3. **Calendars** — Toggle which calendars appear. Events load for the visible FullCalendar range.
4. **Plan** — Build an ordered task list, then set **Ends at** / **Starts at** for the whole stack. Save and reload named lists anytime — edits sync to Firestore a couple seconds after you stop typing.
5. **Add to calendar** — Push the stacked tasks to a Google calendar. The plan stays put. You'll get a warning if you already pushed a list for that day.

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
- Firebase Auth + Firestore
