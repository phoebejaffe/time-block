# Time Block — Application Specification

This document describes the "Time Block" application in enough detail that it
could be rebuilt from scratch. It covers what the app does, its data model,
architecture, external integrations, and UI/interaction behavior. It
deliberately omits exact visual styling (colors, spacing, fonts) beyond
what's needed to understand structure and behavior.

## 1. Purpose / elevator pitch

Time Block is a single-page web app for **time-blocking your day**. A user
signs in with Google, sees an overlay of their real Google Calendar events on
a day/week grid, and drafts one or more ordered lists of "blocks" (tasks with
a title and a duration) in a sidebar. Each list ("plan") is anchored
to a single time — either "this plan **starts** at 9:00am" or "this plan
**ends** at 5:00pm" — and the app lays the blocks out sequentially,
back-to-back, from that anchor. The user can drag the whole stack around on
the calendar, reorder/edit/delete individual blocks, reorder whole plans,
save a plan's blocks as a "default" checkpoint and revert back to it later,
maintain a personal library of reusable blocks, and — when
ready — push ("Add to calendar" / "Update") the resolved blocks as real
events onto a chosen Google Calendar. The plan and all related settings sync
in real time across devices via a cloud database (Firestore), keyed by the
signed-in user.

Sign-in is mandatory; there is no local-only/anonymous mode. The app is a
Vite + React + TypeScript SPA with no server-rendered pages, plus one tiny
stateless backend function used only to keep the OAuth client secret out of
the browser.

## 2. Tech stack

- **Build tool / framework:** Vite, React 19, TypeScript, strict mode.
- **Calendar UI:** FullCalendar (`@fullcalendar/react` + `timegrid` +
  `interaction` plugins) — a `timeGrid`-based day/3-day/week view.
- **Auth:** Google Identity Services (GIS) `oauth2.initCodeClient` popup flow
  (authorization-code grant) + `gapi.client` for calling the Calendar API.
- **Cross-device sync backend:** Firebase Authentication (sign-in with
  Google credential) + Cloud Firestore (one document per user).
- **Token-exchange backend:** a minimal stateless HTTP function (deployable
  as a Google Cloud Function / Cloud Run service) that holds the OAuth
  client secret and exchanges/refreshes/revokes tokens on behalf of the SPA.
- **Testing:** Vitest + `happy-dom`.
- **Linting:** oxlint.
- **No CSS framework** — plain hand-written CSS (one global stylesheet) with
  CSS custom properties for a couple of dynamically-controlled layout values
  (sidebar width, mobile split percentage, calendar zoom).
- **No routing library** — the app is a single view; there is no client-side
  router.
- **Installable (PWA icon):** the HTML shell links a web app manifest and
  PNG icons derived from the header brand mark (gradient green square with
  faint vertical stripes) so Add to Home Screen / install uses that mark.
  There is no service worker required for the icon itself.
- **No app-level global state library** (no Redux/Zustand/etc.) — state is
  composed from several custom React hooks, wired together in one top-level
  component.

## 3. High-level architecture

The app is one root component that composes several independent hooks, each
owning one concern, and passes their state/handlers down to two main child
components (a sidebar and a calendar view):

- `useGoogleSession` — Google OAuth session lifecycle (sign in/out, token
  restore/refresh, "ready"/"busy"/"error" flags).
- `useCalendarEvents` — loads the list of the user's Google Calendars and the
  events visible in the calendar's current date range; tracks which
  calendars are toggled visible.
- `usePlan` — in-memory CRUD for the "Plan" (the ordered `BlockGroup`s the
  user is editing; the UI calls each one a plan). This is *not* persisted
  directly; it's the local editing buffer that gets mirrored to/from the
  cross-device store.
- `useUserData` — owns everything that must sync across devices: the Plan
  (via a callback into `usePlan`), the block library, archived plans, the
  chosen "target calendar" for pushing, and calendar-push history. Uses a
  Firestore real-time listener plus a debounced writer.
- `useNotice` — small toast/snackbar state (success/error/info messages,
  optional "Undo" action button, optional auto-dismiss countdown).
- `useSidebarWidth`, `useMobileSplit` — persist (to `localStorage`) and
  expose the user's chosen sidebar width (desktop) or vertical split ratio
  (mobile) between the plan and the calendar.
- `useCalendarZoom`, `useTaskStackDrag` — calendar-only interaction helpers
  (pinch/ctrl-scroll zoom of the time grid; visually shifting a whole block
  stack together while one block in it is being dragged).

Two data domains are kept deliberately separate:

1. **Cross-device data** (synced via Firestore): the Plan (`BlockGroup`s,
   their tasks/anchors, and each group's optional saved checkpoint), the
   block library, archived plans, the chosen target calendar id, and the
   history of what's been pushed to Google Calendar (so the app can tell
   "Add" from "Update" and detect drift).
2. **Device-local data** (kept in `localStorage`, never synced): whether the
   browser remembers the Google session, the sidebar width, and the
   mobile split percentage. A couple of legacy/local-only keys exist purely
   as one-time migration sources into Firestore for users who used an
   older, pre-sync version of the app (safe to omit in a rebuild).

## 4. Domain model

### 4.1 Task (a "block")

```ts
type Task = {
  id: string               // uuid
  title: string
  durationMinutes: number  // integer >= 1
  empty?: boolean          // true = "spacer": reserves time in the stack but
                            // is never sent to Google Calendar
  delay?: boolean          // true = "I got delayed" spacer (implies empty);
                            // identified by this flag, not by title
  disabled?: boolean       // true = omitted from stack layout / calendar /
                            // push (as if not in the group); crossed out in
                            // the sidebar; included in checkpoints
  done?: boolean           // finished during execution; not in checkpoints;
                            // cleared when execution ends
}
```

- Duration is always rounded to a positive integer minute count; the UI
  nudges it in 5-minute steps (arrow keys, or by "scrubbing" — see §7).
- An "empty" task is a placeholder that still consumes time in the stack
  layout (e.g. a deliberate gap). It's still rendered as an event on the
  in-app calendar overlay — with desaturated/muted colors and a reduced
  style in the sidebar row — so the gap is visible, but it is always
  skipped/removed when syncing to Google Calendar (§4.8, §8.5).
- A **delay** task (`delay: true`, always also `empty`) is created by
  **I got delayed** in execution mode (§7.9). On a start-anchored stack
  (execution locks Starts), inserting empty time pushes later blocks later.
  Changing a delay's duration may show an "Undo" toast (§7.6) that restores
  the prior tasks. Delays are tracked by the `delay` flag, not by matching
  the title "Delay".
- A **disabled** task (`disabled: true`) stays in the group's ordered list
  (and in checkpoints) but consumes no stack time — later blocks close the
  gap. It is crossed out in the sidebar, omitted from the in-app calendar
  overlay, and skipped/removed on Google Calendar sync like an empty
  spacer. Toggle via the disable icon between Edit and Delete (§7.3).
- **`done`** marks a block finished during execution (§7.9). It starts unset
  (pending). It is not part of checkpoints and does not affect calendar push.
  Ending execution clears `done` on that group's tasks.

### 4.2 StackAnchor

```ts
type StackAnchor = {
  kind: 'start' | 'end'
  at: string  // ISO datetime
}
```

Defines how a group's tasks are laid out in time (see §4.4).

### 4.3 BlockGroup

```ts
type BlockGroup = {
  id: string
  tasks: Task[]
  anchor: StackAnchor
  name?: string            // shown as the label when collapsed
  color?: string           // hex or CSS color, used for the group's calendar
                            // event fill (never sent to Google Calendar)
  enabled?: boolean        // default true; false = collapsed in the sidebar
                            // and hidden from the
                            // in-app calendar overlay (its tasks are *not*
                            // deleted, and existing Google Calendar events
                            // pushed for it are untouched)
  checkpoint?: BlockGroupCheckpoint  // saved "default" blocks; see §4.6
  intendedEndAt?: string   // ISO; intended stack end while executing (§7.9);
                            // cleared when execution ends; not in checkpoints
}
```

A "Plan" is `{ groups: BlockGroup[] }` — the live **Home** stack. The UI
calls each `BlockGroup` a **plan**; the TypeScript `Plan` type is the Home
stack of those plans. This document keeps the code names (`BlockGroup`,
`Plan.groups`) in technical descriptions; quoted UI labels use “plan.”
There is always at least one group; the UI never allows deleting or archiving
the last remaining Home group. Archived whole-group templates live in a separate
synced `planArchive` field (§4.9), not inside `groups`. Groups are edited
independently — each has its own anchor, its own enabled state, its own
checkpoint, and its own push history — and can be reordered top-to-bottom in
the sidebar via explicit "Move up"/"Move down" menu actions (there is no
group drag-to-reorder; that's reserved for tasks within a group and blocks
within a library category — see §7.8).

### 4.4 Resolving a stack (turning tasks into concrete times)

Given a group's `tasks` (ordered array) and its `anchor`, compute concrete
start/end `Date`s for every task ("resolve the stack"):

- If `anchor.kind === 'start'`: the first task begins at `anchor.at`; each
  subsequent task begins exactly when the previous one ends (no gaps, no
  overlaps) — a forward pass.
- If `anchor.kind === 'end'`: the *last* task ends at `anchor.at`; walk
  backward so each task ends exactly when the next one begins — a
  backward pass.
- **Disabled** tasks keep their slot in the resolved array but contribute
  zero duration (`start === end` at the current cursor), so neighboring
  active tasks abut as if the disabled block were absent.

This resolution is pure and recomputed on every render from `tasks` +
`anchor`; concrete times are never stored per-task.

### 4.5 "Anchor on a given calendar day"

The anchor's `at` stores a full ISO datetime (including a specific calendar
date), but the app always *displays* every group's stack on whichever day
the calendar grid is currently showing — by taking the anchor's clock time
(hours/min/sec) and re-applying it to the visible day. The stored anchor
date only changes for real when the user actually edits the time (or drags
the stack on the calendar) while viewing that day. In other words: the
calendar view always shows "if this group's tasks happened today [or
whatever day is in view], here's when," and only committing an edit persists
that day. Default: a new group anchors "ends at 9:00am today."

### 4.6 Block-group checkpoint (save/revert a group's "default" blocks)

```ts
type BlockGroupCheckpoint = {
  tasks: Array<{
    title: string
    durationMinutes: number
    empty?: boolean
    delay?: boolean
    disabled?: boolean
  }>
  savedAt: string  // ISO
  anchor?: StackAnchor  // saved with newer checkpoints; omitted on legacy ones
}
```

Each group may hold at most one checkpoint (stored inline on the
`BlockGroup`, not as a separate collection) — a snapshot of "the canonical
version of this group's blocks" that the user can always get back to after
making one-off adjustments (e.g. a daily routine that gets tweaked day to
day but should be easy to reset).

- **Update default** snapshots the group's current
  tasks (title, duration, `empty`/`delay`/`disabled` flags, and order — no
  ids) and its current anchor (kind + datetime) as the checkpoint,
  overwriting any previous one.
  Updating an existing checkpoint asks for confirmation via a native dialog
  first. Only offered while the group is enabled, and only when there either
  is no checkpoint yet or the current group has "drifted" from it.
- **Drift** is computed by comparing the group's current tasks against the
  checkpoint's tasks, in order, by title/duration/empty-state/delay/disabled
  (ids ignored; differing lengths always count as drifted), **and** — when
  the checkpoint includes an `anchor` — by comparing anchor `kind` and local
  clock time (`HH:mm`). Changing Starts/Ends or the anchor time therefore
  shows Revert. Legacy checkpoints without `anchor` only compare tasks.
  While drifted, an inline **Revert** button (with its own icon) appears in
  the group footer in **planning** (not in execution mode) — a one-click
  shortcut that replaces the group's tasks wholesale with fresh copies (new
  ids) rebuilt from the checkpoint and restores the saved anchor when
  present, without opening the menu.
- Both saving and reverting show an "Undo" toast (§7.6) that restores the
  exact previous state (the prior checkpoint, or the prior task list and
  anchor, respectively) if clicked.

### 4.7 Block library (reusable individual blocks, organized by category)

```ts
type SavedBlock = { id: string; title: string; durationMinutes: number; empty?: boolean }
type BlockLibraryCategory = { id: string; name: string; blocks: SavedBlock[] }
type BlockLibrary = { categories: BlockLibraryCategory[]; updatedAt: string }
```

A separate, user-managed catalog of individual reusable blocks (distinct
from a group's checkpoint, §4.6 — a library block gets appended to whatever
group you're editing, one or many at a time, rather than replacing/
restoring the whole list). Users create categories, add/edit/delete/
reorder blocks within a category via drag, and rename/reorder/delete whole
categories, from a dedicated "Block library" modal (opened from the app's
settings menu). When adding blocks from the
library into a group, the user multi-selects blocks (in the picker they're
numbered in selection order) and they get appended to the group in that
order as brand-new `Task`s (fresh ids).

### 4.8 Calendar-push tracking (making "Add"/"Update" idempotent and drift-aware)

Two records, persisted per user, are the app's memory of what it has written
to Google Calendar:

```ts
type PushedEvent = {
  calendarId: string
  eventId: string     // Google Calendar event id
  taskId: string       // the Task.id this event represents
  groupId: string
  dayKey: string        // 'YYYY-MM-DD' local date the stack was pushed for
  pushedAt: string       // ISO
}

type PushSnapshot = {
  calendarId: string
  groupId: string
  dayKey: string
  fingerprint: string    // JSON string; see below
  savedAt: string         // ISO
}
```

- `PushedEvent` is one row per Google Calendar event the app created,
  scoped by `(calendarId, groupId, dayKey)` — i.e. a given block, pushed for
  a given group on a given day, to a given calendar, maps to exactly one
  tracked Google event id. Retained for ~31 days, then pruned (both on
  read and after every push/delete).
- `PushSnapshot` is one row per `(calendarId, groupId, dayKey)` capturing a
  fingerprint of exactly what was written on the last *fully successful*
  push, so the UI can tell whether the current in-app stack still matches
  what's on the calendar (see §8.3) without re-fetching from Google.
- `fingerprint` = `JSON.stringify({ kind, at, items: [[taskId, title,
  startISO, endISO], ...] })` for every non-empty resolved task, built from
  the *anchor* and the resolved tasks (so it changes if the anchor time,
  any title, or any duration/order changes).

### 4.9 Archived plans (whole-group templates, off Home)

Home stays a short stack of *live* groups. Everything else lives in an
**Archived plans** library — whole-group templates, distinct from the block
library (§4.7), which is for individual reusable blocks.

```ts
type ArchivedPlanTask = {
  title: string
  durationMinutes: number
  empty?: boolean
  delay?: boolean
  disabled?: boolean
}

type ArchivedPlan = {
  id: string
  tasks: ArchivedPlanTask[]
  anchor: StackAnchor          // kind + clock time; day is remapped on restore
  archivedAt: string           // ISO
  name?: string
  color?: string
  checkpoint?: BlockGroupCheckpoint
}

type ArchiveFolder = { id: string; name: string; plans: ArchivedPlan[] }

type PlanArchive = { folders: ArchiveFolder[]; updatedAt: string }
```

- Stored as its own Firestore field (`users/{uid}.planArchive`), parallel to
  `blockLibrary` — **not** inside `Plan.groups`.
- Folders are a flat user-created list (no nesting). A built-in **Unfiled**
  folder (id `unfiled`) always exists and cannot be renamed or deleted;
  user folders can be renamed and deleted (a nested picker asks which other
  folder should receive their plans, including Unfiled; an empty folder is
  removed immediately). All folders, including Unfiled, can be reordered
  with Move up / Move down.
- **Archive** (plan ··· menu) takes the live group off Home and writes a
  snapshot into Unfiled: name, color, tasks (title/duration/empty/delay/
  disabled — no live ids, no `done`), optional checkpoint, and anchor kind +
  clock time. Google events already pushed for that group are left alone
  (same as collapsing a group). Disabled on the last remaining Home group
  and while that group is in a run (toast: "End run first."). An Undo toast
  restores the **same** group object (same ids, so push history still
  matches) at its previous index and removes the archive snapshot.
- **Add copy to home** stamps a *new* enabled group (fresh ids) onto the end of
  Home with copied tasks, name, color, and checkpoint. The archived original
  stays put. Anchor clock time is kept and remapped onto today (same idea as
  Duplicate). Push history does not come along. After add, the new
  group is scrolled into view and expanded. The archive modal stays open so
  several plans can be restored in one sitting.

## 5. Authentication & authorization

### 5.1 Why a backend is needed at all

Google's OAuth "authorization code" flow (used here so a **refresh token**
is issued, letting sign-in persist indefinitely rather than needing a fresh
interactive login every ~1 hour) requires a client secret to redeem the
code. A pure-client SPA cannot hold that secret, so a tiny backend function
does only this narrow job — it never sees the user's calendar data.

### 5.2 Backend: token-exchange function

A stateless HTTP endpoint (framework-agnostic; reference implementation
uses Google's Functions Framework for Node, deployable to Cloud
Functions/Cloud Run) exposing three POST routes:

- `POST /exchange` — body `{ code }`. Exchanges a GIS popup authorization
  code for tokens using `redirect_uri: 'postmessage'` (required for popup
  code clients) and `grant_type: authorization_code`. Returns
  `{ access_token, expires_in, refresh_token, scope, id_token }`.
- `POST /refresh` — body `{ refresh_token }`. Mints a new access token via
  `grant_type: refresh_token`. Returns `{ access_token, expires_in, scope }`.
  On failure with an `invalid_grant`-style 400 from Google, respond 401 so
  the client knows to force a fresh interactive sign-in.
- `POST /revoke` — body `{ token }`. Revokes a token at Google's revoke
  endpoint (best-effort; always returns `{ ok: true }`).

Cross-cutting behavior:
- CORS: only echoes `Access-Control-Allow-Origin` for an explicit allow-list
  of origins (configured via env var); handles `OPTIONS` preflight.
- Reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from environment; 500s
  if either is missing.
- All three routes always call Google's real token/revoke endpoints
  server-side; the function does no persistence of its own (fully
  stateless — safe to run as a single serverless function per app, shared
  by all users).

### 5.3 Client-side session flow

1. On boot, load the GIS script (`accounts.google.com/gsi/client`) and the
   `gapi` client script (`apis.google.com/js/api.js`) with the Calendar v3
   discovery doc, in parallel.
2. Try to restore a previous session from `localStorage`: if a stored
   access token hasn't expired, apply it directly to `gapi.client`; if it
   has expired but a refresh token is stored, call the backend's
   `/refresh` immediately (no user gesture needed — works across full page
   reloads and browser restarts). If neither works, the user is
   "signed out" and sees the sign-in screen.
3. **Sign in** (user-initiated only): open a GIS popup
   (`initCodeClient(...).requestCode()`) requesting the calendar
   **read-only** scope plus `openid email profile` (needed so the token
   endpoint also returns an `id_token`), with `include_granted_scopes:
   true`. On success, exchange the returned code via the backend's
   `/exchange`, store the resulting tokens, apply the access token to
   `gapi.client`, and — if Firebase is configured — sign into Firebase
   Auth using `GoogleAuthProvider.credential(id_token, access_token)` so
   Firestore rules can authorize this user.
4. **Incremental scope request**: calendar *write* access
   (`calendar.events` scope) is requested lazily — only the first time the
   user actually tries to push to a calendar — via another popup requesting
   the union of read + write + openid scopes. Once granted in this
   session, it's remembered (checked against an in-memory `grantedScopes`
   set) so later pushes don't re-prompt.
5. **Background refresh loop**: while the tab is open, a timer checks every
   ~60s whether the stored access token will expire within 5 minutes and,
   if so, silently refreshes it via the backend; also refreshes
   immediately whenever the tab regains focus/visibility (to counteract
   background-tab timer throttling).
6. **Sign out**: confirm via a native `confirm()` dialog; revoke the
   refresh token (or, if none, revoke the access token directly via GIS);
   sign out of Firebase; clear all stored tokens and in-memory scope state.

### 5.4 Client ID handling

- In development, the OAuth client ID must come from an env var
  (`VITE_GOOGLE_CLIENT_ID`); the app shows a blocking banner if it's unset
  or still the placeholder value.
- In production, a client ID can be hard-coded in the bundle (OAuth client
  IDs are not secret) as a fallback so the deployed static site doesn't
  need its own `.env`.
- The token-exchange backend must be configured with the *same* client ID
  (as its own env var) plus the matching client secret; a client ID
  mismatch surfaces as a distinct, explicit error message.

### 5.5 Firebase Auth

- Used purely as the authorization mechanism for Firestore — "signed in to
  Google" and "signed in to Firebase" are treated as one combined identity;
  the Firebase user's `uid` is the primary key for that user's synced
  document.
- If Firebase env vars are absent, the app still works for calendar
  browsing/pushing, but cross-device sync is unavailable (all sync hooks
  become no-ops); a dev-mode banner flags misconfiguration.

## 6. Google Calendar integration

Implemented via `gapi.client.calendar` (Calendar API v3) once an access
token is applied.

- **List calendars**: `calendarList.list({ minAccessRole: 'reader' })`.
  Normalize into `{ id, summary (prefer summaryOverride), backgroundColor,
  foregroundColor, primary, selected, accessRole }`; sort primary calendar
  first, then alphabetically by name. "Writable" calendars (used for the
  push-target picker) are those with `accessRole` of `owner` or `writer`.
- **List events** for a given calendar + date range:
  `events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy:
  'startTime', maxResults: 2500 })`. Skip cancelled events and events
  missing both start/end. Support both all-day (`date`) and timed
  (`dateTime`) events; tag each with the owning calendar's color (falling
  back to Google's default blue) and a darkened variant for the border.
- Google events loaded this way are rendered read-only (never editable,
  draggable, or resizable) — they exist purely as visual overlay context.
- **Create/update/delete events** (write path, used only when pushing the
  user's plan — see §8) via `events.insert` / `events.patch` /
  `events.delete`. Every event created by this app carries a fixed
  description string identifying it as app-created (e.g. "Added via
  Time Block, with love ❤️"). Most accounts get a heart; a small Firebase
  Auth UID allowlist gets a weighted random love/seasonal emoji instead.
  Purely informational, not used for matching (matching is done via the
  tracked `PushedEvent` records instead, see §8).
- **404/410/"not found" detection**: a small helper normalizes many
  different shapes of Google API error (numeric HTTP status, nested
  `error.code`, `error.errors[].reason`, or a plain-text message containing
  "not found"/"has been deleted") into a single boolean, since if the user
  deleted a previously-pushed event by hand on Google Calendar, the app
  should just recreate it rather than fail.

## 7. UI layout

### 7.1 Top-level structure

Three states, chosen by session/auth status:

1. **Loading gate** — shown while the Google session is still restoring, or
   (once signed in) while the user's cross-device data is still loading
   from Firestore. Centered spinner + "Loading your plan…".
2. **Signed-out gate** — centered card: heading **"Time blindness is real!"**,
   then **"Time Block lets you draft plans that end when you need to leave, and
   compensate for delays as you go so you stay on time. Your plan syncs to
   your Google account."**, and a single "Sign in with
   Google" button. Anchored to the bottom-right of the viewport (muted and
   unboxed): build timestamp, then a low-key collapsible **"Session
   diagnostics"** control (sentence case, no border/card chrome). (A dev-only
   banner appears above this if required env vars are missing, explaining
   which ones and to restart the dev server.)
3. **Main app body** — a two-pane layout:
   - **Sidebar** (the "Plan"/task list) on one side.
   - **Calendar** (FullCalendar time grid + its own toolbar) filling the
     rest.
   - A **draggable resize handle** between them.

A slim error banner can appear above everything (session errors, sync
errors, or missing-config warnings) and a toast/notice can appear
overlaying the bottom of the screen for transient success/error/info
messages (see §7.6).

### 7.2 Responsive behavior (desktop vs. mobile split)

There's a single breakpoint (~720px viewport width):

- **Desktop (≥ breakpoint):** sidebar and calendar sit **side by side**.
  The sidebar has a fixed pixel width (persisted, default ~380px, clamped
  to a min/max range e.g. 350–900px, and capped at ~70% of the available
  body width) adjustable by dragging a **vertical** resize handle between
  them.
  - The calendar toolbar's "Week" view option is only offered at this
    width or wider (an already-open week view auto-falls-back to a 3-day
    view if the window narrows below the breakpoint).
- **Mobile (< breakpoint):** sidebar and calendar are stacked **vertically**
  (sidebar takes the top portion, calendar the bottom), with sizing driven
  by a persisted **percentage** split (default ~42%, clamped e.g. 18–72%)
  adjustable by dragging a **horizontal** resize handle between them.

Both the pixel width and the percentage are persisted to `localStorage`
independently (only one applies at a time depending on viewport, but both
are remembered so switching device orientation/size doesn't lose either
preference) and exposed to CSS via custom properties rather than inline
per-element sizing.

### 7.3 Sidebar ("Plan") layout

Top to bottom:

1. **Header row** — app name/logo mark, plus a settings menu button on the
   far side (an icon-only "hamburger"-style trigger opening a dropdown; see
   §7.5 for its menu contents).
2. **A vertical list of "plan" panels**, one per group in the plan,
   each independently either **expanded** or **collapsed**:
   - **Collapsed** group (its `enabled` flag is off): a single compact row
     showing the group's name (or a synthesized "Unnamed
     N" label) followed by its total duration in parens if it has any
     tasks (e.g. "Morning (1h 30m)"), and a small "···" overflow menu
     (Rename / Move up / Move down / Duplicate / — separator — /
     Archive / Delete) — expand it again by tapping
     the name. Archive is disabled on the last Home group and while
     that group is in a run. If this group is currently executing (§7.9),
     the collapsed row is highlighted (green wash, no grayscale) and keeps
     a **Running** button; clicking it
     expands the group (`enabled: true`) and reopens the run modal.
   - **Expanded** group:
     - **Name row**: the group's name (or its synthesized "Unnamed N"
       label), always visible above the anchor controls — tapping the name
       collapses the group (hides it from the calendar); a **Start plan** /
       **Running**
       button when eligible (§7.9); and a "···" overflow menu on the far
       right — positioned via a portal that flips above/below and clamps
       horizontally to stay on-screen, the same technique used by the
       block library picker — containing, when the group is enabled:
       "Update default" (only shown while there's
       no checkpoint yet or the blocks have drifted from it — see §4.6) /
       — separator — / Rename / a "Change color" swatch input / —
       separator — / Move up / Move down (either omitted if not
       applicable) / Duplicate / — separator — / **Archive** (disabled if
       it's the only remaining Home group, or while this group is in a
       run) / Delete
       (disabled if it's the only remaining group) / — separator — /
       **Delete from calendar** (disabled unless something's currently
       pushed for this group+day).
     - **Anchor row**: a two-state toggle button labeled "Starts" or "Ends"
       (tapping flips the anchor's `kind` and shifts `at` by the stack's
       total duration so the resolved blocks stay on the same calendar
       times — start→end moves `at` forward by the duration; end→start
       moves it backward); the word "at"; a native time input showing the
       anchor's local time (`HH:mm`, 5-minute step); and, if the group has
       any tasks, a read-only summary of the whole stack's start–end time
       range.
     - **Task list**: one row per task, each showing (in order): the task's
       title, truncated with an ellipsis if it doesn't fit rather than
       pushing anything else out of the row; then its duration ("· N min");
       then, if the task is currently reflected on Google Calendar for the
       day in view, a small icon — a checkmark if it exactly matches what
       was last pushed, or a "calendar" glyph if it's out of sync since
       the last push; then edit, disable, and delete icon-buttons (always
       reserved space so long titles can't crowd them out). The disable
       control (bell-with-X) toggles `disabled` —
       strikethrough title, omitted from stack layout/calendar/push (§4.1);
       disabled (non-interactive) on delay spacers.
       Tasks with `empty: true` render in a visually muted/reduced style
       when not being edited. Clicking anywhere on a row's main area
       (other than the trailing icon buttons) opens that task for inline
       editing.
     - **Inline task editor** (replaces a row, or appears as a fresh row at
       the bottom when adding): a text input for the title, separate hours
       and minutes duration fields, a toggle button for the "empty/spacer"
       flag, and Cancel/Save (or Cancel/Add) buttons. See §7.7 for its
       interaction details.
     - **"Add new" row** (bottom of the list, when not actively adding or
       editing): two side-by-side triggers — **"Library block"** opens a
       **block library picker** dropdown (grouped by category, each block
       showing its title + duration, multi-selectable with a running numeric
       selection order, plus an "Add N block(s)" confirm button; shows an
       empty-state message pointing at Settings → Block library if the
       library has no categories yet) and **"Custom"** opens the inline
       task editor directly for a one-off task.
     - **Group footer** (below the task list, on the group's grey outer
       surface, right-aligned; planning mode only): an inline **Revert**
       button whenever the group has drifted from its saved checkpoint
       (§4.6); then an **"Add to calendar"** / **"Update calendar"** /
       **"Update calendars"** button (label swaps to Update once anything
       has been pushed for this group on the viewed day; plural when that
       group+day was pushed to more than one calendar; disabled while
       nothing has ever been pushed and the group has zero tasks; visually
       "soft-disabled" — clickable but styled inert — when the stack
       already exactly matches the last successful push) that opens the
       commit modal (§7.4). In execution mode the same commit button sits
       beside **I’m delayed** under the Start / Intended End controls
       instead, and the group footer is omitted.
3. **"New plan +"** and **"Archived plans"** at the bottom of the group
   list, side by side. New plan appends a fresh empty group (anchored to
   "ends at 9:00am today" by default). Archived plans opens the archive
   modal (§7.4) so restore is one tap from Home.

### 7.4 Modals

All modals share a common shell: a full-screen semi-transparent backdrop
(click-outside or Escape to close), a centered dialog with a header
(title + "×" close button) and a body, rendered via a portal so they sit
above everything else. Modals used:

- **Rename plan** (opened via the plan menu's "Rename" item) — one field
  (plan name); Cancel / Save.
- **Commit to calendar** ("Add to calendar" / "Update calendar" /
  "Update calendars", titled based on whether this group+day has already
  been pushed and to how many calendars) — a multi-select
  checklist of the user's writable calendars (pre-checked from the last
  push for this group+day when updating; deselected calendars have that
  group's events deleted on commit). On open, already-selected calendars
  are bubbled to the top of the list; that order stays fixed while the
  modal is open (toggling a checkbox does not reshuffle). The dialog is
  capped at 80% of the viewport height with the calendar list scrolling
  and Cancel + the matching commit label pinned at the bottom. The primary
  action is
  disabled while busy, while there are no tasks on a fresh Add, or while
  no calendar is selected.
- **Block library** (opened from the settings menu, not from a group) — a
  wider dialog listing every category, each with a name heading, a small
  "···" overflow menu (Rename — opens a nested "Rename category" modal
  stacked on top of this one, one field + Cancel/Save — / — separator —
  / Move up / Move down (either omitted if not applicable) / — separator
  — / Delete category, which asks for confirmation via a native dialog
  first), its own reorderable list of blocks using the same task-row/
  task-editor UI as the sidebar (with shared edit/delete icon buttons), and
  an "New block +" button; plus a "New category +" button below the list.
  Closed via its header's "×" button, clicking outside, or Escape. Shows an
  empty-state message if there are no categories. A freshly-added block
  opens its inline editor with a *blank* title field (unlike the sidebar's
  task editor, this is the one place a draft can be cancelled: if its title
  is still blank when the user cancels, the whole draft block is discarded
  rather than being kept as "Untitled"). Deleting an already-saved block
  shows an "Undo" toast (§7.6), the same mechanism used for deleting a task
  from the plan.
- **Archived plans** (opened from the sidebar footer next to "New plan +"
  or from the settings menu, under Block library) — a wider dialog
  patterned on Block library. Search at the top matches plan names and
  block titles; results flatten across folders with the folder name as a
  quiet subtitle. Below that, named **folder** sections (flat, not nested;
  order as stored, Unfiled included; tapping a folder header collapses or
  expands it, with a
  plan count when collapsed). Each row shows a left color bar, name, and muted
  `N blocks · duration · archived date`; tapping the row expands it in place and shows the
  archived blocks in a mini group panel (light grey wash, no heading/anchor
  bar; white task-row list underneath). **Add copy to home** in
  the row ···
  menu stamps a new copy onto Home and **leaves the modal open**. Row ···:
  Add copy to home / Rename / Change color / Move to folder / Delete from
  archive (Undo toast). Name and color edits apply to the archived snapshot.
  Folder ···: Move up / Move down (omitted at the ends). Named folders
  also have Rename and Delete folder (a nested picker asks which other
  folder should receive the plans; empty folders delete immediately);
  Unfiled cannot be renamed or deleted, and its ··· is hidden when it is
  the only folder.
  **New folder +** opens a nested name dialog (Create).
  Empty archive: "Archive a plan from its ··· menu to tuck it off Home."
  Closed via header "×", click-outside, or Escape. Plans can be
  drag-reordered within a folder.
- **How Time Block works** (help) — opens with why Time Block exists (visualizing
  time for ADHD / time blindness), then a short narrative of planning and
  execution flows; opened from the settings menu.

### 7.5 Settings menu (sidebar header)

An icon-button dropdown containing, top to bottom: "Block library" (opens
that modal), "Archived plans" (opens the archive modal), — separator — /
"How Time Block works" (opens the help modal), "Share app" (copies
`https://phoebejaffe.github.io/time-block/` to the clipboard and toasts
"Link copied."), "Reload App" (clears
Cache Storage / service workers if any, then navigates to the same URL with
a cache-busting query so `index.html` and its hashed JS/CSS are fetched
fresh — plain `location.reload()` is not enough on GitHub Pages / Safari),
then either "Log out" or "Log in" depending on session state, — separator — /
a small non-interactive line showing the app's build timestamp (for diagnosing
which deployed version is running), then the collapsible "Session diagnostics"
panel.

### 7.6 Notices / toasts

A single-slot (only one at a time) toast anchored to the bottom of the
screen, styled per kind (`success` | `error` | `info`), optionally with an
action button (used for "Undo" after deleting a task) and/or a shrinking
progress bar indicating time-to-auto-dismiss. Success and info notices
auto-dismiss after a default delay (~5s, or a custom delay if specified,
e.g. the longer Undo window); error notices persist until the user causes
another notice or the current action completes/clears it, since they must
not be missed.

### 7.7 Time & duration "scrub" interaction

Both the anchor's time `<input type="time">` and a task's duration
hours/minutes `<input type="number">` fields support a secondary
"click-and-drag vertically to change the value" interaction layered on top
of their normal click-to-type behavior, tuned for both mouse and touch:

- A small movement threshold (a few pixels) must be exceeded, and only if
  the drag is more vertical than horizontal, before scrubbing "activates";
  this lets a plain tap/click still open the native picker or focus the
  field for typing, while a deliberate vertical drag changes the value
  without opening the picker (important on mobile, where opening the
  native time picker mid-drag would be disruptive).
- Once active: dragging up increases the value, dragging down decreases it,
  in fixed-size ticks per some number of pixels moved:
  - Duration **minutes** field: 5-minute increments off the nearest
    multiple of 5 (total duration minimum 1 minute).
  - Duration **hours** field: 1-hour increments (minutes preserved).
  - Anchor / intended-end time: 5-minute increments for minutes (rolling the
    hour when crossing `:00` / `:55`, so 10:00 down becomes 9:55 — never a
    same-hour wrap to 10:55), or whole-hour increments if the drag started
    with the cursor/caret over the hour portion of the `HH:mm` text. Arrow
    keys use the same stepping (native minute-segment wrap is overridden).
  - Duration minutes can also be nudged by 5 minutes (hours by 1 hour) via
    the Up/Down arrow keys while the field is focused.
- Releasing simply stops the drag; if scrubbing never activated (i.e. the
  pointer barely moved), the field still receives its normal click
  behavior (focus + select the text, for typing).

### 7.8 Sidebar drag-to-reorder (tasks within a group, and blocks within a
library category)

Pressing and dragging on a task/block row's main content area (title +
duration, not the trailing icon buttons) reorders it within its list:

- A small movement threshold must be exceeded before a drag "activates"
  (so a simple click still opens the inline editor, not a reorder).
- Once active, a light haptic tick fires on supported devices, a body-level
  CSS class flags "reordering" (used to suppress other hover/interaction
  affordances during the drag), and a horizontal line indicator shows where
  the dragged item would land as the pointer moves over other rows
  (computed by comparing the pointer's Y position against each row's
  vertical midpoint).
- Releasing commits the reorder (a no-op if dropped back at/adjacent to its
  original position) and suppresses the row's own click handler for that
  same release (so it doesn't also re-open the editor).

### 7.9 Execution mode

Planning mode is for drafting multiple plans. **Execution mode** is
for running one group against the clock:

1. **"Start plan"** (planning sidebar, to the right of the group's title
   when expanded) appears on an enabled group when wall-clock now is within one
   hour of that group's stack on today (from an hour before start through an
   hour after end), and no other group is already executing. While **this**
   group is executing, the same button stays available (labeled **Running**)
   even if the group is collapsed, to expand it and reopen the run modal.
2. Entering execution: persist `executingGroupId` on the user sync document;
   flip the group to `anchor.kind: 'start'` via `toggleAnchorPreservingStack`
   if needed; set `intendedEndAt` from the resolved stack end if not already
   set for this run; turn the group on (`enabled: true`) if it was collapsed;
   open a full-screen **execution modal**. Reopening a run (Running button
   or the top banner) also expands the group.
3. **Execution modal** shows a centered toolbar title `Running "…"` between
   equal flex rails: plain-text **← Plan mode** flush left (closes the modal,
   same as Escape) and plain-text **End run** flush right. Only that group's
   sidebar panel + the calendar filtered to that group. Starts is locked (no
   kind toggle).
   Stack-drag on the calendar is disabled; event click/select still works.
   Block durations, order, add/delete, empty spacers, checkpoints (Update
   default), library add, and calendar commit still work; the inline
   **Revert** button is hidden and the commit button sits beside
   **I’m delayed** (group footer omitted). The group always renders
   **expanded**
   (never the collapsed row); the title row is hidden (no
   collapsing), and the "···" overflow sits on the Start / Intended End
   row instead. **Delete** is omitted from the menu.
   Start / Intended End / the end-status strip stay pinned at the top of the
   pane while the block list scrolls beneath. On open, the calendar scrolls
   so the group's blocks are in view. Calendar ‹ › are disabled when
   the next step would leave the local days occupied by the executing stack
   (a stack may span midnight).
   **"I’m delayed"** (with a clock icon) inserts an empty spacer titled
   "Delay" with `delay: true`. When wall-clock now is inside a block, insert
   immediately before that block (or before the previous active block when
   still within 5 minutes of the current block's start), sized to the elapsed
   time from that block's start to now rounded to the nearest 5 minutes
   (minimum 5). When now is outside the stack, append at the end — after the
   stack ends, size from stack end to now (minimum 5); otherwise use 5
   minutes. Always available in the execution view (not disabled by time).
4. **Current block**: while wall-clock now falls inside a non-disabled
   block's resolved range (`start ≤ now < end`), that row shows a 2px red
   left border (padding reduced by the same amount so content does not
   indent).
5. **Finished toggle**: beside each non-delay block, a clickable pending icon
   (circle with three dots) or green check when `done`. Starts pending; click
   the icon to toggle `done`. Clicking the row title/main area opens the
   inline editor (same as planning) so duration/title edits stay one tap away.
   Delay spacers omit the control but keep matching empty space so rows
   align; clicking a delay row's title still opens the editor. Cleared with
   `intendedEndAt` when execution ends.
6. **End time**: above the status block, show scrubbable **Start** and
   **Intended End** time inputs. The status block shows green **Ending on
   time at …**, green **✨ Ending early at … (Xm early)**, or red
   **Ending late at … (Xm late)** — switching **Ending** → **Ended** once
   wall-clock now is at or past the stack's actual end.
7. **← Plan mode** / Escape leaves `executingGroupId` set and shows a
   light-grey **top banner** with left-aligned `Running "…"` (click to
   reopen the modal) and plain-text **End run** flush right. **End run**
   (banner or modal) clears `executingGroupId` and that group's
   `intendedEndAt` and any task `done` flags. After ending execution,
   the user may flip the group back to Ends in planning if they want. Only
   one group may execute at a time. Collapsing the executing group in the
   planning sidebar still leaves the run active: the collapsed
   row is highlighted and its **Running** button expands the group and
   reopens the modal. Execution mode itself never shows a collapsed group.
8. **Auto-end**: a run ends on its own (same as **End run**) once wall-clock
   now is 2 hours or more after the last non-disabled block in the executing
   group, using the stored anchor times (not remapped onto today). If the
   stack has no active blocks, it does not auto-end. Delays that push the
   stack later also push this deadline. A leftover run from a previous day
   ends on the next load or when the tab becomes visible again.

## 8. Core interaction flows

### 8.1 Editing the plan (all local, until synced)

Every plan mutation — add/update/remove/reorder a task, add multiple tasks
at once (from the block library), replace all of a group's tasks (revert to
its saved checkpoint), add/duplicate/remove/reorder a group, rename a
group, recolor a group, enable/disable a group, save/update/revert a
group's checkpoint, or change a group's anchor — goes through a small set
of pure reducer-style functions operating on the whole `Plan` object,
applied via `setState` (no external state library). All of these are
optimistic/instant in the UI; there is no separate "save" step for editing
— persistence happens automatically in the background (§8.4).

Deleting a task shows an "Undo" toast (progress bar over ~5s) that, if
clicked, re-inserts the exact same task object back at its original index.
Saving/updating a group's checkpoint and reverting to it show the same kind
of "Undo" toast, restoring the exact previous checkpoint or task list,
respectively (§4.6).

Deleting a group requires a native `confirm()` dialog ("Delete this plan?")
and is blocked (with an info toast: "Keep at least one plan.") if it's the
only group left. Duplicating a group inserts an
exact copy (fresh ids for the group and every task; tasks/anchor/name
[unnamed]/color/enabled state/checkpoint are all copied) immediately after
the source group. Reordering a group ("Move up"/"Move down" in its overflow
menu, disabled at the top/bottom of the list respectively) swaps its
position with the adjacent group — there is no drag-to-reorder for groups.

### 8.2 Live "preview" while editing (sidebar ⇄ calendar reactivity)

Two kinds of in-progress edits are mirrored onto the calendar overlay
*before* they're committed to the Plan, purely for visual feedback,
resolved via a small preview layer sitting between the raw Plan and what's
actually rendered:

1. **Editing a task's title/duration/empty-flag inline** streams a live
   preview object `{ groupId, taskId, title, durationMinutes, empty }` up
   to the top level on every keystroke/toggle (debounced only by React's
   own render batching — effectively "live"), which is overlaid onto that
   one task (by id) wherever it's rendered, without touching the underlying
   Plan until the form is actually submitted.
2. **Dragging a block-stack event on the calendar** (see §8.3) streams a
   live millisecond delta for the whole group up to the top level. The
   *sidebar's* derived group list applies that delta to the dragged group's
   displayed anchor (so its anchor-row time and task rows preview the new
   position live); the *calendar's* own derived group list deliberately
   does **not** apply it, since the calendar already expresses the live
   drag purely through direct DOM transforms (§8.3) and re-shifting its
   anchor too would double-apply the movement. Neither touches the Plan
   until the drag is dropped.

Both preview mechanisms are pure/derived (`useMemo`) and are cleared
whenever the calendar's visible date range changes.

### 8.3 Calendar rendering & the "task stack" drag

- **Google events**: rendered non-editable, ordered visually behind
  in-app blocks, colored per calendar, with size-dependent CSS classes for
  very short events (≤5 min, ≤10 min, <30 min) so labels still fit.
- **In-app block events** (one FullCalendar event per task, across all
  *enabled* groups, positioned via §4.4's stack resolution against the day
  currently in view — including `empty`/spacer tasks, which render with
  desaturated/muted colors instead of being omitted, and excluding
  `disabled` tasks entirely): each carries the
  group's color (or its muted variant for spacers), is move-only
  (`startEditable: true`, `durationEditable: false` — duration is owned by
  the plan, resizing is explicitly reverted), and tracks its source
  task/group id as custom metadata for click/drag handling. Each event's
  label renders the start time floating beside the title on the first line
  so wrapped lines run flush left, wraps onto further lines as space
  allows, then ellipsizes once it exceeds the event box's available height
  (for ≤5-minute events below 1.7× zoom, time and title stay on one
  baseline and the label overflows above the box instead); label text color is chosen
  per-event for WCAG-contrast against that event's background color (black
  or white, whichever has the higher contrast), with a soft outline in the
  opposite color so it stays legible over any group color.
- **Dragging any one block** in a stack visually moves the **entire
  group's** blocks together by the same delta, in real time, while
  dragging — not just the one grabbed event — by directly transforming the
  DOM elements of the *other* sibling blocks in the same group (never the
  dragged element itself, which FullCalendar's own mirror already tracks)
  in lockstep with FullCalendar's drag "mirror" element, all re-synced on
  every `requestAnimationFrame` tick together with each visible block's
  floating time-label text (so labels never drift out of sync with the
  visual position mid-drag — a bug in an earlier version). The calendar
  itself never re-renders the dragged group's anchor mid-drag (it always
  reads the *unshifted* plan and expresses the live delta purely via these
  DOM transforms); only the sidebar's live preview layer (§8.2) shifts the
  anchor for its own display, so the two views can't fight over layout
  during a drag. A custom `eventAllow` guard: (a) blocks
  drags entirely during a pinch-zoom gesture, (b) refuses to let the block
  cross onto a different calendar day (vertical-only reordering within the
  same day), (c) refuses any change that would alter duration (guards
  against accidental resize being interpreted as a move), and (d) tracks
  the very first allowed pointer position as the drag's local origin so
  only actual pointer movement counts (cancels out any initial
  snap/centering jump FullCalendar itself introduces at drag start).
- **Dropping** reverts FullCalendar's own single-event mutation (since the
  visual move was already handled manually across the whole group) and
  instead commits a single, real anchor update for the group: the anchor's
  stored time is shifted by the same delta that was dragged. This is the
  exact same code path as manually editing the anchor time field — a drag
  is just another way to change the anchor.
- **Clicking** a block (rather than dragging it) opens that task for inline
  editing in the sidebar (scrolling it into view if needed).
- **Zoom**: pinch gesture (touch) or Ctrl/Cmd + mouse-wheel scroll changes a
  vertical zoom factor (clamped 0.95×–2.5×) applied to the calendar's
  row heights via a CSS custom property. Zoom is anchored to the pointer
  (wheel) or the midpoint between the two touches (pinch), adjusting the
  time-grid scroller so content under that point stays put instead of
  stretching from the top. Starting a pinch while a block drag is in
  progress cancels the drag/discards its pending move.
- **View controls**: Day / 3-Day / Week view switch (Week hidden on narrow
  viewports); Previous/Next/Today navigation; a "not today or tomorrow"
  warning icon appears next to Today when the visible range is neither
  (since the whole app's mental model is "plan around now"); a calendars
  picker (checkboxes with each calendar's color swatch and name; visible
  calendars determine which Google events are fetched/shown) and a general
  overflow menu (show/hide all-day events; view switcher).
- **Sync status indicators per task**: while the task's group has been
  pushed to Google Calendar for the day currently in view, its row (in both
  sidebar and implicitly via what's fetched from Google) shows either a
  "matches" checkmark (the live stack exactly matches the last successful
  push's fingerprint for that task) or an "out of sync" calendar icon
  (something changed since the push — title, time, or duration), placed
  immediately after the duration.

### 8.4 Cross-device sync (Firestore)

- One document per user at `users/{uid}` containing: `updatedAt` (ISO),
  `plan` (each group's checkpoint travels inline with it), `blockLibrary`,
  `planArchive`,
  `targetCalendarId`, `pushedEvents`, `pushSnapshots`, `executingGroupId`
  (string or null — which group is in execution mode, if any).
- **On sign-in**, subscribe to that document in real time:
  - If it exists and its `updatedAt` is newer than the last value this tab
    itself wrote, replace all local state with the remote values
    (edits from another device "just show up," typically within a couple
    of seconds).
  - If it doesn't exist yet (first-ever sign-in), seed it immediately from
    whatever's currently in memory (a fresh default plan, or migrated
    legacy `localStorage` data if present — see below) and mark the
    subscription's own initial write as one to *ignore* when it echoes
    back (to avoid re-processing your own write as if it were a remote
    change).
- **On local edits** (to plan, block library, archived plans, target calendar, push
  history, or executing group id), debounce ~2 seconds of inactivity, then
  overwrite the
  whole document with a fresh `updatedAt` — last-write-wins at the
  document level; no field-level merge/CRDT logic.
- **Loading state**: while signed in but the Firestore user isn't
  established yet, or while waiting for the very first snapshot, the app
  shows the full-screen loading gate rather than a half-populated UI.
- **On sign out**: unsubscribe, and reset all cross-device state back to
  defaults in memory (nothing is deleted server-side).
- **Legacy migration**: earlier versions of the app kept pushed-event
  history in plain `localStorage` (pre-dating Firestore sync). If a user's
  Firestore document doesn't yet have any push history, the app opportunistically
  folds in whatever's still sitting in those old `localStorage` keys the
  first time it seeds/loads. Not required for a fresh rebuild, but
  mentioned for completeness.
- **Security model**: Firestore rules restrict every document under
  `users/{uid}` to being read/written only by a request whose
  authenticated uid equals that document's `{userId}` path segment —
  i.e. users can only ever touch their own document.

### 8.5 Pushing the plan to Google Calendar ("Add"/"Update")

Given a group id and a target calendar id (from the commit modal):

1. Ensure the write scope has been granted (prompting interactively if
   this session hasn't asked yet).
2. Resolve the group's anchor onto the day currently being viewed (so what
   gets pushed matches what's on screen), persisting that as the group's
   real anchor if it differs from what's stored.
3. Refuse to proceed (info toast) if the group has zero tasks and nothing
   has ever been pushed for it on this day (nothing to add and nothing to
   update).
4. Run the sync algorithm (§8.5.1) against Google Calendar. While it runs,
   the commit modal shows stepped status text and a determinate progress
   bar (e.g. "Updating 2 of 5…", "Adding 1 of 3…", "Removing 1 of 2…")
   driven by each create/update/remove attempt across the selected
   calendars (and any calendars being deselected). The primary button
   label stays **"Adding to calendar(s)"** / **"Updating calendar(s)"**
   (plural when more than one calendar is selected), not the step text.
5. Merge the returned updated push-tracking rows into the synced store,
   refresh the visible Google events from the API (so the newly
   created/updated/removed events are reflected), and show a toast
   summarizing what happened (e.g. "Calendar sync: updated 2, added 1." /
   "Calendar already up to date." / a partial-failure message naming each
   failed block and why, while still reporting whatever *did* succeed).
6. The commit modal closes only on full success; on partial/total failure
   it stays open so the user can retry. Cancel is disabled while the sync
   is in progress.

#### 8.5.1 Sync algorithm (per group, per day, per target calendar)

Goal: make Google Calendar match the group's current resolved, non-empty,
non-disabled tasks for that day on the target calendar, reusing
previously-created events where possible (so editing a title/time updates
the same event rather than creating a duplicate), tolerating events that
were deleted by hand on the Google side, and cleaning up if the user
changed which calendar this group pushes to. Create/update/delete API
calls for a calendar run concurrently (bounded pool) after the matching
plan is computed; when syncing to multiple calendars, those calendars
are also updated in parallel.

1. **Calendar changed**: for any event previously tracked for this
   group+day but on a *different* calendar than the current target, delete
   it from that old calendar (if it still exists there) and stop tracking
   it.
2. **Per resolved task, in order**:
   - If the task is `empty` (a spacer) or `disabled`: if it was previously
     pushed (i.e. a tracked event exists for this exact task
     id/group/day/calendar), delete that event (if it still exists) and
     stop tracking it — spacers and disabled blocks are never represented
     on Google Calendar.
   - Otherwise: look for a not-yet-reused tracked event from this exact
     group+day+calendar to reuse — prefer one that was tracking this same
     task id; otherwise take any other not-yet-reused one from that pool
     (so if blocks were reordered/renamed, existing events get relabeled
     rather than orphaned). If a candidate exists and it still actually
     exists on Google, `patch` it with the new title/start/end and re-tag
     it as tracking this task id (counts as an "update"). If a candidate
     existed in tracking but was deleted on the Google side, forget it and
     fall through to creating a new one. If no candidate exists, `insert`
     a new event (title = task title, start/end = resolved times, fixed
     description string) and track it (counts as a "create").
   - Never reuse an event tracked for a *different* day or group, even if a
     task id happens to match (ids aren't recycled across days).
3. **Leftover previously-tracked events** for this exact group+day+calendar
   that weren't reused by any task this pass (e.g. the list got shorter)
   get deleted from Google (if still present) and untracked (counts as a
   "remove").
4. Any individual Google API failure during any of the above is caught,
   recorded (which task, which action — create/update/remove — and a
   human-readable message), and does **not** stop the rest of the sync from
   proceeding — the operation always attempts everything and reports a
   final tally of successes plus a list of failures.
5. If (and only if) there were zero failures, save a fresh `PushSnapshot`
   fingerprinting exactly what was written, for the "already up to date"
   detection described in §8.3/§4.8.
6. Prune push-tracking rows older than ~31 days as part of every push.

#### 8.5.2 "Delete from calendar" (per group, per day)

From a group's overflow menu (only enabled once something's tracked for
that group+day): confirm via a native dialog naming the calendar(s)
involved, then delete every tracked event for that exact group+day from
whichever calendar(s) they're actually on (tolerating already-deleted
events; deletes run concurrently with a bounded pool), untrack them,
clear that group+day's push snapshot, refresh the visible Google events,
and toast the result. While deletions run, an info toast shows stepped
progress (`Removing events from calendar: Removing 2 of 7`, pluralizing
"calendar" when more than one is involved). This does not touch the
in-app plan/tasks at all — it only removes calendar-side events.

## 9. Error handling conventions

- A single `formatError(unknown): string` helper normalizes anything that
  might be thrown — native `Error`s, Google API error objects in any of
  their various shapes (`error.message`, `result.error.message`,
  `error.errors[0].message`, HTTP status/statusText, a JSON-encoded string
  body, etc.), or arbitrary values — into one readable string, falling back
  to a generic "Unknown error" rather than ever surfacing `"[object
  Object]"`. Recognizable OAuth error responses get a friendlier, more
  specific message where possible (e.g. explicitly calling out an OAuth
  client-ID mismatch between the frontend and the backend).
- Sign-in / sign-out / calendar-load failures surface as the persistent
  top-of-page error banner (cleared on the next attempt).
- Plan-mutation-adjacent failures (calendar push/delete) surface as toasts,
  not the banner, since they're scoped to one action rather than the whole
  session.

## 10. Persistence summary (what lives where)

| Data | Storage | Synced across devices? |
| --- | --- | --- |
| Plan (groups/tasks/anchors/checkpoints/intendedEndAt) | Firestore `users/{uid}.plan` | Yes |
| Block library | Firestore `users/{uid}.blockLibrary` | Yes |
| Archived plans | Firestore `users/{uid}.planArchive` | Yes |
| Target calendar id | Firestore `users/{uid}.targetCalendarId` | Yes |
| Executing group id | Firestore `users/{uid}.executingGroupId` | Yes |
| Calendar push history (events + snapshots) | Firestore `users/{uid}.pushedEvents` / `.pushSnapshots` | Yes |
| Google OAuth session (access/refresh token, granted scopes) | `localStorage` (device) | No |
| Sidebar width (desktop) | `localStorage` (device) | No |
| Mobile split percentage | `localStorage` (device) | No |
| Which calendars are toggled visible | in-memory only | No (resets on reload) |
| Live edit/drag previews | in-memory only | No |

The app deliberately never persists "which day you're looking at" — every
fresh load starts on today.

## 11. Rebuild checklist (suggested order of implementation)

1. Domain model + pure functions for it (tasks/groups/plan CRUD, stack
   resolution, anchor day-remapping, fingerprinting) with unit tests — no
   UI, no network yet.
2. Static two-pane layout shell (sidebar + calendar placeholder) with the
   resize handles and responsive stacked/side-by-side breakpoint.
3. Calendar view wired to FullCalendar rendering only the in-app block
   events (no Google data yet), including stack drag-to-move and the
   click-to-edit hookup.
4. Sidebar CRUD UI for groups/tasks (add/edit/delete/reorder, anchor
   controls including the scrub interaction), all operating purely on
   local in-memory state.
5. Google sign-in (GIS + gapi) and a minimal token-exchange backend;
   calendar list + read-only event overlay.
6. Firebase Auth + Firestore wiring: real-time subscribe, debounced push,
   sign-out reset, loading gate.
7. Block-group checkpoints (save/revert a "default" block list per group)
   and the block library, and their modals.
8. Calendar push/update/delete sync algorithm and its push-tracking data
   model, plus the sidebar's synced/out-of-sync indicators.
9. Notices/toasts, error-formatting, help modal, settings menu, polish
   (empty/spacer blocks, per-block disable, group colors, group
   enable/disable, group duplicate/reorder, contrast-aware calendar
   event labels).
