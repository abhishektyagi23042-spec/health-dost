import { useState, useRef, useEffect } from 'react'
// [records] Added collection, getDocs, deleteDoc for medical records
import { doc, getDoc, collection, getDocs, deleteDoc } from 'firebase/firestore'
// [records] Added deleteObject for record storage deletion
import { ref, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { deleteSessionAndAssets } from '../lib/sessions'

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

export default function CloudHistory({
  onLogout,
  onHome,
  onAppointments,
  onCloud,
  patientId,
  patientProfile,
  onShowMessage,
  onRefreshSessions,
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const sessionCacheRef = useRef(new Map())
  const [vitalsOverlay, setVitalsOverlay] = useState(null)
  const [screenshotOverlay, setScreenshotOverlay] = useState(null)
  // [records] State for records view, overlay, and deletion
  const [viewMode, setViewMode] = useState('sessions')
  const [records, setRecords] = useState([])
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [pdfOverlay, setPdfOverlay] = useState(null)
  const [confirmDeleteRecord, setConfirmDeleteRecord] = useState(null)

  const patientName = patientProfile?.name ?? 'Patient'
  const patientGender = patientProfile?.gender ?? '—'
  const heightCm = patientProfile?.height_cm ?? 0
  const weightKg = patientProfile?.weight_kg ?? 0
  const createdAt = patientProfile?.createdAt ?? null
  const rawSessionHistory = patientProfile?.sessionHistory ?? []
  const sessionHistory = Array.isArray(rawSessionHistory) ? rawSessionHistory : []

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

  const newestFirst = [...sessionHistory].reverse()
  const filteredSessions = newestFirst.filter((id) =>
    id.toLowerCase().includes(searchTerm.toLowerCase())
  )
  // [records] Filter records by search term
  const filteredRecords = records.filter((r) => {
    const term = searchTerm.toLowerCase()
    return (
      (r.title && r.title.toLowerCase().includes(term)) ||
      (r.category && r.category.toLowerCase().includes(term)) ||
      (r.hospital && r.hospital.toLowerCase().includes(term)) ||
      (r.documentDate && r.documentDate.toLowerCase().includes(term))
    )
  })

  const handleDeleteSession = async (sessionId) => {
    if (!patientId || !sessionId) return
    try {
      await deleteSessionAndAssets({ patientId, sessionId })
      onShowMessage?.('Session deleted')
      onRefreshSessions?.()
    } catch {
      onShowMessage?.('Failed to delete session')
    }
  }

  async function getSessionData(sessionId) {
    if (!patientId || !sessionId) return null
    const cached = sessionCacheRef.current.get(sessionId)
    if (cached) return cached
    try {
      const snap = await getDoc(doc(db, 'patients', patientId, 'sessions', sessionId))
      if (!snap.exists()) return null
      const data = snap.data()
      sessionCacheRef.current.set(sessionId, data)
      return data
    } catch {
      return null
    }
  }

  async function handleViewVitals(sessionId) {
    const data = await getSessionData(sessionId)
    if (!data) {
      onShowMessage?.('Could not connect to server')
      return
    }
    setVitalsOverlay({ sessionId, data })
  }

  async function handleViewScreenshot(sessionId) {
    const data = await getSessionData(sessionId)
    if (!data) {
      onShowMessage?.('Could not connect to server')
      return
    }
    let url = data.screenshotUrl
    if (!url && data.screenshotPath) {
      try {
        url = await getDownloadURL(ref(storage, data.screenshotPath))
      } catch {
        onShowMessage?.('Could not connect to server')
        return
      }
    }
    if (!url) {
      onShowMessage?.('Could not connect to server')
      return
    }
    setScreenshotOverlay({ sessionId, url })
  }

  function closeVitalsOverlay() {
    setVitalsOverlay(null)
  }

  function closeScreenshotOverlay() {
    setScreenshotOverlay(null)
  }

  // [records] Load records from Firestore subcollection
  async function loadRecords() {
    if (!patientId) return
    setLoadingRecords(true)
    try {
      const snap = await getDocs(collection(db, 'patients', patientId, 'records'))
      const list = []
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() })
      })
      list.sort((a, b) => {
        const timeA = a.uploadedAt?.toMillis ? a.uploadedAt.toMillis() : 0
        const timeB = b.uploadedAt?.toMillis ? b.uploadedAt.toMillis() : 0
        return timeB - timeA
      })
      setRecords(list)
    } catch {
      onShowMessage?.('Failed to load medical records')
    } finally {
      setLoadingRecords(false)
    }
  }

  useEffect(() => {
    if (viewMode === 'records') {
      loadRecords()
    }
  }, [viewMode, patientId])

  // [records] View PDF via on-demand getDownloadURL in overlay
  async function handleViewPdf(record) {
    if (!record?.storagePath) return
    try {
      const url = await getDownloadURL(ref(storage, record.storagePath))
      setPdfOverlay({ ...record, url })
    } catch {
      onShowMessage?.('Could not fetch document link')
    }
  }

  // [records] Download PDF via on-demand getDownloadURL
  async function handleDownloadPdf(record) {
    if (!record?.storagePath) return
    try {
      const url = await getDownloadURL(ref(storage, record.storagePath))
      window.open(url, '_blank')
    } catch {
      onShowMessage?.('Could not open document')
    }
  }

  // [records] Delete record from Firebase Storage and Firestore
  async function executeDeleteRecord(record) {
    if (!patientId || !record?.id) return
    try {
      if (record.storagePath) {
        try {
          await deleteObject(ref(storage, record.storagePath))
        } catch {}
      }
      await deleteDoc(doc(db, 'patients', patientId, 'records', record.id))
      setRecords((prev) => prev.filter((r) => r.id !== record.id))
      setConfirmDeleteRecord(null)
      onShowMessage?.('Record deleted')
    } catch {
      onShowMessage?.('Failed to delete record')
    }
  }

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

  return (
    <div className="relative flex h-full w-full min-h-0 bg-[#314490]">
      {/* Vitals overlay – only when data is in hand */}
      {vitalsOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="vitals-overlay-title"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 id="vitals-overlay-title" className="font-['Space_Grotesk'] text-[18px] font-bold text-[#2d3035] truncate">
                {vitalsOverlay.sessionId}
              </h2>
              <button
                type="button"
                onClick={closeVitalsOverlay}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-mulish text-slate-600 hover:bg-slate-100"
              >
                Exit
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 font-mulish text-[13px] text-[#2d3035]">
              <p><span className="font-semibold">Nurse:</span> {vitalsOverlay.data.nurseName ?? '—'}</p>
              {[
                { key: 'bloodOxygen', label: 'Blood Oxygen' },
                { key: 'bloodPressure', label: 'Blood Pressure' },
                // [glucose] Blood Glucose entry (defaults to — for older sessions)
                { key: 'glucose', label: 'Blood Glucose', unit: 'mg/dL' },
                { key: 'heartRate', label: 'Heart Rate' },
                { key: 'stressLevel', label: 'Stress Level' },
                { key: 'temperature', label: 'Temperature' },
                { key: 'bmi', label: 'BMI' },
              ].map(({ key, label, unit }) => {
                const v = vitalsOverlay.data[key]
                const rawVal = Array.isArray(v) ? v[0] : (v ?? '—')
                const value = rawVal != null && rawVal !== '' ? rawVal : '—'
                const status = Array.isArray(v) && v[1] != null && v[1] !== 'not measured' ? v[1] : '—'
                const displayVal = value !== '—' && unit ? `${value} ${unit}` : String(value)
                return (
                  <p key={key}>
                    <span className="font-semibold">{label}:</span> {displayVal}
                    {status !== '—' ? (
                      <span className="text-slate-600"> ({status})</span>
                    ) : null}
                  </p>
                )
              })}
              <p className="pt-2 border-t border-slate-100">
                <span className="font-semibold">Diagnosis:</span> {vitalsOverlay.data.diagnosisText ?? '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Screenshot overlay – only when url is in hand */}
      {screenshotOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="screenshot-overlay-title"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 id="screenshot-overlay-title" className="font-['Space_Grotesk'] text-[18px] font-bold text-[#2d3035] truncate">
                {screenshotOverlay.sessionId}
              </h2>
              <button
                type="button"
                onClick={closeScreenshotOverlay}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-mulish text-slate-600 hover:bg-slate-100"
              >
                Exit
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 bg-slate-100">
              <img
                src={screenshotOverlay.url}
                alt={`Screenshot for ${screenshotOverlay.sessionId}`}
                className="max-w-full max-h-[70vh] w-auto h-auto object-contain rounded-lg"
                onError={() => {
                  onShowMessage?.('Could not connect to server')
                  closeScreenshotOverlay()
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* [records] PDF Preview Overlay */}
      {pdfOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="pdf-overlay-title"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <div className="min-w-0">
                <h2 id="pdf-overlay-title" className="font-['Space_Grotesk'] text-[18px] font-bold text-[#2d3035] truncate">
                  {pdfOverlay.title || 'Medical Record'}
                </h2>
                <span className="font-mulish text-xs text-slate-500">
                  {pdfOverlay.category} • {pdfOverlay.pages || 1} page(s)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.open(pdfOverlay.url, '_blank')}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-mulish text-slate-600 hover:bg-slate-100"
                >
                  Open in Tab
                </button>
                <button
                  type="button"
                  onClick={() => setPdfOverlay(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-mulish text-slate-600 hover:bg-slate-100"
                >
                  Exit
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-[500px] p-2 bg-slate-100">
              <iframe
                src={pdfOverlay.url}
                title={pdfOverlay.title || 'Medical Record PDF'}
                className="w-full h-full border-0 rounded-lg bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* [records] Delete Confirmation Dialog */}
      {confirmDeleteRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          aria-modal="true"
          role="dialog"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-['Space_Grotesk'] text-[18px] font-bold text-rose-700">
              Delete Medical Record
            </h3>
            <p className="font-mulish text-xs text-slate-600">
              Are you sure you want to permanently delete{' '}
              <strong className="text-[#2d3035]">{confirmDeleteRecord.title || 'this record'}</strong>?
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteRecord(null)}
                className="px-4 py-2 text-xs font-['Space_Grotesk'] rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeDeleteRecord(confirmDeleteRecord)}
                className="px-4 py-2 text-xs font-['Space_Grotesk'] rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium"
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <main className="flex-1 min-w-0 flex flex-col p-5 overflow-auto">
        <div className="flex-1 min-h-0 bg-[#DCF7DE] rounded-3xl p-4 flex flex-col gap-3">
          <div className="shrink-0 flex justify-between items-center">
            <h2 className="font-['Space_Grotesk'] text-[36px] leading-[42px] text-[#2d3035] font-semibold">
              Cloud History
            </h2>
            <span className="font-['Space_Grotesk'] text-slate-500 text-sm">
              {todayLabel}
            </span>
          </div>
          {/* Patient overview banner + search */}
          <div className="shrink-0">
            <div className="w-full rounded-2xl bg-[#43474F] px-4 py-3 flex items-center justify-between gap-4">
              {/* Left: patient info and chips */}
              <div className="flex flex-col gap-2 text-white">
                <div className="flex items-center gap-3">
                  <span className="font-['Space_Grotesk'] text-[20px] font-medium">
                    {patientName}
                  </span>
                  <span className="font-['Space_Grotesk'] text-[10px] text-[#97aaf6] border border-[#97aaf6] px-2 py-0.5 rounded-md">
                    {patientGender}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#DCE3FC] px-3 py-1">
                    <span className="font-mulish font-bold text-[#2d3035]">
                      Registered date
                    </span>
                    <span className="font-mulish font-semibold text-[#2d3035]">
                      {registeredDateLabel}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#B9EFBD] px-3 py-1">
                    <span className="font-mulish font-bold text-[#2d3035]">
                      Height
                    </span>
                    <span className="font-mulish font-semibold text-[#2d3035]">
                      {heightCm ? `${heightCm} cm` : '—'}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#EDA9AC] px-3 py-1">
                    <span className="font-mulish font-bold text-[#2d3035]">
                      Weight
                    </span>
                    <span className="font-mulish font-semibold text-[#2d3035]">
                      {weightKg ? `${weightKg} kg` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: search pill */}
              <div className="flex items-center justify-end min-w-[240px]">
                <div className="relative w-full max-w-xs bg-white rounded-full border border-slate-200 px-3 py-1.5 flex items-center gap-2">
                  <div className="inline-flex items-center gap-1 rounded-full bg-[#FDE7D7] px-2 py-1 shrink-0">
                    <span className="font-mulish text-[11px] font-semibold text-[#2d3035]">
                      {viewMode === 'sessions' ? 'session_' : 'search:'}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={viewMode === 'sessions' ? 'DDMMYY_HHmmss' : 'Search records...'}
                    className="flex-1 bg-transparent border-none outline-none text-[11px] font-mulish text-[#2d3035] placeholder:text-slate-400"
                  />
                  <span className="shrink-0 text-[14px] text-slate-400">
                    🔍
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Sessions list card */}
          <div className="flex-1 min-h-0">
            <div className="w-full h-full bg-white rounded-2xl shadow-sm px-4 py-3 flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('sessions')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors ${
                      viewMode === 'sessions'
                        ? 'bg-[#ebddfa] text-[#2d3035] font-bold shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <img
                      src="/icons/sessions_folder.png"
                      alt=""
                      className="w-4 h-4 object-contain"
                    />
                    <span>Sessions ({filteredSessions.length})</span>
                  </button>

                  {/* [records] Tab toggle button */}
                  <button
                    type="button"
                    onClick={() => setViewMode('records')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors ${
                      viewMode === 'records'
                        ? 'bg-[#ebddfa] text-[#2d3035] font-bold shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span>📄 Medical Records ({records.length})</span>
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mulish text-[11px] text-slate-500">
                    {viewMode === 'sessions'
                      ? `${filteredSessions.length} session${filteredSessions.length === 1 ? '' : 's'}`
                      : `${filteredRecords.length} record${filteredRecords.length === 1 ? '' : 's'}`}
                  </span>
                  <button
                    type="button"
                    onClick={viewMode === 'sessions' ? onRefreshSessions : loadRecords}
                    disabled={loadingRecords}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-mulish text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <span>{loadingRecords ? 'Refreshing…' : 'Refresh'}</span>
                  </button>
                </div>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                {viewMode === 'sessions' ? (
                  filteredSessions.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[12px] text-slate-400">
                      No sessions saved yet.
                    </div>
                  ) : (
                    filteredSessions.map((sessionId) => (
                      <div
                        key={sessionId}
                        className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src="/icons/session_item_icon.png"
                            alt="Session"
                            className="w-6 h-6 shrink-0 object-contain"
                          />
                          <span className="font-mulish text-[14px] text-[#2d3035] truncate">
                            {sessionId}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleViewScreenshot(sessionId)}
                            className="inline-flex items-center gap-2 rounded-lg bg-[#ebddfa] px-4 py-1.5 text-[12px] font-mulish text-[#2d3035] hover:bg-[#E0C8FF]"
                          >
                            <span>View Screenshot</span>
                            <img
                              src="/icons/attach_screenshot.png"
                              alt="View Screenshot"
                              className="w-5 h-5 object-contain"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleViewVitals(sessionId)}
                            className="inline-flex items-center gap-2 rounded-lg bg-[#ebddfa] px-4 py-1.5 text-[12px] font-mulish text-[#2d3035] hover:bg-[#E0C8FF]"
                          >
                            <span>View Vitals</span>
                            <img
                              src="/icons/vitals_download.png"
                              alt="View Vitals"
                              className="w-5 h-5 object-contain"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSession(sessionId)}
                            className="inline-flex items-center gap-2 rounded-lg bg-[#FEE2E2] px-4 py-1.5 text-[12px] font-mulish text-red-700 hover:bg-[#fecaca]"
                          >
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )
                ) : (
                  /* [records] Render Medical Records */
                  filteredRecords.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[12px] text-slate-400">
                      No medical records found.
                    </div>
                  ) : (
                    filteredRecords.map((record) => (
                      <div
                        key={record.id}
                        className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-sm shrink-0">
                            📄
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mulish text-[14px] font-semibold text-[#2d3035] truncate">
                                {record.title || 'Medical Record'}
                              </span>
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-['Space_Grotesk'] font-medium bg-[#DCF7DE] text-[#1E6F5C] shrink-0">
                                {record.category || 'Record'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] font-mulish text-slate-500 mt-0.5">
                              {record.documentDate && (
                                <span>Date: {record.documentDate}</span>
                              )}
                              {record.hospital && (
                                <span>Hospital: {record.hospital}</span>
                              )}
                              <span>Pages: {record.pages || 1}</span>
                              {record.sizeBytes && (
                                <span>Size: {(record.sizeBytes / 1024).toFixed(0)} KB</span>
                              )}
                              {record.source && (
                                <span className="capitalize">({record.source})</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleViewPdf(record)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#ebddfa] px-3.5 py-1.5 text-[12px] font-mulish text-[#2d3035] hover:bg-[#E0C8FF]"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(record)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-1.5 text-[12px] font-mulish text-slate-700 hover:bg-slate-200"
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteRecord(record)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#FEE2E2] px-3.5 py-1.5 text-[12px] font-mulish text-red-700 hover:bg-[#fecaca]"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Sidebar slot – 72px locked; sidebar always absolute, width animates */}
      <div className="w-[72px] shrink-0 relative">
        <aside
          className={`absolute right-0 top-0 bottom-0 flex flex-col justify-between py-5 bg-[#314490] border-l border-white/10 transition-[width] duration-200 ease-in-out ${
            isExpanded ? 'z-10 w-[220px] items-stretch px-5' : 'w-[72px] items-center'
          }`}
          aria-label="Navigation"
          aria-expanded={isExpanded}
        >
          {/* Logo: closed = icon only 36×50; expanded = White.png (same height for consistent positioning) */}
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

          {/* Nav icons – 24×24, with labels when expanded */}
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

          {/* Exit / Logout – 24×24 */}
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

