import type { Session } from '@supabase/supabase-js'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase, supabaseConfigError } from './supabase'

type Vehicle = {
  id: string
  name: string
  make: string
  model: string
  year: string
  archived: boolean
}

type FuelEntry = {
  id: string
  vehicleId: string
  filledAt: string
  odometer: number
  gallons: number
  totalCost: number
  isFullTank: boolean
  notes: string
}

type EntryWithMetrics = FuelEntry & {
  milesDriven: number | null
  mpg: number | null
  costPerMile: number | null
}

type DraftEntry = {
  vehicleId: string
  filledAt: string
  odometer: string
  gallons: string
  totalCost: string
  isFullTank: boolean
  notes: string
}

type DraftVehicle = {
  name: string
  make: string
  model: string
  year: string
}

type VehicleRow = {
  id: string
  user_id: string
  name: string
  make: string | null
  model: string | null
  year: string | null
  archived: boolean
}

type FuelEntryRow = {
  id: string
  user_id: string
  vehicle_id: string
  filled_at: string
  odometer: number | string
  gallons: number | string
  total_cost: number | string
  is_full_tank: boolean
  notes: string | null
}

type AppData = {
  vehicles: Vehicle[]
  entries: FuelEntry[]
}

type LoadAppDataOptions = {
  showLoading?: boolean
  preferredVehicleId?: string
  resetDraft?: boolean
}

const themeStorageKey = 'gas-logger:theme'

type AppRoute = '/fillup' | '/history' | '/stats' | '/config'
type ThemePreference = 'light' | 'dark' | 'auto'

const routes: AppRoute[] = ['/fillup', '/history', '/stats', '/config']

const navItems: Array<{ label: string; route: AppRoute; symbol: string }> = [
  { label: 'Fill-up', route: '/fillup', symbol: '➕' },
  { label: 'History', route: '/history', symbol: 'H' },
  { label: 'Stats', route: '/stats', symbol: '𝛴' },
  { label: 'Config', route: '/config', symbol: '⚙' },
]

const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Auto', value: 'auto' },
]

const today = new Date().toISOString().slice(0, 10)
const chartWidth = 320
const chartHeight = 180
const chartPadding = 22

const newVehicleDraft: DraftVehicle = {
  name: '',
  make: '',
  model: '',
  year: '',
}

function createEntryDraft(vehicleId: string): DraftEntry {
  return {
    vehicleId,
    filledAt: today,
    odometer: '',
    gallons: '',
    totalCost: '',
    isFullTank: true,
    notes: '',
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function getEntryDate(entry: FuelEntry) {
  return new Date(`${entry.filledAt}T12:00:00`)
}

function getOneYearAgo() {
  const date = new Date()

  date.setFullYear(date.getFullYear() - 1)
  return date
}

function sortEntries(entries: FuelEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.filledAt === b.filledAt) {
      return a.odometer - b.odometer
    }

    return a.filledAt.localeCompare(b.filledAt)
  })
}

function buildMetrics(entries: FuelEntry[]): EntryWithMetrics[] {
  let previousFull: FuelEntry | null = null

  return sortEntries(entries).map((entry) => {
    const milesDriven =
      entry.isFullTank && previousFull ? entry.odometer - previousFull.odometer : null
    const mpg = milesDriven && milesDriven > 0 ? milesDriven / entry.gallons : null
    const costPerMile =
      milesDriven && milesDriven > 0 ? entry.totalCost / milesDriven : null

    if (entry.isFullTank) {
      previousFull = entry
    }

    return {
      ...entry,
      milesDriven,
      mpg,
      costPerMile,
    }
  })
}

function mapVehicleRow(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    name: row.name,
    make: row.make ?? '',
    model: row.model ?? '',
    year: row.year ?? '',
    archived: row.archived,
  }
}

function mapFuelEntryRow(row: FuelEntryRow): FuelEntry {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    filledAt: row.filled_at,
    odometer: Number(row.odometer),
    gallons: Number(row.gallons),
    totalCost: Number(row.total_cost),
    isFullTank: row.is_full_tank,
    notes: row.notes ?? '',
  }
}

function getVehicleFallbackName(vehicle: Pick<Vehicle, 'year' | 'make' | 'model'>) {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
}

function getVehicleDisplayName(vehicle: Vehicle) {
  return vehicle.name.trim() || getVehicleFallbackName(vehicle) || 'Untitled vehicle'
}

function getDataErrorMessage(action: string) {
  return `${action} Check your connection and try again.`
}

function getUserDisplayName(user: Session['user']) {
  const metadata = user.user_metadata

  return metadata?.display_name?.trim() ?? ''
}

function getUserInitials(displayName: string) {
  const nameParts = displayName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (nameParts.length === 0) {
    return 'U'
  }

  if (nameParts.length === 1) {
    return nameParts[0].slice(0, 2).toUpperCase()
  }

  return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
}

function getCurrentRoute(): AppRoute {
  return routes.includes(window.location.pathname as AppRoute)
    ? (window.location.pathname as AppRoute)
    : '/fillup'
}

function getStoredTheme(): ThemePreference {
  const storedTheme = window.localStorage.getItem(themeStorageKey)

  return storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'auto'
    ? storedTheme
    : 'auto'
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isResetMode, setIsResetMode] = useState(false)
  const [needsPasswordUpdate, setNeedsPasswordUpdate] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false)
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(getStoredTheme)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    function applyTheme() {
      const resolvedTheme = themePreference === 'auto' ? getSystemTheme() : themePreference

      document.documentElement.dataset.theme = resolvedTheme
      document.documentElement.style.colorScheme = resolvedTheme
      window.localStorage.setItem(themeStorageKey, themePreference)
    }

    applyTheme()
    mediaQuery.addEventListener('change', applyTheme)

    return () => mediaQuery.removeEventListener('change', applyTheme)
  }, [themePreference])

  useEffect(() => {
    if (!supabase) {
      return
    }

    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session)
        setAuthLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setNeedsPasswordUpdate(true)
        setAuthMessage('Enter a new password to finish resetting your account.')
      }
      setSession(nextSession)
      setAuthLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabase) {
      setAuthError(supabaseConfigError)
      return
    }

    setAuthError('')
    setAuthMessage('')
    setIsAuthSubmitting(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setIsAuthSubmitting(false)

    if (error) {
      setAuthError(error.message)
      return
    }

    setPassword('')
  }

  async function sendPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabase) {
      setAuthError(supabaseConfigError)
      return
    }

    setAuthError('')
    setAuthMessage('')
    setIsAuthSubmitting(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/fillup`,
    })

    setIsAuthSubmitting(false)

    if (error) {
      setAuthError(error.message)
      return
    }

    setAuthMessage('Check your email for a password reset link.')
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!supabase) {
      setAuthError(supabaseConfigError)
      return
    }

    setAuthError('')
    setAuthMessage('')
    setIsAuthSubmitting(true)

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })

    setIsAuthSubmitting(false)

    if (error) {
      setAuthError(error.message)
      return
    }

    setNewPassword('')
    setNeedsPasswordUpdate(false)
    setAuthMessage('Password updated.')
  }

  async function signOut() {
    await supabase?.auth.signOut()
    setSession(null)
    setNeedsPasswordUpdate(false)
    setPassword('')
    setNewPassword('')
  }

  if (authLoading) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Fuel log</p>
          <h1>Loading your garage...</h1>
        </section>
      </main>
    )
  }

  if (session && needsPasswordUpdate) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Fuel log</p>
          <h1>Set new password</h1>
          <p className="auth-copy">Choose a new password for this account.</p>

          <form className="auth-form" onSubmit={updatePassword}>
            <label>
              New password
              <input
                autoComplete="new-password"
                minLength={6}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <button
              className="primary-button"
              disabled={isAuthSubmitting || Boolean(supabaseConfigError)}
              type="submit"
            >
              {isAuthSubmitting ? 'Saving...' : 'Save password'}
            </button>
          </form>

          {supabaseConfigError && <p className="auth-error">{supabaseConfigError}</p>}
          {authError && <p className="auth-error">{authError}</p>}
          {authMessage && <p className="auth-message">{authMessage}</p>}
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Fuel log</p>
          <h1>{isResetMode ? 'Reset password' : 'Sign in'}</h1>
          <p className="auth-copy">
            {isResetMode
              ? 'Enter your invited email address and we will send a reset link.'
              : 'Enter the invited email address and password for this gas logger.'}
          </p>

          <form
            className="auth-form"
            onSubmit={isResetMode ? sendPasswordReset : signInWithPassword}
          >
            <label>
              Email
              <input
                autoComplete="email"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </label>
            {!isResetMode && (
              <label>
                Password
                <input
                  autoComplete="current-password"
                  minLength={6}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
            )}
            <button
              className="primary-button"
              disabled={isAuthSubmitting || Boolean(supabaseConfigError)}
              type="submit"
            >
              {isAuthSubmitting
                ? isResetMode
                  ? 'Sending...'
                  : 'Signing in...'
                : isResetMode
                  ? 'Send reset link'
                  : 'Sign in'}
            </button>
          </form>

          <button
            className="auth-mode-button"
            type="button"
            onClick={() => {
              setIsResetMode((currentMode) => !currentMode)
              setAuthError('')
              setAuthMessage('')
              setPassword('')
            }}
          >
            {isResetMode ? 'Back to sign in' : 'Forgot password?'}
          </button>

          {supabaseConfigError && <p className="auth-error">{supabaseConfigError}</p>}
          {authError && <p className="auth-error">{authError}</p>}
          {authMessage && <p className="auth-message">{authMessage}</p>}
        </section>
      </main>
    )
  }

  return (
    <AuthenticatedApp
      key={session.user.id}
      session={session}
      onSignOut={signOut}
      themePreference={themePreference}
      setThemePreference={setThemePreference}
    />
  )
}

type AuthenticatedAppProps = {
  session: Session
  onSignOut: () => void
  themePreference: ThemePreference
  setThemePreference: (themePreference: ThemePreference) => void
}

function AuthenticatedApp({
  session,
  onSignOut,
  themePreference,
  setThemePreference,
}: AuthenticatedAppProps) {
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [entries, setEntries] = useState<FuelEntry[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [entryDraft, setEntryDraft] = useState(createEntryDraft(''))
  const [vehicleDraft, setVehicleDraft] = useState(newVehicleDraft)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [isSavingEntry, setIsSavingEntry] = useState(false)
  const [isSavingVehicle, setIsSavingVehicle] = useState(false)
  const [dataError, setDataError] = useState('')
  const userDisplayName = getUserDisplayName(session.user)
  const userInitials = getUserInitials(userDisplayName)
  const canAddVehicle =
    vehicleDraft.make.trim().length > 0 || vehicleDraft.model.trim().length > 0

  const activeVehicles = vehicles.filter((vehicle) => !vehicle.archived)
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? activeVehicles[0]
  const selectedEntries = entries.filter(
    (entry) => entry.vehicleId === selectedVehicle?.id,
  )
  const entriesWithMetrics = useMemo(
    () => buildMetrics(selectedEntries),
    [selectedEntries],
  )
  const recentEntries = [...entriesWithMetrics].reverse()
  const chartEntries = entriesWithMetrics.filter((entry) => entry.mpg)
  const yearlyChartEntries = chartEntries.filter(
    (entry) => getEntryDate(entry) >= getOneYearAgo(),
  )
  const averageMpg =
    chartEntries.reduce((sum, entry) => sum + (entry.mpg ?? 0), 0) /
    (chartEntries.length || 1)
  const totalSpend = selectedEntries.reduce((sum, entry) => sum + entry.totalCost, 0)
  const totalMiles = entriesWithMetrics.reduce(
    (sum, entry) => sum + (entry.milesDriven ?? 0),
    0,
  )
  const costPerMile = totalMiles > 0 ? totalSpend / totalMiles : 0
  const yearlyMpgValues = yearlyChartEntries.map((entry) => entry.mpg ?? 0)
  const minChartMpg = yearlyMpgValues.length
    ? Math.max(0, Math.floor(Math.min(...yearlyMpgValues) - 2))
    : 0
  const maxChartMpg = yearlyMpgValues.length
    ? Math.ceil(Math.max(...yearlyMpgValues) + 2)
    : 1
  const chartRange = Math.max(maxChartMpg - minChartMpg, 1)
  const chartLeft = chartPadding
  const chartRight = chartWidth - chartPadding
  const chartTop = chartPadding
  const chartBottom = chartHeight - chartPadding
  const firstChartDate = yearlyChartEntries[0]
    ? getEntryDate(yearlyChartEntries[0]).getTime()
    : 0
  const lastChartDate = yearlyChartEntries.at(-1)
    ? getEntryDate(yearlyChartEntries.at(-1)!).getTime()
    : firstChartDate
  const chartTimeRange = Math.max(lastChartDate - firstChartDate, 1)
  const linePoints = yearlyChartEntries.map((entry, index) => {
    const dateOffset = getEntryDate(entry).getTime() - firstChartDate
    const x =
      yearlyChartEntries.length === 1
        ? chartWidth / 2
        : chartLeft + (dateOffset / chartTimeRange) * (chartRight - chartLeft)
    const y =
      chartBottom -
      (((entry.mpg ?? 0) - minChartMpg) / chartRange) * (chartBottom - chartTop)

    return {
      entry,
      x,
      y,
      label: `${formatNumber(entry.mpg ?? 0)} MPG on ${formatDate(entry.filledAt)}`,
      key: `${entry.id}-${index}`,
    }
  })
  const linePath = linePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
  const areaPath =
    linePoints.length > 1
      ? `${linePath} L ${linePoints.at(-1)?.x} ${chartBottom} L ${linePoints[0].x} ${chartBottom} Z`
      : ''

  const loadAppData = useCallback(
    async ({
      showLoading = true,
      preferredVehicleId,
      resetDraft = true,
    }: LoadAppDataOptions = {}): Promise<AppData | null> => {
      if (!supabase) {
        setDataError(supabaseConfigError)
        return null
      }

      const client = supabase

      if (showLoading) {
        setIsDataLoading(true)
      }
      setDataError('')

      const [vehiclesResult, entriesResult] = await Promise.all([
        client
          .from('vehicles')
          .select('id, user_id, name, make, model, year, archived')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: true }),
        client
          .from('fuel_entries')
          .select(
            'id, user_id, vehicle_id, filled_at, odometer, gallons, total_cost, is_full_tank, notes',
          )
          .eq('user_id', session.user.id)
          .order('filled_at', { ascending: true })
          .order('odometer', { ascending: true }),
      ])

      if (vehiclesResult.error || entriesResult.error) {
        setDataError(getDataErrorMessage('Unable to load your vehicles and fill-ups.'))
        setVehicles([])
        setEntries([])
        setSelectedVehicleId('')
        setEntryDraft(createEntryDraft(''))
        setIsDataLoading(false)
        return null
      }

      const nextVehicles = ((vehiclesResult.data ?? []) as VehicleRow[]).map(
        mapVehicleRow,
      )
      const nextEntries = ((entriesResult.data ?? []) as FuelEntryRow[]).map(
        mapFuelEntryRow,
      )
      const firstActiveVehicle =
        nextVehicles.find((vehicle) => !vehicle.archived) ?? nextVehicles[0]
      const preferredVehicle = nextVehicles.find(
        (vehicle) => vehicle.id === preferredVehicleId && !vehicle.archived,
      )
      const nextSelectedVehicle = preferredVehicle ?? firstActiveVehicle

      setVehicles(nextVehicles)
      setEntries(nextEntries)
      setSelectedVehicleId(nextSelectedVehicle?.id ?? '')
      if (resetDraft) {
        setEntryDraft(createEntryDraft(nextSelectedVehicle?.id ?? ''))
      }
      setIsDataLoading(false)

      return {
        vehicles: nextVehicles,
        entries: nextEntries,
      }
    },
    [session.user.id],
  )

  useEffect(() => {
    let isMounted = true

    async function load() {
      const data = await loadAppData()

      if (!isMounted || !data) {
        return
      }
    }

    load()

    return () => {
      isMounted = false
    }
  }, [loadAppData])

  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/fillup')
    }

    const handlePopState = () => setRoute(getCurrentRoute())

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(nextRoute: AppRoute) {
    if (nextRoute === route) {
      return
    }

    window.history.pushState({}, '', nextRoute)
    setRoute(nextRoute)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function updateEntryDraft(field: keyof DraftEntry, value: string | boolean) {
    setEntryDraft((draft) => ({ ...draft, [field]: value }))
  }

  function updateVehicleDraft(field: keyof DraftVehicle, value: string) {
    setVehicleDraft((draft) => ({ ...draft, [field]: value }))
  }

  function resetEntryDraft(vehicleId = selectedVehicle?.id ?? '') {
    setEntryDraft(createEntryDraft(vehicleId))
    setEditingEntryId(null)
  }

  function selectVehicle(vehicleId: string) {
    setSelectedVehicleId(vehicleId)
    setEntryDraft((draft) => ({ ...draft, vehicleId }))
  }

  function renderNoVehiclesMessage() {
    return (
      <div className="route-empty-state">
        <strong>No vehicles yet</strong>
        <p>Add a vehicle before logging a fill-up.</p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => navigate('/config')}
        >
          Open config
        </button>
      </div>
    )
  }

  async function submitVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDataError('')

    if (!canAddVehicle) {
      setDataError('Enter a make or model before adding a vehicle.')
      return
    }

    setIsSavingVehicle(true)

    if (!supabase) {
      setDataError(supabaseConfigError)
      setIsSavingVehicle(false)
      return
    }

    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        user_id: session.user.id,
        name: vehicleDraft.name.trim(),
        make: vehicleDraft.make.trim() || null,
        model: vehicleDraft.model.trim() || null,
        year: vehicleDraft.year.trim() || null,
        archived: false,
      })
      .select('id, user_id, name, make, model, year, archived')
      .single()

    if (error) {
      setIsSavingVehicle(false)
      setDataError(getDataErrorMessage('Unable to add that vehicle.'))
      return
    }

    const nextVehicle = mapVehicleRow(data as VehicleRow)

    await loadAppData({
      showLoading: false,
      preferredVehicleId: nextVehicle.id,
      resetDraft: false,
    })

    setIsSavingVehicle(false)
    setSelectedVehicleId(nextVehicle.id)
    setEntryDraft(createEntryDraft(nextVehicle.id))
    setVehicleDraft(newVehicleDraft)
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!entryDraft.vehicleId) {
      setDataError('Add or select a vehicle before saving a fuel entry.')
      return
    }

    setDataError('')
    setIsSavingEntry(true)

    const gallons = Number(entryDraft.gallons)
    const totalCost = Number(entryDraft.totalCost)
    const entryPayload = {
      vehicle_id: entryDraft.vehicleId,
      filled_at: entryDraft.filledAt,
      odometer: Number(entryDraft.odometer),
      gallons,
      total_cost: totalCost,
      is_full_tank: entryDraft.isFullTank,
      notes: entryDraft.notes.trim() || null,
    }

    if (!supabase) {
      setDataError(supabaseConfigError)
      setIsSavingEntry(false)
      return
    }

    const query = editingEntryId
      ? supabase
          .from('fuel_entries')
          .update(entryPayload)
          .eq('id', editingEntryId)
          .eq('user_id', session.user.id)
      : supabase.from('fuel_entries').insert({
          ...entryPayload,
          user_id: session.user.id,
        })

    const { data, error } = await query
      .select(
        'id, user_id, vehicle_id, filled_at, odometer, gallons, total_cost, is_full_tank, notes',
      )
      .single()

    if (error) {
      setIsSavingEntry(false)
      setDataError(getDataErrorMessage('Unable to save that fill-up.'))
      return
    }

    const nextEntry = mapFuelEntryRow(data as FuelEntryRow)

    await loadAppData({
      showLoading: false,
      preferredVehicleId: nextEntry.vehicleId,
    })

    setIsSavingEntry(false)
    resetEntryDraft(nextEntry.vehicleId)
    navigate('/history')
  }

  function editEntry(entry: FuelEntry) {
    setEditingEntryId(entry.id)
    setEntryDraft({
      vehicleId: entry.vehicleId,
      filledAt: entry.filledAt,
      odometer: String(entry.odometer),
      gallons: String(entry.gallons),
      totalCost: String(entry.totalCost),
      isFullTank: entry.isFullTank,
      notes: entry.notes,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    navigate('/fillup')
  }

  async function deleteEntry(entryId: string) {
    setDataError('')

    if (supabase) {
      const { error } = await supabase
        .from('fuel_entries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', session.user.id)

      if (error) {
        setDataError(getDataErrorMessage('Unable to delete that fill-up.'))
        return
      }
    }

    await loadAppData({
      showLoading: false,
      preferredVehicleId: selectedVehicleId,
      resetDraft: false,
    })

    if (entryId === editingEntryId) {
      resetEntryDraft()
    }
  }

  async function archiveVehicle() {
    if (!selectedVehicle || activeVehicles.length < 2) {
      return
    }

    setDataError('')

    if (supabase) {
      const { error } = await supabase
        .from('vehicles')
        .update({ archived: true })
        .eq('id', selectedVehicle.id)
        .eq('user_id', session.user.id)

      if (error) {
        setDataError(getDataErrorMessage('Unable to archive that vehicle.'))
        return
      }
    }

    const nextVehicle = activeVehicles.find(
      (vehicle) => vehicle.id !== selectedVehicle.id,
    )
    const refreshedData = await loadAppData({
      showLoading: false,
      preferredVehicleId: nextVehicle?.id,
    })
    const refreshedNextVehicle =
      refreshedData?.vehicles.find((vehicle) => vehicle.id === nextVehicle?.id) ??
      refreshedData?.vehicles.find((vehicle) => !vehicle.archived)

    setSelectedVehicleId(refreshedNextVehicle?.id ?? '')
    resetEntryDraft(refreshedNextVehicle?.id ?? '')
  }

  return (
    <main className="app-shell">
      {route === '/config' && (
        <header className="topbar">
          <div className="account-chip" aria-label="Current account">
            <span title={userDisplayName || 'Signed in user'}>{userInitials}</span>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>
      )}

      <section className="app-content">
        {dataError && <p className="data-error">{dataError}</p>}

        {isDataLoading ? (
          <section className="screen-panel entry-panel">
            <p className="eyebrow">Loading</p>
            <h2>Getting your vehicles and fill-ups...</h2>
          </section>
        ) : (
          <>
        {route === '/fillup' && (
          <section className="entry-panel screen-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">New fill-up</p>
                <h2>
                  {selectedVehicle
                    ? getVehicleDisplayName(selectedVehicle)
                    : 'Select a vehicle'}
                </h2>
              </div>
              {editingEntryId && (
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => resetEntryDraft()}
                >
                  Cancel edit
                </button>
              )}
            </div>

            {activeVehicles.length === 0 ? (
              renderNoVehiclesMessage()
            ) : (
              <>
            {activeVehicles.length > 1 && (
              <div className="segmented-control" aria-label="Vehicle selector">
                {activeVehicles.map((vehicle) => (
                  <button
                    className={vehicle.id === selectedVehicle?.id ? 'selected' : ''}
                    key={vehicle.id}
                    type="button"
                    onClick={() => selectVehicle(vehicle.id)}
                  >
                    {getVehicleDisplayName(vehicle)}
                  </button>
                ))}
              </div>
            )}

            <form className="entry-form" onSubmit={submitEntry}>
              <div className="field-row">
                <label>
                  Date
                  <input
                    required
                    type="date"
                    value={entryDraft.filledAt}
                    onChange={(event) =>
                      updateEntryDraft('filledAt', event.target.value)
                    }
                  />
                </label>
                <label>
                  Odometer
                  <input
                    required
                    inputMode="decimal"
                    min="0"
                    type="number"
                    value={entryDraft.odometer}
                    onChange={(event) =>
                      updateEntryDraft('odometer', event.target.value)
                    }
                    placeholder="43890"
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  Gallons
                  <input
                    required
                    inputMode="decimal"
                    min="0.001"
                    step="0.001"
                    type="number"
                    value={entryDraft.gallons}
                    onChange={(event) =>
                      updateEntryDraft('gallons', event.target.value)
                    }
                    placeholder="12.400"
                  />
                </label>
                <label>
                  Total cost
                  <input
                    required
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    type="number"
                    value={entryDraft.totalCost}
                    onChange={(event) =>
                      updateEntryDraft('totalCost', event.target.value)
                    }
                    placeholder="43.50"
                  />
                </label>
              </div>

              <label className="toggle-row">
                <input
                  checked={entryDraft.isFullTank}
                  type="checkbox"
                  onChange={(event) =>
                    updateEntryDraft('isFullTank', event.target.checked)
                  }
                />
                <span>Full tank</span>
                <button
                  aria-label="Full tank help"
                  className="info-tooltip"
                  type="button"
                >
                  i
                  <span role="tooltip">
                    Check this when you fill the tank all the way. Uncheck it for a
                    partial fill-up.
                  </span>
                </button>
              </label>

              <label>
                Notes
                <textarea
                  value={entryDraft.notes}
                  onChange={(event) => updateEntryDraft('notes', event.target.value)}
                  placeholder="Road trip, towing, mostly city driving..."
                />
              </label>

              <button
                className="primary-button"
                disabled={!selectedVehicle || isSavingEntry}
                type="submit"
              >
                {isSavingEntry
                  ? 'Saving...'
                  : editingEntryId
                    ? 'Save changes'
                    : '+ Save fuel entry'}
              </button>
            </form>
              </>
            )}
          </section>
        )}

        {route === '/history' && (
          <section className="history-panel screen-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>{recentEntries.length} fuel entries</h2>
              </div>
            </div>

            {activeVehicles.length === 0 ? (
              renderNoVehiclesMessage()
            ) : (
              <div className="entry-list">
                {recentEntries.length === 0 ? (
                  <div className="route-empty-state compact">
                    <strong>No fill-ups yet</strong>
                    <p>Saved fill-ups for the selected vehicle will appear here.</p>
                  </div>
                ) : (
                  recentEntries.map((entry) => (
                <article className="entry-card" key={entry.id}>
                  <div className="entry-main">
                    <strong>{formatDate(entry.filledAt)}</strong>
                    <span>
                      {formatNumber(entry.gallons, 3)} gal ·{' '}
                      {formatCurrency(entry.totalCost)}
                    </span>
                    <small>
                      {entry.isFullTank ? 'Full tank' : 'Partial fill'}
                      {' · '}
                      {entry.mpg ? `${formatNumber(entry.mpg)} MPG` : 'Pending MPG'}
                      {' · '}
                      {entry.milesDriven
                        ? `${entry.milesDriven} miles`
                        : `${entry.odometer} mi`}
                    </small>
                    {entry.notes && <p className="entry-note">{entry.notes}</p>}
                  </div>

                  <div className="entry-actions">
                    <button
                      type="button"
                      aria-label={`Edit entry from ${formatDate(entry.filledAt)}`}
                      title="Edit entry"
                      onClick={() => editEntry(entry)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M4 20h4.6L19.4 9.2a2.1 2.1 0 0 0 0-3l-1.6-1.6a2.1 2.1 0 0 0-3 0L4 15.4V20Z" />
                        <path d="m13.5 6 4.5 4.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete entry from ${formatDate(entry.filledAt)}`}
                      title="Delete entry"
                      onClick={() => deleteEntry(entry.id)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M4 7h16" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M6 7l1 13h10l1-13" />
                        <path d="M9 7V4h6v3" />
                      </svg>
                    </button>
                  </div>
                </article>
                  ))
                )}
              </div>
            )}
          </section>
        )}

        {route === '/stats' && (
          <section className="stats-panel screen-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Summary</p>
                <h2>Current performance</h2>
              </div>
            </div>

            {activeVehicles.length === 0 ? (
              renderNoVehiclesMessage()
            ) : (
              <>
            <div className="stat-grid">
              <article className="stat-card highlight">
                <span>Average MPG</span>
                <strong>{chartEntries.length ? formatNumber(averageMpg) : '--'}</strong>
              </article>
              <article className="stat-card">
                <span>Cost / mile</span>
                <strong>{costPerMile ? formatCurrency(costPerMile) : '--'}</strong>
              </article>
            </div>

            <div className="chart-wrap">
              <div className="chart-heading">
                <span>MPG trend</span>
                <small>{yearlyChartEntries.length} intervals in the last year</small>
              </div>
              <div className="line-chart" aria-label="MPG trend chart">
                {yearlyChartEntries.length ? (
                  <>
                    <svg
                      role="img"
                      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                      aria-labelledby="mpg-chart-title mpg-chart-description"
                    >
                      <title id="mpg-chart-title">MPG trend</title>
                      <desc id="mpg-chart-description">
                        Line chart showing full-tank MPG intervals from the last year.
                      </desc>
                      <line
                        className="chart-grid-line"
                        x1={chartLeft}
                        x2={chartRight}
                        y1={chartTop}
                        y2={chartTop}
                      />
                      <line
                        className="chart-grid-line"
                        x1={chartLeft}
                        x2={chartRight}
                        y1={chartBottom}
                        y2={chartBottom}
                      />
                      {areaPath && <path className="chart-area" d={areaPath} />}
                      {linePath && <path className="chart-line" d={linePath} />}
                      {linePoints.map((point) => (
                        <g key={point.key}>
                          <circle className="chart-point" cx={point.x} cy={point.y} r="4" />
                          <title>{point.label}</title>
                        </g>
                      ))}
                    </svg>
                    <div className="chart-scale" aria-hidden="true">
                      <span>{maxChartMpg} MPG</span>
                      <span>{minChartMpg} MPG</span>
                    </div>
                    <div className="chart-dates" aria-hidden="true">
                      <span>{formatDate(yearlyChartEntries[0].filledAt)}</span>
                      <span>
                        {formatDate(
                          yearlyChartEntries[yearlyChartEntries.length - 1].filledAt,
                        )}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="empty-state">
                    Add two full-tank entries within a year to see MPG.
                  </p>
                )}
              </div>
            </div>
              </>
            )}
          </section>
        )}

        {route === '/config' && (
          <section className="vehicle-panel screen-panel">
          <section className="config-section">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Appearance</p>
                <h2>Theme</h2>
              </div>
            </div>

            <div className="segmented-control theme-control" aria-label="Theme selector">
              {themeOptions.map((option) => (
                <button
                  aria-pressed={themePreference === option.value}
                  className={themePreference === option.value ? 'selected' : ''}
                  key={option.value}
                  type="button"
                  onClick={() => setThemePreference(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="config-section">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Vehicles</p>
              <h2>{activeVehicles.length} active</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Archive selected vehicle"
              onClick={archiveVehicle}
              disabled={activeVehicles.length < 2}
            >
              -
            </button>
          </div>

          <div className="vehicle-list" aria-label="Vehicle selector">
            {activeVehicles.length === 0 ? (
              <div className="route-empty-state compact">
                <strong>No active vehicles</strong>
                <p>Add a vehicle with a make or model to start logging fuel.</p>
              </div>
            ) : (
              activeVehicles.map((vehicle) => (
              <button
                className={`vehicle-tile ${
                  vehicle.id === selectedVehicle?.id ? 'selected' : ''
                }`}
                key={vehicle.id}
                type="button"
                onClick={() => selectVehicle(vehicle.id)}
              >
                <span>{getVehicleDisplayName(vehicle)}</span>
                <small>
                  {getVehicleFallbackName(vehicle)}
                </small>
              </button>
              ))
            )}
          </div>

          <form className="compact-form" onSubmit={submitVehicle}>
            <label>
              Name
              <input
                value={vehicleDraft.name}
                onChange={(event) => updateVehicleDraft('name', event.target.value)}
                placeholder="Truck, Civic, Work van"
              />
            </label>
            <div className="field-row">
              <label>
                Make
                <input
                  value={vehicleDraft.make}
                  onChange={(event) => updateVehicleDraft('make', event.target.value)}
                  placeholder="Ferrari"
                />
              </label>
              <label>
                Model
                <input
                  value={vehicleDraft.model}
                  onChange={(event) => updateVehicleDraft('model', event.target.value)}
                  placeholder="California"
                />
              </label>
            </div>
            <label>
              Year
              <input
                value={vehicleDraft.year}
                onChange={(event) => updateVehicleDraft('year', event.target.value)}
                inputMode="numeric"
                placeholder="2014"
              />
            </label>
            <button
              className="secondary-button"
              disabled={!canAddVehicle || isSavingVehicle}
              type="submit"
            >
              {isSavingVehicle ? 'Adding...' : '+ Add vehicle'}
            </button>
          </form>
          </section>
        </section>
        )}
          </>
        )}
      </section>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <button
            aria-current={route === item.route ? 'page' : undefined}
            className={route === item.route ? 'active' : ''}
            key={item.route}
            type="button"
            onClick={() => navigate(item.route)}
          >
            <span>{item.symbol}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </main>
  )
}

export default App
