# AGENTS.md — working in this repo

This file orients an AI agent (or a new human contributor) working in the
Time Block codebase. For the full, exhaustive specification of every data
type, interaction, and flow, see **[`SPEC.md`](./SPEC.md)** — it's detailed
enough to rebuild the app from scratch. This file is the shorter "how do I
find my way around and not break things" companion.

**Keep `SPEC.md` in sync.** If you make a behavior-visible change (new
feature, changed interaction, new/changed data field), update the relevant
section of `SPEC.md` in the same change. If you're unsure whether something
is spec-worthy, check whether `SPEC.md` already describes the area you're
touching.

## What this app is

Time Block is a single-page **time-blocking** app: sign in with Google, see
your real Google Calendar events overlaid on a day/week grid, and draft
ordered lists of "blocks" (title + duration) in a sidebar. Each list
("plan") is anchored to a single time — "**starts** at 9am" or
"**ends** at 5pm" — and blocks lay out back-to-back from that anchor. You
can drag a whole stack around the calendar, reorder/edit blocks, save a
plan's blocks as a reusable "default" checkpoint, keep a personal library
of reusable blocks, archive whole plans off Home and stamp them back as
fresh copies, invite guests when pushing to Google Calendar, tune synced
Settings (defaults, hidden calendars, time step, undo windows, auto-end),
and push ("Add"/"Update") the resolved blocks as real events onto a chosen
Google Calendar. Everything syncs across devices via Firestore, keyed by the
signed-in user. Sign-in is mandatory — there's no local-only mode.

## Stack at a glance

- Vite + React 19 + TypeScript (strict), no router, no external state
  library (state lives in a handful of composed custom hooks).
- FullCalendar (`timeGrid` + `interaction`) for the calendar grid.
- Google Identity Services + `gapi.client` for Calendar API access; a tiny
  stateless backend (`server/`) does the OAuth token exchange so the client
  secret never reaches the browser.
- Firebase Auth + Firestore for cross-device sync (one document per user).
- Vitest (`happy-dom`) for tests; oxlint for linting; one global
  hand-written stylesheet (`src/index.css`) — no CSS framework.

## Commands

```bash
npm run dev      # local dev server (localhost:5173)
npm run build    # tsc -b && vite build (typecheck is part of the build)
npm run test     # vitest run
npm run lint     # oxlint
npm run preview  # preview a production build
```

See `README.md` for first-time `.env` / Google Cloud / Firebase setup.
`server/README.md` covers the token-exchange backend deploy.

## How the app is wired together (start here)

`src/App.tsx` is the only place that composes everything. It owns almost no
logic itself — it wires hooks together and passes derived state down to two
main children, `TaskSidebar` and `CalendarView`. If you're trying to
understand a feature end-to-end, start in `App.tsx` and follow the prop
that's relevant to it.

| Hook | File | Owns |
| --- | --- | --- |
| `useGoogleSession` | `src/hooks/useGoogleSession.ts` | Google OAuth session (sign in/out, token refresh, ready/busy/error) |
| `useCalendarEvents` | `src/hooks/useCalendarEvents.ts` | Google Calendar list + events for the visible date range, visible-calendar toggles |
| `usePlan` | `src/hooks/usePlan.ts` | In-memory CRUD for the Plan (groups/tasks) — the local editing buffer |
| `useUserData` | `src/hooks/useUserData.ts` | Everything synced via Firestore: plan (via a callback into `usePlan`), block library, archived plans, settings, saved calendar users, target calendar id, push history, executing group id |
| `useNotice` | `src/hooks/useNotice.ts` | Bottom-of-screen toast state |
| `useSidebarWidth` / `useMobileSplit` | `src/hooks/*` | Persisted desktop sidebar width / mobile split percentage |
| `useCalendarZoom` / `useTaskStackDrag` | `src/hooks/*` | Calendar-only interaction helpers (pinch/scroll zoom; drag-a-whole-stack visuals) |

Domain model + pure logic (no React) lives in `src/lib/`:

| File | Contents |
| --- | --- |
| `src/lib/tasks.ts` | `Task`, `BlockGroup`, `BlockGroupCheckpoint`, `BlockLibrary` types; stack resolution (`resolveStack`); plan/group/task/checkpoint mutators; execution helpers (`prepareGroupForExecution`, `isGroupExecutableNow`, auto-end); date/formatting helpers |
| `src/lib/userSettings.ts` | Synced `UserSettings` (`users/{uid}.settings`): defaults, time step (1/2/5/15 min), undo seconds, auto-end hours, hidden calendar ids |
| `src/lib/planArchive.ts` | Archived plans + folders (`PlanArchive`); search, duplicate, move, reorder |
| `src/lib/savedCalendarUsers.ts` | Address book (`SavedCalendarUser`) and per-calendar guests (`CalendarGuest`); normalize/merge/partition/label helpers |
| `src/lib/calendarApi.ts` | Google Calendar API calls (list/create/update/delete), writable-calendar filter, and the push/sync algorithm (`syncTasksToCalendar`, `deleteGroupFromCalendar`) |
| `src/lib/pushedEvents.ts` | `PushedEvent`/`PushSnapshot` tracking — what's been pushed to Google, for idempotent "Add"/"Update" and drift detection |
| `src/lib/google.ts` | GIS/`gapi` bootstrap, OAuth code exchange, token refresh/scope logic |
| `src/lib/firebase.ts` / `src/lib/userDataSync.ts` | Firebase init + the Firestore read/write for the per-user sync document |
| `src/lib/errors.ts` / `src/lib/notice.ts` | Error-message normalization; toast/notice types + undo duration helpers |

UI components live in `src/components/`; the two big ones are
`TaskSidebar.tsx` (the whole "Plan" panel: groups, tasks, checkpoints,
modals, block-library picker, archived plans, block ··· menus) and
`CalendarView.tsx` (FullCalendar wiring, event rendering/labels, the
stack-drag visual). Notable modals/sheets: `SettingsModal.tsx` (synced
prefs), `SettingsMenu.tsx` (app menu + opens settings/library/help),
`BlockLibraryModal.tsx`, `ArchivedPlansModal.tsx`, `ExecutionModal.tsx`,
`HowItWorksModal.tsx`. Overflow menus portal via `FixedMenuPortal` +
`useFixedMenu` so they aren't clipped by sidebar/modal overflow.

Tests live next to the code they cover (`*.test.ts`), mostly under
`src/lib/`, and run against pure functions — there's little component
testing.

## Key invariants worth knowing before you touch things

- **Stack resolution is pure and derived, never stored.** A group's task
  start/end times are always recomputed from `tasks` + `anchor` via
  `resolveStack` (`src/lib/tasks.ts`) — never persist a resolved time.
- **The calendar view and the sidebar deliberately see different "preview"
  states during a stack drag.** `App.tsx` derives `calendarGroups` (never
  anchor-shifted — the calendar expresses a live drag purely via DOM
  transforms in `useTaskStackDrag`) and `previewGroups` (anchor-shifted, for
  the sidebar). Don't collapse these back into one without understanding
  why they're split (see `SPEC.md` §8.2/§8.3) — it was a deliberate fix for
  a drag-desync bug.
- **`empty`/"spacer" tasks reserve time and render in-app (muted), but are
  never pushed to Google Calendar.** Don't let them leak into
  `syncTasksToCalendar`'s Google-side writes. **`delay: true`** marks an
  "I got delayed" spacer (also empty); delays are created in **execution
  mode** (Starts-locked), not from the planning overflow menu — don't key
  off the title string. **`disabled: true`** crosses the block out in the
  sidebar and omits it from stack layout, the in-app calendar, and Google
  push (as if it weren't in the group); the flag is part of checkpoints.
- **Execution mode** is a single-group modal + top banner (`executingGroupId`
  + `BlockGroup.intendedEndAt` synced via Firestore). Calendar stack-drag is
  off while executing; planning Starts/Ends remains available after ending
  execution. Per-block `done` toggles (pending ↔ finished) live only in the
  execution sidebar and clear when execution ends. **`prepareGroupForExecution`**
  flips to Starts if needed and writes the anchor onto **today's** local day
  (same clock time) so Start eligibility and auto-end agree. A run auto-ends
  N hours after the last non-disabled block (N from Settings, default 2).
  Opening or reopening a run expands the group; the execution sidebar never
  renders it collapsed.
- **Checkpoints are per-group, inline, single-slot.** `BlockGroup.checkpoint`
  holds at most one saved snapshot (tasks + anchor); "drift" is computed by
  comparing title/duration/empty/delay/disabled in order plus anchor
  kind/clock time (ids don't count). UI label is **Save as default** until
  one exists, then **Update default**. Toggling Starts/Ends shifts `anchor.at`
  by the stack duration so blocks keep their calendar position.
- **Push tracking (`PushedEvent`/`PushSnapshot`) is what makes "Add" vs.
  "Update" and the synced/out-of-sync icons work** — it's how the app knows
  what it already wrote to Google without re-fetching. Any change to the
  sync algorithm in `calendarApi.ts` needs to keep this bookkeeping correct.
- **Calendar guests** — `BlockGroup.calendarGuests` remembers last guests per
  Google calendar id. Commit modal uses `savedCalendarUsers` + one-off emails;
  updates use `events.update` with `sendUpdates: none`. Removing an Invited
  chip before Update uninvites them; committing with no calendars selected on
  Update deletes this group's events for that day everywhere they were pushed.
- **Settings** — `targetCalendarId` is top-level on the user doc; everything
  else lives in `settings`. Default target calendar is set only in Settings
  (not overwritten on successful push). `hiddenCalendarIds` filters calendars
  app-wide (picker + commit modal). Time step is 1, 2, 5, or 15 minutes.
  Quick/Major undo seconds (`0` disables undo) feed `undoNoticeOptions`.
- **Plan block rows** — disable icon stays on the row; Edit / Add to library /
  Delete live in a per-block ··· menu (`TaskBlockMenu` in `TaskSidebar.tsx`).
- **Firestore sync is last-write-wins at the whole-document level** (one doc
  per user at `users/{uid}`, no field-level merge). Local edits debounce
  ~2s before writing. Archived plans live in `planArchive` on that doc,
  not inside `Plan.groups` — Home stays the live stack; Duplicate plan clones
  with new ids (push history does not come along).
- **No comments that narrate the obvious.** Existing code favors short
  comments only where intent/trade-offs aren't obvious from the code itself
  — match that style.

## Before you finish a change

1. Run `npm run build` (typecheck) and `npm run test`; run `npm run lint`
   for anything touching React/JSX.
2. If you changed a data shape, interaction, or added/removed a feature,
   update `SPEC.md`'s corresponding section(s).
3. Check `git status`/`git diff` for uncommitted work already in the tree
   before assuming the working directory matches the last commit — this
   repo sometimes has in-progress changes from other sessions.
