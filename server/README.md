# Auth token-exchange function

Tiny Cloud Run function that keeps the OAuth client secret off the browser.
The SPA sends a Google Identity Services popup auth code to `/exchange` and
gets back an access token plus a long-lived refresh token; `/refresh` mints
new access tokens without user interaction, and `/revoke` revokes on sign-out.

## Deploy

```bash
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  --project time-blocker-502417

gcloud functions deploy auth \
  --gen2 \
  --project time-blocker-502417 \
  --region us-west1 \
  --runtime nodejs22 \
  --source server \
  --entry-point auth \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars "^@^GOOGLE_CLIENT_ID=<client id>@GOOGLE_CLIENT_SECRET=<client secret>@ALLOWED_ORIGINS=https://phoebejaffe.github.io,http://localhost:5173"
```

The client secret comes from Google Cloud console → APIs & Services →
Credentials → the OAuth 2.0 web client. `ALLOWED_ORIGINS` is a comma-separated
CORS allowlist (the `^@^` prefix switches gcloud's env-var delimiter to `@`).

The `/exchange` response includes `id_token` when the client requests OpenID scopes
(`openid email profile`). The SPA uses that to sign into Firebase Auth for Firestore sync.

## Firebase (Firestore sync)

Cross-device plan data lives in Firestore (`users/{uid}`), not Google Drive.
After deploying this function, also:

1. Enable **Google** under Firebase → Authentication → Sign-in method, using the same Web client ID.
2. Deploy Firestore rules: `firebase deploy --only firestore:rules --project time-blocker-502417`
3. Set `VITE_FIREBASE_*` in the SPA `.env` (see root `.env.example`).

## Local dev

```bash
cd server && npm install
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
ALLOWED_ORIGINS=http://localhost:5173 npm start
```
