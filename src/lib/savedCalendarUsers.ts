export type SavedCalendarUser = {
  id: string
  name: string
  email: string
}

export type CalendarGuest = {
  email: string
  name?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function guestEmailKey(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

export function normalizeCalendarGuest(raw: unknown): CalendarGuest | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Partial<CalendarGuest>
  if (typeof g.email !== 'string' || !isValidEmail(g.email)) return null
  const email = g.email.trim()
  const name =
    typeof g.name === 'string' && g.name.trim() ? g.name.trim() : undefined
  return name ? { email, name } : { email }
}

export function normalizeCalendarGuests(
  raw: unknown,
): Record<string, CalendarGuest[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, CalendarGuest[]> = {}
  for (const [calendarId, guests] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!calendarId || !Array.isArray(guests)) continue
    const seen = new Set<string>()
    const list: CalendarGuest[] = []
    for (const item of guests) {
      const guest = normalizeCalendarGuest(item)
      if (!guest) continue
      const key = guestEmailKey(guest.email)
      if (seen.has(key)) continue
      seen.add(key)
      list.push(guest)
    }
    if (list.length > 0) out[calendarId] = list
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function cloneCalendarGuests(
  guests: Record<string, CalendarGuest[]> | undefined,
): Record<string, CalendarGuest[]> | undefined {
  return normalizeCalendarGuests(guests)
}

export function normalizeSavedCalendarUsers(raw: unknown): SavedCalendarUser[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SavedCalendarUser[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const u = item as Partial<SavedCalendarUser>
    if (typeof u.id !== 'string' || !u.id) continue
    if (typeof u.email !== 'string' || !isValidEmail(u.email)) continue
    const email = u.email.trim()
    const key = guestEmailKey(email)
    if (seen.has(key)) continue
    seen.add(key)
    const name = typeof u.name === 'string' ? u.name.trim() : ''
    out.push({ id: u.id, name, email })
  }
  return out
}

export function guestChipLabel(
  guest: CalendarGuest,
  savedUsers: SavedCalendarUser[],
): string {
  const key = guestEmailKey(guest.email)
  const saved = savedUsers.find((u) => guestEmailKey(u.email) === key)
  if (saved?.name.trim()) return saved.name.trim()
  if (guest.name?.trim()) return guest.name.trim()
  return guest.email
}

export function mergeCalendarGuests(
  existing: Record<string, CalendarGuest[]> | undefined,
  patch: Record<string, CalendarGuest[]>,
): Record<string, CalendarGuest[]> | undefined {
  const merged: Record<string, CalendarGuest[]> = { ...(existing ?? {}) }
  for (const [calendarId, guests] of Object.entries(patch)) {
    if (!calendarId) continue
    if (guests.length === 0) delete merged[calendarId]
    else {
      merged[calendarId] = guests.map((guest) =>
        guest.name?.trim()
          ? { email: guest.email, name: guest.name.trim() }
          : { email: guest.email },
      )
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function partitionGuests(
  current: CalendarGuest[],
  lastSuccessful: CalendarGuest[],
): { invited: CalendarGuest[]; inviting: CalendarGuest[] } {
  const invitedKeys = new Set(
    lastSuccessful.map((guest) => guestEmailKey(guest.email)),
  )
  const invited: CalendarGuest[] = []
  const inviting: CalendarGuest[] = []
  for (const guest of current) {
    if (invitedKeys.has(guestEmailKey(guest.email))) invited.push(guest)
    else inviting.push(guest)
  }
  return { invited, inviting }
}
