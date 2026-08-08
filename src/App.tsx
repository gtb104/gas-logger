import type { Session } from '@supabase/supabase-js'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase, supabaseConfigError } from './supabase'

type Vehicle = {
  id: string
  garageId: string
  name: string
  make: string
  model: string
  year: string
  archived: boolean
}

type FuelEntry = {
  id: string
  garageId: string
  vehicleId: string
  filledAt: string
  odometer: number
  gallons: number
  totalCost: number
  isFullTank: boolean
  notes: string
}

type EstimatedFuelEntry = FuelEntry & {
  isEstimated: true
  estimateSource: 'auto-gap'
}

type DisplayFuelEntry = FuelEntry | EstimatedFuelEntry

type EntryWithMetrics = DisplayFuelEntry & {
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

type GarageMembership = {
  garageId: string
  garageName: string
  role: 'owner' | 'member'
  preferredVehicleId: string | null
}

type GarageSummaryRow = {
  id: string
  name: string
}

type GarageMembershipRow = {
  garage_id: string
  user_id: string
  role: 'owner' | 'member'
  preferred_vehicle_id: string | null
  garages: GarageSummaryRow | GarageSummaryRow[] | null
}

type GarageInvite = {
  id: string
  garageId: string
  email: string
  role: 'owner' | 'member'
  createdAt: string
}

type GarageInviteRow = {
  id: string
  garage_id: string
  email: string
  role: 'owner' | 'member'
  created_at: string
}

type VehicleRow = {
  id: string
  user_id: string
  garage_id: string
  name: string
  make: string | null
  model: string | null
  year: string | null
  archived: boolean
}

type FuelEntryRow = {
  id: string
  user_id: string
  garage_id: string
  created_by: string
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
  invites: GarageInvite[]
  userInvites: GarageInvite[]
}

type LoadAppDataOptions = {
  showLoading?: boolean
  garageId?: string
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
const chartMargin = {
  top: 16,
  right: 12,
  bottom: 30,
  left: 48,
}
const missedFillupThreshold = 1.65
const maxEstimatedMissedFillups = 6

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

function formatSignedNumber(value: number, digits = 1) {
  const formatted = formatNumber(Math.abs(value), digits)

  return `${value >= 0 ? '+' : '-'}${formatted}`
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

function getDaysAgo(days: number) {
  const date = new Date()

  date.setDate(date.getDate() - days)
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

function isAutoEstimatedEntry(entry: FuelEntry) {
  return entry.id.startsWith('auto-estimate:')
}

function getMean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function getMedian(values: number[]) {
  if (!values.length) {
    return 0
  }

  const sortedValues = [...values].sort((a, b) => a - b)
  const middleIndex = Math.floor(sortedValues.length / 2)

  return sortedValues.length % 2
    ? sortedValues[middleIndex]
    : (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)

  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function buildEstimatedMissedEntries(entries: FuelEntry[]): DisplayFuelEntry[] {
  const sortedEntries = sortEntries(entries)
  const fullEntries = sortedEntries.filter((entry) => entry.isFullTank)
  const baselineIntervals = fullEntries
    .slice(1)
    .map((entry, index) => entry.odometer - fullEntries[index].odometer)
    .filter((miles) => miles > 0)
  const intervals = baselineIntervals
  const medianInterval = getMedian(intervals)
  const normalIntervals = intervals.filter(
    (miles) => miles <= medianInterval * missedFillupThreshold,
  )
  const averageMiles = Math.round(getMean(normalIntervals.length ? normalIntervals : intervals))
  const gallonSamples = fullEntries
    .map((entry) => entry.gallons)
    .filter((gallons) => gallons > 0)
  const costSamples = fullEntries
    .map((entry) => entry.totalCost)
    .filter((totalCost) => totalCost > 0)
  const averageGallons = getMean(gallonSamples)
  const averageCost = getMean(costSamples)

  if (!averageMiles) {
    return sortedEntries
  }

  const estimatedEntries: EstimatedFuelEntry[] = []

  fullEntries.slice(1).forEach((entry, index) => {
    const previousEntry = fullEntries[index]
    const milesBetweenFillups = entry.odometer - previousEntry.odometer
    const estimatedCount = Math.min(
      maxEstimatedMissedFillups,
      Math.max(0, Math.round(milesBetweenFillups / averageMiles) - 1),
    )

    if (
      estimatedCount === 0 ||
      milesBetweenFillups < averageMiles * missedFillupThreshold
    ) {
      return
    }

    const previousDate = getEntryDate(previousEntry)
    const nextDate = getEntryDate(entry)
    const daysBetweenFillups =
      (nextDate.getTime() - previousDate.getTime()) / 86_400_000
    const estimatedMilesInterval = milesBetweenFillups / (estimatedCount + 1)

    for (let index = 1; index <= estimatedCount; index += 1) {
      const estimatedOdometer = Math.round(
        previousEntry.odometer + estimatedMilesInterval * index,
      )
      const estimatedDate = Number.isFinite(daysBetweenFillups)
        ? addDays(previousDate, Math.round((daysBetweenFillups / (estimatedCount + 1)) * index))
        : previousDate

      estimatedEntries.push({
        id: `auto-estimate:${previousEntry.id}:${entry.id}:${index}`,
        garageId: entry.garageId,
        vehicleId: entry.vehicleId,
        filledAt: toInputDate(estimatedDate),
        odometer: estimatedOdometer,
        gallons: averageGallons || entry.gallons,
        totalCost: averageCost,
        isFullTank: true,
        isEstimated: true,
        notes: `Automatically estimated missed fill-up between ${formatDate(
          previousEntry.filledAt,
        )} and ${formatDate(entry.filledAt)}.`,
        estimateSource: 'auto-gap',
      })
    }
  })

  return sortEntries([...sortedEntries, ...estimatedEntries])
}

function buildMetrics(entries: DisplayFuelEntry[]): EntryWithMetrics[] {
  let previousFull: DisplayFuelEntry | null = null

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
    garageId: row.garage_id,
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
    garageId: row.garage_id,
    vehicleId: row.vehicle_id,
    filledAt: row.filled_at,
    odometer: Number(row.odometer),
    gallons: Number(row.gallons),
    totalCost: Number(row.total_cost),
    isFullTank: row.is_full_tank,
    notes: row.notes ?? '',
  }
}

function mapGarageMembershipRow(row: GarageMembershipRow): GarageMembership {
  const garage = Array.isArray(row.garages) ? row.garages[0] : row.garages

  return {
    garageId: row.garage_id,
    garageName: garage?.name ?? 'Garage',
    role: row.role,
    preferredVehicleId: row.preferred_vehicle_id,
  }
}

function mapGarageInviteRow(row: GarageInviteRow): GarageInvite {
  return {
    id: row.id,
    garageId: row.garage_id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
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

function getAuthFlowType() {
  const searchParams = new URLSearchParams(window.location.search)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  return searchParams.get('type') ?? hashParams.get('type') ?? ''
}

function sessionNeedsPasswordSetup(session: Session | null, authFlowType: string) {
  if (!session) {
    return false
  }

  const metadata = session.user.user_metadata

  return (
    authFlowType === 'invite' ||
    authFlowType === 'recovery' ||
    Boolean(metadata?.invited_garage_id && !metadata?.password_set)
  )
}

function isInvitePasswordSetup(session: Session | null, authFlowType: string) {
  return authFlowType === 'invite' || Boolean(session?.user.user_metadata?.invited_garage_id)
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isResetMode, setIsResetMode] = useState(false)
  const [needsPasswordUpdate, setNeedsPasswordUpdate] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false)
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(getStoredTheme)

  useEffect(() => {
    function updateOnlineStatus() {
      setIsOnline(navigator.onLine)
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

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
    const initialAuthFlowType = getAuthFlowType()

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        if (sessionNeedsPasswordSetup(data.session, initialAuthFlowType)) {
          setNeedsPasswordUpdate(true)
          setAuthMessage(
            isInvitePasswordSetup(data.session, initialAuthFlowType)
              ? 'Set a password to finish creating your account.'
              : 'Enter a new password to finish resetting your account.',
          )
        }
        setSession(data.session)
        setAuthLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const authFlowType = getAuthFlowType()

      if (event === 'PASSWORD_RECOVERY' || sessionNeedsPasswordSetup(nextSession, authFlowType)) {
        setNeedsPasswordUpdate(true)
        setAuthMessage(
          isInvitePasswordSetup(nextSession, authFlowType)
            ? 'Set a password to finish creating your account.'
            : 'Enter a new password to finish resetting your account.',
        )
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
      redirectTo: `${window.location.origin}/config`,
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

    if (newPassword !== confirmNewPassword) {
      setAuthError('Passwords do not match.')
      return
    }

    setIsAuthSubmitting(true)

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: {
        password_set: true,
      },
    })

    setIsAuthSubmitting(false)

    if (error) {
      setAuthError(error.message)
      return
    }

    setNewPassword('')
    setConfirmNewPassword('')
    setNeedsPasswordUpdate(false)
    setAuthMessage('')
    window.history.replaceState({}, '', '/config')
  }

  async function signOut() {
    await supabase?.auth.signOut()
    setSession(null)
    setNeedsPasswordUpdate(false)
    setPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
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
          <h1>Set password</h1>
          <p className="auth-copy">
            Choose a password so you can sign into Gas Logger later.
          </p>

          <form className="auth-form" onSubmit={updatePassword}>
            <label>
              Password
              <input
                autoComplete="new-password"
                minLength={6}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              Confirm password
              <input
                autoComplete="new-password"
                minLength={6}
                onChange={(event) => setConfirmNewPassword(event.target.value)}
                required
                type="password"
                value={confirmNewPassword}
              />
            </label>
            <button
              className="primary-button"
              disabled={
                isAuthSubmitting ||
                Boolean(supabaseConfigError) ||
                !newPassword ||
                !confirmNewPassword
              }
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
      isOnline={isOnline}
      session={session}
      onSignOut={signOut}
      themePreference={themePreference}
      setThemePreference={setThemePreference}
    />
  )
}

type AuthenticatedAppProps = {
  isOnline: boolean
  session: Session
  onSignOut: () => void
  themePreference: ThemePreference
  setThemePreference: (themePreference: ThemePreference) => void
}

function AuthenticatedApp({
  isOnline,
  session,
  onSignOut,
  themePreference,
  setThemePreference,
}: AuthenticatedAppProps) {
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute)
  const [garageMemberships, setGarageMemberships] = useState<GarageMembership[]>([])
  const [selectedGarageId, setSelectedGarageId] = useState('')
  const [garageInvites, setGarageInvites] = useState<GarageInvite[]>([])
  const [userGarageInvites, setUserGarageInvites] = useState<GarageInvite[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [entries, setEntries] = useState<FuelEntry[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [entryDraft, setEntryDraft] = useState(createEntryDraft(''))
  const [garageNameDraft, setGarageNameDraft] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [newGarageName, setNewGarageName] = useState('')
  const [vehiclePendingArchive, setVehiclePendingArchive] = useState<Vehicle | null>(
    null,
  )
  const [vehicleDraft, setVehicleDraft] = useState(newVehicleDraft)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [isConvertingEstimate, setIsConvertingEstimate] = useState(false)
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [isCreatingGarage, setIsCreatingGarage] = useState(false)
  const [acceptingInviteId, setAcceptingInviteId] = useState('')
  const [isSendingInvite, setIsSendingInvite] = useState(false)
  const [isRenamingGarage, setIsRenamingGarage] = useState(false)
  const [isSavingEntry, setIsSavingEntry] = useState(false)
  const [savingPreferredVehicleId, setSavingPreferredVehicleId] = useState('')
  const [isSavingVehicle, setIsSavingVehicle] = useState(false)
  const [dataError, setDataError] = useState('')
  const userDisplayName = getUserDisplayName(session.user)
  const userInitials = getUserInitials(userDisplayName)
  const canAddVehicle =
    vehicleDraft.make.trim().length > 0 || vehicleDraft.model.trim().length > 0

  const selectedGarage = garageMemberships.find(
    (membership) => membership.garageId === selectedGarageId,
  )
  const isGarageOwner = selectedGarage?.role === 'owner'
  const activeVehicles = vehicles.filter((vehicle) => !vehicle.archived)
  const archivedVehicles = vehicles.filter((vehicle) => vehicle.archived)
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? activeVehicles[0]
  const selectedEntries = entries.filter(
    (entry) => entry.vehicleId === selectedVehicle?.id,
  )
  const displayEntries = useMemo(
    () => buildEstimatedMissedEntries(selectedEntries),
    [selectedEntries],
  )
  const entriesWithMetrics = useMemo(
    () => buildMetrics(displayEntries),
    [displayEntries],
  )
  const recentEntries = [...entriesWithMetrics].reverse()
  const chartEntries = entriesWithMetrics.filter((entry) => entry.mpg)
  const yearlyChartEntries = chartEntries.filter(
    (entry) => getEntryDate(entry) >= getOneYearAgo(),
  )
  const recentMpgEntries = chartEntries.slice(-3)
  const averageMpg =
    chartEntries.reduce((sum, entry) => sum + (entry.mpg ?? 0), 0) /
    (chartEntries.length || 1)
  const recentMpg =
    recentMpgEntries.reduce((sum, entry) => sum + (entry.mpg ?? 0), 0) /
    (recentMpgEntries.length || 1)
  const recentMpgChange =
    recentMpgEntries.length && chartEntries.length ? recentMpg - averageMpg : 0
  const entriesWithMiles = entriesWithMetrics.filter(
    (entry) => entry.milesDriven && entry.milesDriven > 0,
  )
  const averageMilesPerFillup =
    entriesWithMiles.reduce((sum, entry) => sum + (entry.milesDriven ?? 0), 0) /
    (entriesWithMiles.length || 1)
  const paidEntries = displayEntries.filter((entry) => entry.totalCost > 0)
  const averageCostPerFillup =
    paidEntries.reduce((sum, entry) => sum + entry.totalCost, 0) /
    (paidEntries.length || 1)
  const thirtyDaysAgo = getDaysAgo(30)
  const oneYearAgo = getOneYearAgo()
  const spendLast30Days = displayEntries
    .filter((entry) => getEntryDate(entry) >= thirtyDaysAgo)
    .reduce((sum, entry) => sum + entry.totalCost, 0)
  const spendLastYear = displayEntries
    .filter((entry) => getEntryDate(entry) >= oneYearAgo)
    .reduce((sum, entry) => sum + entry.totalCost, 0)
  const yearlyMpgValues = yearlyChartEntries.map((entry) => entry.mpg ?? 0)
  const minChartMpg = yearlyMpgValues.length
    ? Math.max(0, Math.floor(Math.min(...yearlyMpgValues) - 2))
    : 0
  const maxChartMpg = yearlyMpgValues.length
    ? Math.ceil(Math.max(...yearlyMpgValues) + 2)
    : 1
  const chartRange = Math.max(maxChartMpg - minChartMpg, 1)
  const chartLeft = chartMargin.left
  const chartRight = chartWidth - chartMargin.right
  const chartTop = chartMargin.top
  const chartBottom = chartHeight - chartMargin.bottom
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
  const chartTicks = Array.from({ length: 5 }, (_, index) => {
    const value = minChartMpg + (chartRange / 4) * index
    const y = chartBottom - ((value - minChartMpg) / chartRange) * (chartBottom - chartTop)

    return {
      value,
      y,
      label: Number.isInteger(value) ? String(value) : formatNumber(value),
    }
  }).reverse()

  const loadAppData = useCallback(
    async ({
      showLoading = true,
      garageId,
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

      const membershipsResult = await client
        .from('garage_members')
        .select('garage_id, user_id, role, preferred_vehicle_id, garages(id, name)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true })

      if (membershipsResult.error) {
        setDataError(getDataErrorMessage('Unable to load your garage.'))
        setGarageMemberships([])
        setGarageInvites([])
        setUserGarageInvites([])
        setVehicles([])
        setEntries([])
        setSelectedGarageId('')
        setSelectedVehicleId('')
        setEntryDraft(createEntryDraft(''))
        setIsDataLoading(false)
        return null
      }

      const nextGarageMemberships = (
        (membershipsResult.data ?? []) as GarageMembershipRow[]
      ).map(mapGarageMembershipRow)
      let nextUserInvites: GarageInvite[] = []

      if (session.user.email) {
        const userInvitesResult = await client
          .from('garage_invites')
          .select('id, garage_id, email, role, created_at')
          .eq('email', session.user.email.toLowerCase())
          .is('accepted_at', null)
          .is('revoked_at', null)
          .order('created_at', { ascending: false })

        if (userInvitesResult.error) {
          setUserGarageInvites([])
        } else {
          nextUserInvites = ((userInvitesResult.data ?? []) as GarageInviteRow[]).map(
            mapGarageInviteRow,
          )
          setUserGarageInvites(nextUserInvites)
        }
      } else {
        setUserGarageInvites([])
      }

      const nextGarage =
        nextGarageMemberships.find(
          (membership) => membership.garageId === (garageId || selectedGarageId),
        ) ?? nextGarageMemberships[0]

      setGarageMemberships(nextGarageMemberships)

      if (!nextGarage) {
        setDataError(
          nextUserInvites.length
            ? ''
            : 'No garage membership was found for this account.',
        )
        setGarageInvites([])
        setVehicles([])
        setEntries([])
        setSelectedGarageId('')
        setSelectedVehicleId('')
        setEntryDraft(createEntryDraft(''))
        setIsDataLoading(false)
        return {
          vehicles: [],
          entries: [],
          invites: [],
          userInvites: nextUserInvites,
        }
      }

      setSelectedGarageId(nextGarage.garageId)

      const [vehiclesResult, entriesResult] = await Promise.all([
        client
          .from('vehicles')
          .select('id, user_id, garage_id, name, make, model, year, archived')
          .eq('garage_id', nextGarage.garageId)
          .order('created_at', { ascending: true }),
        client
          .from('fuel_entries')
          .select(
            'id, user_id, garage_id, created_by, vehicle_id, filled_at, odometer, gallons, total_cost, is_full_tank, notes',
          )
          .eq('garage_id', nextGarage.garageId)
          .order('filled_at', { ascending: true })
          .order('odometer', { ascending: true }),
      ])

      if (vehiclesResult.error || entriesResult.error) {
        setDataError(getDataErrorMessage('Unable to load your vehicles and fill-ups.'))
        setGarageInvites([])
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
      let nextInvites: GarageInvite[] = []

      if (nextGarage.role === 'owner') {
        const invitesResult = await client
          .from('garage_invites')
          .select('id, garage_id, email, role, created_at')
          .eq('garage_id', nextGarage.garageId)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .order('created_at', { ascending: false })

        if (invitesResult.error) {
          setDataError(getDataErrorMessage('Unable to load pending garage invites.'))
          setGarageInvites([])
        } else {
          nextInvites = ((invitesResult.data ?? []) as GarageInviteRow[]).map(
            mapGarageInviteRow,
          )
          setGarageInvites(nextInvites)
        }
      } else {
        setGarageInvites([])
      }

      const firstActiveVehicle =
        nextVehicles.find((vehicle) => !vehicle.archived) ?? nextVehicles[0]
      const preferredVehicle = nextVehicles.find((vehicle) => {
        const nextPreferredVehicleId =
          preferredVehicleId || nextGarage.preferredVehicleId || ''

        return vehicle.id === nextPreferredVehicleId && !vehicle.archived
      })
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
        invites: nextInvites,
        userInvites: nextUserInvites,
      }
    },
    [selectedGarageId, session.user.email, session.user.id],
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

  useEffect(() => {
    setGarageNameDraft(selectedGarage?.garageName ?? '')
  }, [selectedGarage?.garageName])

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
    setIsConvertingEstimate(false)
  }

  function selectVehicle(vehicleId: string) {
    setSelectedVehicleId(vehicleId)
    setEntryDraft((draft) => ({ ...draft, vehicleId }))
  }

  async function selectGarage(garageId: string) {
    setSelectedGarageId(garageId)
    await loadAppData({
      showLoading: false,
      garageId,
    })
  }

  async function savePreferredVehicle(vehicleId: string) {
    if (!selectedGarage) {
      setDataError('Select a garage before setting a preferred vehicle.')
      return
    }

    setDataError('')
    setSavingPreferredVehicleId(vehicleId)

    if (!supabase) {
      setDataError(supabaseConfigError)
      setSavingPreferredVehicleId('')
      return
    }

    const { data, error } = await supabase
      .from('garage_members')
      .update({ preferred_vehicle_id: vehicleId })
      .eq('garage_id', selectedGarage.garageId)
      .eq('user_id', session.user.id)
      .select('preferred_vehicle_id')
      .single()

    if (error || data?.preferred_vehicle_id !== vehicleId) {
      setDataError(getDataErrorMessage('Unable to save your preferred vehicle.'))
      setSavingPreferredVehicleId('')
      return
    }

    setGarageMemberships((memberships) =>
      memberships.map((membership) =>
        membership.garageId === selectedGarage.garageId
          ? { ...membership, preferredVehicleId: vehicleId }
          : membership,
      ),
    )
    selectVehicle(vehicleId)
    await loadAppData({
      showLoading: false,
      preferredVehicleId: vehicleId,
      resetDraft: false,
    })
    setSavingPreferredVehicleId('')
  }

  async function createGarage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const garageName = newGarageName.trim()

    if (!garageName) {
      setDataError('Enter a garage name before creating it.')
      return
    }

    setDataError('')
    setIsCreatingGarage(true)

    if (!supabase) {
      setDataError(supabaseConfigError)
      setIsCreatingGarage(false)
      return
    }

    const garageId = crypto.randomUUID()

    const { error: garageError } = await supabase
      .from('garages')
      .insert({
        id: garageId,
        name: garageName,
        created_by: session.user.id,
      })

    if (garageError) {
      setDataError(getDataErrorMessage('Unable to create that garage.'))
      setIsCreatingGarage(false)
      return
    }

    const { error: membershipError } = await supabase.from('garage_members').insert({
      garage_id: garageId,
      user_id: session.user.id,
      role: 'owner',
    })

    if (membershipError) {
      setDataError(getDataErrorMessage('Garage created, but owner access could not be added.'))
      setIsCreatingGarage(false)
      return
    }

    setNewGarageName('')
    await loadAppData({
      showLoading: false,
      garageId,
    })
    setIsCreatingGarage(false)
  }

  async function renameGarage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const garageName = garageNameDraft.trim()

    if (!selectedGarage || !isGarageOwner) {
      setDataError('Only garage owners can rename garages.')
      return
    }

    if (!garageName) {
      setDataError('Garage name cannot be blank.')
      return
    }

    if (garageName === selectedGarage.garageName) {
      return
    }

    setDataError('')
    setIsRenamingGarage(true)

    if (!supabase) {
      setDataError(supabaseConfigError)
      setIsRenamingGarage(false)
      return
    }

    const { error } = await supabase
      .from('garages')
      .update({ name: garageName })
      .eq('id', selectedGarage.garageId)

    if (error) {
      setDataError(getDataErrorMessage('Unable to rename that garage.'))
      setIsRenamingGarage(false)
      return
    }

    setGarageMemberships((memberships) =>
      memberships.map((membership) =>
        membership.garageId === selectedGarage.garageId
          ? { ...membership, garageName }
          : membership,
      ),
    )
    await loadAppData({
      showLoading: false,
      garageId: selectedGarage.garageId,
      resetDraft: false,
    })
    setIsRenamingGarage(false)
  }

  async function sendGarageInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = inviteEmail.trim().toLowerCase()

    if (!selectedGarage || !isGarageOwner) {
      setDataError('Only garage owners can invite members.')
      return
    }

    if (!normalizedEmail) {
      setDataError('Enter an email address before sending an invite.')
      return
    }

    setDataError('')
    setIsSendingInvite(true)

    if (!supabase) {
      setDataError(supabaseConfigError)
      setIsSendingInvite(false)
      return
    }

    const { error } = await supabase.functions.invoke('invite-garage-member', {
      body: {
        garageId: selectedGarage.garageId,
        email: normalizedEmail,
        role: 'member',
        redirectTo: `${window.location.origin}/config`,
      },
    })

    if (error) {
      setDataError(getDataErrorMessage('Unable to send that invite.'))
      setIsSendingInvite(false)
      return
    }

    setInviteEmail('')
    await loadAppData({
      showLoading: false,
      garageId: selectedGarage.garageId,
      resetDraft: false,
    })
    setIsSendingInvite(false)
  }

  async function acceptGarageInvite(invite: GarageInvite) {
    setDataError('')
    setAcceptingInviteId(invite.id)

    if (!supabase) {
      setDataError(supabaseConfigError)
      setAcceptingInviteId('')
      return
    }

    const { data, error } = await supabase.rpc('accept_garage_invite', {
      target_invite_id: invite.id,
    })

    if (error) {
      setDataError(getDataErrorMessage('Unable to accept that garage invite.'))
      setAcceptingInviteId('')
      return
    }

    const joinedGarageId = typeof data === 'string' ? data : invite.garageId

    setUserGarageInvites((invites) =>
      invites.filter((pendingInvite) => pendingInvite.id !== invite.id),
    )
    await loadAppData({
      showLoading: false,
      garageId: joinedGarageId,
    })
    setAcceptingInviteId('')
  }

  function renderCreateGarageForm(buttonLabel = '+ Create') {
    return (
      <form className="compact-form inline-form" onSubmit={createGarage}>
        <label>
          Create garage
          <input
            disabled={isCreatingGarage}
            value={newGarageName}
            onChange={(event) => setNewGarageName(event.target.value)}
          />
        </label>
        <button
          className="secondary-button"
          disabled={isCreatingGarage || !newGarageName.trim()}
          type="submit"
        >
          {isCreatingGarage ? 'Creating...' : buttonLabel}
        </button>
      </form>
    )
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

    if (!selectedGarage) {
      setDataError('A garage is required before adding a vehicle.')
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
        garage_id: selectedGarage.garageId,
        name: vehicleDraft.name.trim(),
        make: vehicleDraft.make.trim() || null,
        model: vehicleDraft.model.trim() || null,
        year: vehicleDraft.year.trim() || null,
        archived: false,
      })
      .select('id, user_id, garage_id, name, make, model, year, archived')
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

    if (!isOnline) {
      setDataError('You are offline. Reconnect before saving a fuel entry.')
      return
    }

    if (!entryDraft.vehicleId) {
      setDataError('Add or select a vehicle before saving a fuel entry.')
      return
    }

    if (!selectedGarage) {
      setDataError('A garage is required before saving a fuel entry.')
      return
    }

    setDataError('')
    setIsSavingEntry(true)

    const gallons = Number(entryDraft.gallons)
    const totalCost = Number(entryDraft.totalCost)
    const entryPayload = {
      garage_id: selectedGarage.garageId,
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
          .eq('garage_id', selectedGarage.garageId)
      : supabase.from('fuel_entries').insert({
          ...entryPayload,
          user_id: session.user.id,
          created_by: session.user.id,
        })

    const { data, error } = await query
      .select(
        'id, user_id, garage_id, created_by, vehicle_id, filled_at, odometer, gallons, total_cost, is_full_tank, notes',
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
    setEditingEntryId(isAutoEstimatedEntry(entry) ? null : entry.id)
    setIsConvertingEstimate(isAutoEstimatedEntry(entry))
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
        .eq('garage_id', selectedGarageId)

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

  async function updateVehicleArchived(vehicle: Vehicle, archived: boolean) {
    if (!isGarageOwner) {
      setDataError('Only garage owners can manage vehicles.')
      return false
    }

    setDataError('')

    if (supabase) {
      const { error } = await supabase
        .from('vehicles')
        .update({ archived })
        .eq('id', vehicle.id)
        .eq('garage_id', selectedGarageId)

      if (error) {
        setDataError(
          getDataErrorMessage(
            archived ? 'Unable to archive that vehicle.' : 'Unable to restore that vehicle.',
          ),
        )
        return false
      }
    }

    const nextVehicle = archived
      ? activeVehicles.find((activeVehicle) => activeVehicle.id !== vehicle.id)
      : vehicle
    const refreshedData = await loadAppData({
      showLoading: false,
      preferredVehicleId: nextVehicle?.id,
      resetDraft: false,
    })
    const refreshedNextVehicle =
      refreshedData?.vehicles.find((vehicle) => vehicle.id === nextVehicle?.id) ??
      refreshedData?.vehicles.find((vehicle) => !vehicle.archived)

    setSelectedVehicleId(refreshedNextVehicle?.id ?? '')
    resetEntryDraft(refreshedNextVehicle?.id ?? '')
    return true
  }

  async function confirmArchiveVehicle() {
    if (!vehiclePendingArchive) {
      return
    }

    const wasArchived = await updateVehicleArchived(vehiclePendingArchive, true)

    if (wasArchived) {
      setVehiclePendingArchive(null)
    }
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
        {!isOnline && (
          <div className="offline-banner" role="status">
            You are offline. Viewing is available, but saving is disabled.
          </div>
        )}
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

            {isConvertingEstimate && (
              <div className="estimate-notice">
                This started as an estimated missed fill-up. Saving it will store the
                values as a real entry.
              </div>
            )}

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
                />
              </label>

              <button
                className="primary-button"
                disabled={!selectedVehicle || isSavingEntry || !isOnline}
                type="submit"
              >
                {isSavingEntry
                  ? 'Saving...'
                  : isConvertingEstimate
                    ? 'Save real entry'
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
                      {isAutoEstimatedEntry(entry) && (
                        <>
                          <span className="entry-badge">Estimated</span>
                          {' · '}
                        </>
                      )}
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
                    {!isAutoEstimatedEntry(entry) && (
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
                    )}
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
              <article className="stat-card">
                <span>Recent MPG</span>
                <strong>{recentMpgEntries.length ? formatNumber(recentMpg) : '--'}</strong>
                <small>
                  {recentMpgEntries.length && chartEntries.length
                    ? `${formatSignedNumber(recentMpgChange)} vs average`
                    : 'Last 3 intervals'}
                </small>
              </article>
              <article className="stat-card">
                <span>Average MPG</span>
                <strong>{chartEntries.length ? formatNumber(averageMpg) : '--'}</strong>
                <small>{chartEntries.length ? `${chartEntries.length} intervals` : 'No intervals'}</small>
              </article>
              <article className="stat-card">
                <span>Miles / fill-up</span>
                <strong>
                  {entriesWithMiles.length ? formatNumber(averageMilesPerFillup, 0) : '--'}
                </strong>
                <small>{entriesWithMiles.length ? 'Full-tank intervals' : 'No intervals'}</small>
              </article>
              <article className="stat-card">
                <span>Cost / fill-up</span>
                <strong>
                  {paidEntries.length ? formatCurrency(averageCostPerFillup) : '--'}
                </strong>
                <small>{paidEntries.length ? `${paidEntries.length} fill-ups` : 'No fill-ups'}</small>
              </article>
              <article className="stat-card wide">
                <span>Fuel spend</span>
                <div className="stat-split">
                  <div>
                    <strong>{spendLast30Days ? formatCurrency(spendLast30Days) : '--'}</strong>
                    <small>Last 30 days</small>
                  </div>
                  <div>
                    <strong>{spendLastYear ? formatCurrency(spendLastYear) : '--'}</strong>
                    <small>Last 12 months</small>
                  </div>
                </div>
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
                      <g className="chart-axis" aria-hidden="true">
                        {chartTicks.map((tick) => (
                          <g key={tick.label}>
                            <line
                              className="chart-grid-line"
                              x1={chartLeft}
                              x2={chartRight}
                              y1={tick.y}
                              y2={tick.y}
                            />
                            <text
                              className="chart-axis-label"
                              x={chartLeft - 10}
                              y={tick.y}
                              textAnchor="end"
                            >
                              {tick.label}
                            </text>
                          </g>
                        ))}
                        <line
                          className="chart-axis-line"
                          x1={chartLeft}
                          x2={chartLeft}
                          y1={chartTop}
                          y2={chartBottom}
                        />
                        <line
                          className="chart-axis-line"
                          x1={chartLeft}
                          x2={chartRight}
                          y1={chartBottom}
                          y2={chartBottom}
                        />
                        <text
                          className="chart-axis-title"
                          x={chartLeft - 36}
                          y={(chartTop + chartBottom) / 2}
                          textAnchor="middle"
                          transform={`rotate(-90 ${chartLeft - 36} ${
                            (chartTop + chartBottom) / 2
                          })`}
                        >
                          MPG
                        </text>
                      </g>
                      {areaPath && <path className="chart-area" d={areaPath} />}
                      {linePath && <path className="chart-line" d={linePath} />}
                      {linePoints.map((point) => (
                        <g key={point.key}>
                          <circle className="chart-point" cx={point.x} cy={point.y} r="3" />
                          <title>{point.label}</title>
                        </g>
                      ))}
                      <g className="chart-date-axis" aria-hidden="true">
                        <text x={chartLeft} y={chartHeight - 5} textAnchor="start">
                          {formatDate(yearlyChartEntries[0].filledAt)}
                        </text>
                        <text x={chartRight} y={chartHeight - 5} textAnchor="end">
                          {formatDate(
                            yearlyChartEntries[yearlyChartEntries.length - 1].filledAt,
                          )}
                        </text>
                      </g>
                    </svg>
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
                <p className="eyebrow">Garage</p>
                <h2>Manage access</h2>
              </div>
            </div>

            {userGarageInvites.length > 0 && (
              <div className="invite-list inbound-invites">
                <p className="eyebrow">Pending invitations</p>
                {userGarageInvites.map((invite) => (
                  <div className="invite-row" key={invite.id}>
                    <div>
                      <span>Garage invite</span>
                      <small>{invite.email}</small>
                    </div>
                    <button
                      className="secondary-button compact"
                      disabled={Boolean(acceptingInviteId)}
                      type="button"
                      onClick={() => void acceptGarageInvite(invite)}
                    >
                      {acceptingInviteId === invite.id ? 'Accepting...' : 'Accept'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedGarage ? (
              <div className="garage-controls">
                <label>
                  Current garage
                  <select
                    value={selectedGarageId}
                    onChange={(event) => void selectGarage(event.target.value)}
                  >
                    {garageMemberships.map((membership) => (
                      <option key={membership.garageId} value={membership.garageId}>
                        {membership.garageName}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="config-note">You are a {selectedGarage.role}.</p>

                {isGarageOwner && (
                  <>
                    <form className="compact-form inline-form" onSubmit={renameGarage}>
                      <label>
                        Rename garage
                        <input
                          disabled={isRenamingGarage}
                          value={garageNameDraft}
                          onChange={(event) => setGarageNameDraft(event.target.value)}
                        />
                      </label>
                      <button
                        className="secondary-button"
                        disabled={
                          isRenamingGarage ||
                          !garageNameDraft.trim() ||
                          garageNameDraft.trim() === selectedGarage.garageName
                        }
                        type="submit"
                      >
                        {isRenamingGarage ? 'Saving...' : 'Rename'}
                      </button>
                    </form>

                    {renderCreateGarageForm()}

                    <form className="compact-form inline-form" onSubmit={sendGarageInvite}>
                      <label>
                        Invite member
                        <input
                          disabled={isSendingInvite}
                          inputMode="email"
                          type="email"
                          value={inviteEmail}
                          onChange={(event) => setInviteEmail(event.target.value)}
                        />
                      </label>
                      <button
                        className="secondary-button"
                        disabled={isSendingInvite || !inviteEmail.trim()}
                        type="submit"
                      >
                        {isSendingInvite ? 'Sending...' : 'Send invite'}
                      </button>
                    </form>

                    {garageInvites.length > 0 && (
                      <div className="invite-list">
                        <p className="eyebrow">Pending invites</p>
                        {garageInvites.map((invite) => (
                          <div className="invite-row" key={invite.id}>
                            <span>{invite.email}</span>
                            <small>{invite.role}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="garage-controls">
                <div className="route-empty-state compact">
                  <strong>No garage found</strong>
                  <p>Join an available garage or create one to start logging fuel.</p>
                </div>
                {renderCreateGarageForm('+ Create garage')}
              </div>
            )}
          </section>

          <section className="config-section">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Vehicles</p>
              <h2>{activeVehicles.length} active</h2>
            </div>
          </div>

          <div className="vehicle-list" aria-label="Vehicle selector">
            {activeVehicles.length === 0 ? (
              <div className="route-empty-state compact">
                <strong>No active vehicles</strong>
                <p>Add a vehicle with a make or model to start logging fuel.</p>
              </div>
            ) : (
              activeVehicles.map((vehicle) => (
              <article
                className={`vehicle-tile ${
                  vehicle.id === selectedVehicle?.id ? 'selected' : ''
                }`}
                key={vehicle.id}
              >
                <button
                  className="vehicle-select-button"
                  type="button"
                  onClick={() => selectVehicle(vehicle.id)}
                >
                  <span>{getVehicleDisplayName(vehicle)}</span>
                  <small>{getVehicleFallbackName(vehicle)}</small>
                </button>
                <button
                  className={`preferred-chip ${
                    vehicle.id === selectedGarage?.preferredVehicleId
                      ? 'selected'
                      : ''
                  }`}
                  aria-label={`Set ${getVehicleDisplayName(vehicle)} as preferred vehicle`}
                  aria-pressed={vehicle.id === selectedGarage?.preferredVehicleId}
                  disabled={
                    Boolean(savingPreferredVehicleId) ||
                    vehicle.id === selectedGarage?.preferredVehicleId
                  }
                  title={
                    vehicle.id === selectedGarage?.preferredVehicleId
                      ? 'Preferred vehicle'
                      : 'Make preferred vehicle'
                  }
                  type="button"
                  onClick={() => void savePreferredVehicle(vehicle.id)}
                >
                  {savingPreferredVehicleId === vehicle.id
                    ? 'Saving...'
                    : vehicle.id === selectedGarage?.preferredVehicleId
                      ? 'Preferred'
                      : 'Make preferred'}
                </button>
                {isGarageOwner && activeVehicles.length > 1 && (
                  <button
                    aria-label={`Archive ${getVehicleDisplayName(vehicle)}`}
                    className="icon-button vehicle-row-action"
                    title="Archive vehicle"
                    type="button"
                    onClick={() => setVehiclePendingArchive(vehicle)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M4 7h16" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M6 7l1 13h10l1-13" />
                      <path d="M9 7V4h6v3" />
                    </svg>
                  </button>
                )}
              </article>
              ))
            )}
          </div>

          {archivedVehicles.length > 0 && (
            <div className="archived-vehicles">
              <p className="eyebrow">Archived</p>
              <div className="vehicle-list compact-list" aria-label="Archived vehicles">
                {archivedVehicles.map((vehicle) => (
                  <article className="vehicle-tile archived" key={vehicle.id}>
                    <div className="vehicle-select-button">
                      <span>{getVehicleDisplayName(vehicle)}</span>
                      <small>{getVehicleFallbackName(vehicle)}</small>
                    </div>
                    {isGarageOwner && (
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => void updateVehicleArchived(vehicle, false)}
                      >
                        Restore
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}

          {isGarageOwner ? (
          <form className="compact-form" onSubmit={submitVehicle}>
            <label>
              Name
              <input
                value={vehicleDraft.name}
                onChange={(event) => updateVehicleDraft('name', event.target.value)}
              />
            </label>
            <div className="field-row">
              <label>
                Make
                <input
                  value={vehicleDraft.make}
                  onChange={(event) => updateVehicleDraft('make', event.target.value)}
                />
              </label>
              <label>
                Model
                <input
                  value={vehicleDraft.model}
                  onChange={(event) => updateVehicleDraft('model', event.target.value)}
                />
              </label>
            </div>
            <label>
              Year
              <input
                value={vehicleDraft.year}
                onChange={(event) => updateVehicleDraft('year', event.target.value)}
                inputMode="numeric"
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
          ) : (
            <p className="config-note">
              Garage owners manage vehicles. You can still log fill-ups for active
              vehicles.
            </p>
          )}
          </section>
        </section>
        )}
          </>
        )}
      </section>

      {vehiclePendingArchive && (
        <div
          aria-labelledby="archive-vehicle-title"
          aria-modal="true"
          className="modal-backdrop"
          role="dialog"
        >
          <div className="confirm-modal">
            <div>
              <h2 id="archive-vehicle-title">
                Archive {getVehicleDisplayName(vehiclePendingArchive)}?
              </h2>
            </div>
            <p>
              This vehicle will be archived and hidden from active vehicle lists. It
              will not be truly deleted, and its fill-up history will remain available.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setVehiclePendingArchive(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void confirmArchiveVehicle()}
              >
                Archive vehicle
              </button>
            </div>
          </div>
        </div>
      )}

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
