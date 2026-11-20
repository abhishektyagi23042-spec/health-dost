import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import {
  createAppointment,
  deleteAppointment,
  formatAppointmentDateLabel,
  listAppointments,
} from '../lib/appointments'

const ICON_SIZE = 24
const LOGO_WIDTH = 36
const LOGO_HEIGHT = 50

const navItems = [
  { id: 'menu', src: '/icons/menu_stack.png', alt: 'Menu', label: 'Close' },
  { id: 'home', src: '/icons/home.png', alt: 'Home', label: 'Home' },
  { id: 'appointments', src: '/icons/appointments.png', alt: 'Appointments', label: 'Appointment' },
  { id: 'cloud', src: '/icons/cloud.png', alt: 'Cloud', label: 'Cloud' },
  { id: 'machine', src: '/icons/machine.png', alt: 'Machines', label: 'Syringe' },
]

function todayYmd() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function nowHm() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${min}`
}

export default function Appointments({
  onLogout,
  onHome,
  onCloud,
  onAppointments,
  patientId,
  patientProfile,
  onShowMessage,
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [appointments, setAppointments] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [videoCall, setVideoCall] = useState(null)
  const [newDoctorName, setNewDoctorName] = useState('')
  const [newDate, setNewDate] = useState(todayYmd)
  const [newTime, setNewTime] = useState(nowHm)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  const videoRef = useRef(null)
  const streamUrl = useMemo(() => import.meta.env.VITE_APPOINTMENTS_HLS_URL || '', [])

  const patientName = patientProfile?.name ?? 'Patient'
  const patientGender = patientProfile?.gender ?? '—'
  const heightCm = patientProfile?.height_cm ?? 0
  const weightKg = patientProfile?.weight_kg ?? 0
  const createdAt = patientProfile?.createdAt ?? null

  const todayLabel = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
  })

  const registeredDateLabel = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: '2-digit',
      })
    : '—'

  const loadAppointments = useCallback(async () => {
    if (!patientId) return
    setLoadingList(true)
    try {
      const rows = await listAppointments(patientId)
      setAppointments(rows)
    } catch {
      onShowMessage?.('Failed to load appointments')
    } finally {
      setLoadingList(false)
    }
  }, [patientId, onShowMessage])

  useEffect(() => {
    loadAppointments()
  }, [loadAppointments])

  const filteredAppointments = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return appointments
    return appointments.filter((a) =>
      String(a.doctorName || '').toLowerCase().includes(q)
    )
  }, [appointments, searchTerm])

  useEffect(() => {
    if (!videoCall) return undefined
    const videoEl = videoRef.current
    if (!videoEl) return undefined
    if (!streamUrl) {
      onShowMessage?.('Missing stream URL. Set VITE_APPOINTMENTS_HLS_URL.')
      return undefined
    }

    let hls = null
    let cancelled = false

    const onNativeError = () => {
      if (!cancelled) onShowMessage?.('Unable to load live stream.')
    }
    videoEl.addEventListener('error', onNativeError)

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = streamUrl
      videoEl.play().catch(() => {
        if (!cancelled) onShowMessage?.('Unable to autoplay live stream.')
      })
    } else if (Hls.isSupported()) {
      hls = new Hls({
        liveSyncDurationCount: 1,
        maxLiveSyncPlaybackRate: 1.3,
        enableWorker: true,
      })
      hls.loadSource(streamUrl)
      hls.attachMedia(videoEl)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {
          if (!cancelled) onShowMessage?.('Unable to autoplay live stream.')
        })
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal && !cancelled) onShowMessage?.('Unable to load live stream.')
      })
    } else if (!cancelled) {
      onShowMessage?.('This browser does not support HLS playback.')
    }

    return () => {
      cancelled = true
      videoEl.pause()
      videoEl.removeEventListener('error', onNativeError)
      if (hls) hls.destroy()
      videoEl.removeAttribute('src')
      videoEl.load()
    }
  }, [videoCall, streamUrl, onShowMessage])

  const handleNavClick = (id) => {
    if (id === 'menu') {
      setIsExpanded((prev) => !prev)
      return
    }
    if (id === 'home') {
      onHome?.()
      return
    }
    if (id === 'appointments') {
      onAppointments?.()
      return
    }
    if (id === 'cloud') {
      onCloud?.()
    }
  }

  function openCreateOverlay() {
    setNewDoctorName('')
    setNewDate(todayYmd())
    setNewTime(nowHm())
    setCreateOpen(true)
  }

  async function handleCreateSubmit(e) {
    e.preventDefault()
    const name = newDoctorName.trim()
    if (!name) {
      onShowMessage?.('Please enter doctor name.')
      return
    }
    if (!newDate || !newTime) {
      onShowMessage?.('Please select date and time.')
      return
    }
    if (!patientId) {
      onShowMessage?.('Patient not found')
      return
    }
    setCreateSubmitting(true)
    try {
      await createAppointment({
        patientId,
        doctorName: name,
        date: newDate,
        time: newTime,
      })
      onShowMessage?.('Appointment created')
      setCreateOpen(false)
      await loadAppointments()
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to create appointment')
    } finally {
      setCreateSubmitting(false)
    }
  }

  async function handleDelete(appointmentId) {
    if (!patientId || !appointmentId) return
    setDeletingId(appointmentId)
    try {
      await deleteAppointment({ patientId, appointmentId })
      onShowMessage?.('Appointment deleted')
      await loadAppointments()
    } catch {
      onShowMessage?.('Failed to delete appointment')
    } finally {
      setDeletingId('')
    }
  }

  return (
    <div className="relative flex h-full w-full min-h-0 bg-[#314490]">
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="create-appt-title"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 id="create-appt-title" className="font-['Space_Grotesk'] text-[18px] font-bold text-[#2d3035]">
                New Appointment
              </h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-mulish text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
            <form className="flex-1 overflow-y-auto px-4 py-4 space-y-4" onSubmit={handleCreateSubmit}>
              <div className="space-y-1">
                <label className="font-mulish text-[12px] font-semibold text-[#2d3035]">Doctor name</label>
                <input
                  type="text"
                  value={newDoctorName}
                  onChange={(e) => setNewDoctorName(e.target.value)}
                  placeholder="Dr. Smith"
                  className="w-full px-3 py-2 text-sm border-2 border-[#7e42ba] rounded-md text-[#2d3035] focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="font-mulish text-[12px] font-semibold text-[#2d3035]">Date</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md text-[#2d3035]"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="font-mulish text-[12px] font-semibold text-[#2d3035]">Time</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md text-[#2d3035]"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="flex-1 py-2.5 rounded-lg bg-[#ebddfa] text-[#2d3035] font-mulish text-sm font-medium hover:bg-[#E0C8FF] disabled:opacity-60"
                >
                  {createSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {videoCall && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="video-call-title"
        >
          <div className="bg-black rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-slate-700">
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 bg-black">
              <h2 id="video-call-title" className="font-['Space_Grotesk'] text-[16px] font-semibold text-white truncate">
                Video call — Dr. {videoCall.doctorName}
              </h2>
              <button
                type="button"
                onClick={() => setVideoCall(null)}
                className="shrink-0 rounded-lg border border-slate-500 px-3 py-1.5 text-[12px] font-mulish text-white hover:bg-white/10"
              >
                Exit
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-black relative flex items-center justify-center aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                autoPlay
                muted
                playsInline
                controls={false}
              />
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col p-5 overflow-auto">
        <div className="flex-1 min-h-0 bg-[#DCF7DE] rounded-3xl p-4 flex flex-col gap-3">
          <div className="shrink-0 flex justify-between items-center">
            <h2 className="font-['Space_Grotesk'] text-[36px] leading-[42px] text-[#2d3035] font-semibold">
              Appointments
            </h2>
            <span className="font-['Space_Grotesk'] text-slate-500 text-sm">{todayLabel}</span>
          </div>

          <div className="shrink-0">
            <div className="w-full rounded-2xl bg-[#43474F] px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2 text-white">
                <div className="flex items-center gap-3">
                  <span className="font-['Space_Grotesk'] text-[20px] font-medium">{patientName}</span>
                  <span className="font-['Space_Grotesk'] text-[10px] text-[#97aaf6] border border-[#97aaf6] px-2 py-0.5 rounded-md">
                    {patientGender}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#DCE3FC] px-3 py-1">
                    <span className="font-mulish font-bold text-[#2d3035]">Registered date</span>
                    <span className="font-mulish font-semibold text-[#2d3035]">{registeredDateLabel}</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#B9EFBD] px-3 py-1">
                    <span className="font-mulish font-bold text-[#2d3035]">Height</span>
                    <span className="font-mulish font-semibold text-[#2d3035]">
                      {heightCm ? `${heightCm} cm` : '—'}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#EDA9AC] px-3 py-1">
                    <span className="font-mulish font-bold text-[#2d3035]">Weight</span>
                    <span className="font-mulish font-semibold text-[#2d3035]">
                      {weightKg ? `${weightKg} kg` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end min-w-[240px]">
                <div className="relative w-full max-w-xs bg-white rounded-full border border-slate-200 px-3 py-1.5 flex items-center gap-2">
                  <div className="inline-flex items-center gap-1 rounded-full bg-[#FDE7D7] px-2 py-1 shrink-0">
                    <span className="font-mulish text-[11px] font-semibold text-[#2d3035]">Dr_</span>
                  </div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Doctor Name"
                    className="flex-1 bg-transparent border-none outline-none text-[11px] font-mulish text-[#2d3035] placeholder:text-slate-400"
                  />
                  <span className="shrink-0 text-[14px] text-slate-400">🔍</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <div className="w-full h-full bg-white rounded-2xl shadow-sm px-4 py-3 flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-[34px] h-[34px] rounded-lg bg-[#DBEAFE] flex items-center justify-center shrink-0">
                    <img src="/icons/appointments.png" alt="" className="w-5 h-5 object-contain" />
                  </div>
                  <span className="font-mulish text-[13px] font-semibold text-[#2d3035]">Appointments List</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className="font-mulish text-[11px] text-slate-500">
                    {filteredAppointments.length} appointment{filteredAppointments.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={loadAppointments}
                    disabled={loadingList}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-mulish text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {loadingList ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={openCreateOverlay}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#ebddfa] px-3 py-1 text-[11px] font-mulish font-semibold text-[#2d3035] hover:bg-[#E0C8FF]"
                  >
                    Create Appointment
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                {filteredAppointments.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[12px] text-slate-400 py-8">
                    No appointments scheduled yet.
                  </div>
                ) : (
                  filteredAppointments.map((row) => {
                    const id = row.appointmentId || row.id
                    const docName = row.doctorName || '—'
                    const dateStr = row.date || ''
                    const timeStr = row.time || ''
                    return (
                      <div
                        key={id}
                        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mulish text-[14px] text-[#2d3035] font-medium truncate">
                            {docName}
                          </div>
                          <div className="font-mulish text-[11px] text-slate-500 mt-0.5">
                            {formatAppointmentDateLabel(dateStr)} · {timeStr}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setVideoCall({ doctorName: docName })}
                            className="inline-flex items-center rounded-lg bg-[#ebddfa] px-3 py-1.5 text-[11px] font-mulish font-semibold text-[#2d3035] hover:bg-[#E0C8FF]"
                          >
                            Video Call
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(id)}
                            disabled={deletingId === id}
                            className="inline-flex items-center rounded-lg bg-[#FEE2E2] px-3 py-1.5 text-[11px] font-mulish font-semibold text-red-700 hover:bg-[#fecaca] disabled:opacity-60"
                          >
                            {deletingId === id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <div className="w-[72px] shrink-0 relative">
        <aside
          className={`absolute right-0 top-0 bottom-0 flex flex-col justify-between py-5 bg-[#314490] border-l border-white/10 transition-[width] duration-200 ease-in-out ${
            isExpanded ? 'z-10 w-[220px] items-stretch px-5' : 'w-[72px] items-center'
          }`}
          aria-label="Navigation"
          aria-expanded={isExpanded}
        >
          <div className={`flex shrink-0 ${isExpanded ? 'items-center' : 'items-center justify-center'}`}>
            {isExpanded ? (
              <img
                src="/icons/White.png"
                alt="HEALTH दोस्त"
                className="h-[50px] w-auto object-contain object-left"
              />
            ) : (
              <img
                src="/icons/logo_white_icon.png"
                alt="HealthDost"
                width={LOGO_WIDTH}
                height={LOGO_HEIGHT}
                className="w-9 h-[50px] object-contain"
              />
            )}
          </div>

          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className={`flex shrink-0 items-center rounded hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 ${
                isExpanded ? 'w-full justify-between py-1.5 px-2' : 'w-6 justify-center py-1.5 px-0'
              }`}
              aria-label={item.alt}
            >
              <img
                src={item.src}
                alt=""
                width={ICON_SIZE}
                height={ICON_SIZE}
                className="w-6 h-6 object-contain shrink-0"
              />
              {isExpanded && (
                <span className="font-['Space_Grotesk'] text-[20px] text-white truncate text-right">
                  {item.label}
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={onLogout}
            className={`flex shrink-0 items-center rounded hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 ${
              isExpanded ? 'w-full justify-between py-1.5 px-2' : 'w-6 justify-center py-1.5 px-0'
            }`}
            aria-label="Logout"
          >
            <img
              src="/icons/exit.png"
              alt=""
              width={ICON_SIZE}
              height={ICON_SIZE}
              className="w-6 h-6 object-contain shrink-0"
            />
            {isExpanded && (
              <span className="font-['Space_Grotesk'] text-[20px] text-white truncate text-right">
                Exit
              </span>
            )}
          </button>
        </aside>
      </div>
    </div>
  )
}
