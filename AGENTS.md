# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
Timeblock (`time-blocking`) is a Vite + React + TypeScript SPA for time-block planning against Google Calendar. There is **no database**; persistence is the user's Google Drive app-data folder + browser `localStorage`. A small optional token-exchange backend lives in `server/`.

### Services
- **Frontend SPA** (root): the product. Dev server on port 5173. Standard scripts are in `package.json` and the `## Scripts` table in `README.md` (`dev`, `build`, `lint`, `test`, `preview`). Run dev with a bound host/port: `npm run dev -- --host 127.0.0.1 --port 5173`.
- **Auth backend** (`server/`, optional locally): a Google Cloud Functions gen2 function. It is its own npm project (`cd server && npm install`). The SPA defaults to a *deployed* endpoint, so you do NOT need to run it locally unless you set `VITE_AUTH_ENDPOINT` to a local URL. Run it with `cd server && GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... ALLOWED_ORIGINS=http://localhost:5173 npm start` (listens on 8787). See `server/README.md`.

### Non-obvious gotchas
- **The app is 100% gated behind Google sign-in — there is no local-only mode.** Every core feature (calendars, drafting time blocks, pushing events) only renders after an OAuth sign-in. The landing page will render without credentials but shows a red banner and a disabled sign-in button.
- **A real `VITE_GOOGLE_CLIENT_ID` is required at runtime** to sign in. It goes in a `.env` file (copy from `.env.example`). The app throws / shows an error banner if it is missing or left as the `your-client-id` placeholder. Full end-to-end testing additionally requires a Google account (added as an OAuth test user if the app is in Testing mode) and a Google Cloud project with the Calendar API enabled and `http://localhost:5173` + `http://127.0.0.1:5173` as authorized JS origins.
- **Editing `.env` requires restarting `npm run dev`** — Vite only reads env vars at startup.
- **Unit tests need no services or secrets.** `npm run test` (Vitest + happy-dom) covers the core library logic in `src/lib/*.test.ts` and is the fastest way to validate core time-block/anchor/calendar logic.
- Node 22 is required (matches CI in `.github/workflows/deploy.yml`).
