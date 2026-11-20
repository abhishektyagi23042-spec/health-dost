import { useState, useEffect, useRef } from 'react'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { getBmiStatus } from '../lib/vitals'
import { listAppointments } from '../lib/appointments'

export default function DoctorPortal({ doctorInfo, onLogout, onOpenPatientHistory, onShowMessage }) {
  const [patients, setPatients] = useState([])
  const [loadingPatients, setLoadingPatients] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState(null)
  const [patientData, setPatientData] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Active sub-tab in details view: 'sessions' | 'records' | 'appointments'
  const [activeTab, setActiveTab] = useState('sessions')

  // Patient detail sub-data
  const [sessionsList, setSessionsList] = useState([])
  const [recordsList, setRecordsList] = useState([])
  const [appointmentsList, setAppointmentsList] = useState([])

  // Modal overlays
  const [vitalsOverlay, setVitalsOverlay] = useState(null)
  const [screenshotOverlay, setScreenshotOverlay] = useState(null)
  const [pdfOverlay, setPdfOverlay] = useState(null)

  const sessionCacheRef = useRef(new Map())

  // Load all registered patients on mount
  async function fetchPatients() {
    setLoadingPatients(true)
    try {
      const snap = await getDocs(collection(db, 'patients'))
      const list = []
      snap.forEach((d) => {
        const data = d.data()
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null
        list.push({
          id: d.id,
          name: data.name || d.id,
          gender: data.gender || '—',
          height_cm: Number(data.height_cm) || 0,
          weight_kg: Number(data.weight_kg) || 0,
          createdAt,
          sessionHistory: Array.isArray(data.sessionHistory) ? data.sessionHistory : [],
        })
      })
      list.sort((a, b) => a.name.localeCompare(b.name))
      setPatients(list)
      if (list.length > 0 && !selectedPatientId) {
        setSelectedPatientId(list[0].id)
      }
    } catch {
      onShowMessage?.('Failed to load patients list')
    } finally {
      setLoadingPatients(false)
    }
  }

  useEffect(() => {
    fetchPatients()
  }, [])

  // Load patient details whenever selectedPatientId changes
  useEffect(() => {
    if (!selectedPatientId) {
      setPatientData(null)
      setSessionsList([])
      setRecordsList([])
      setAppointmentsList([])
      return
    }

    let isMounted = true
    setLoadingDetails(true)

    async function loadPatientDetails() {
      try {
        // 1. Fetch patient doc
        const patientRef = doc(db, 'patients', selectedPatientId)
        const patientSnap = await getDoc(patientRef)
        if (!patientSnap.exists()) return

        const pData = patientSnap.data()
        const createdAt = pData.createdAt?.toDate ? pData.createdAt.toDate() : null
        const sessionHistory = Array.isArray(pData.sessionHistory) ? pData.sessionHistory : []

        if (!isMounted) return
        setPatientData({
          id: selectedPatientId,
          name: pData.name || selectedPatientId,
          gender: pData.gender || '—',
          height_cm: Number(pData.height_cm) || 0,
          weight_kg: Number(pData.weight_kg) || 0,
          createdAt,
          sessionHistory,
        })

        // 2. Fetch Sessions data
        const sessionRows = []
        for (const sid of [...sessionHistory].reverse()) {
          try {
            if (sessionCacheRef.current.has(sid)) {
              sessionRows.push({ sessionId: sid, ...sessionCacheRef.current.get(sid) })
            } else {
              const sSnap = await getDoc(doc(db, 'patients', selectedPatientId, 'sessions', sid))
              if (sSnap.exists()) {
                const sData = sSnap.data()
                sessionCacheRef.current.set(sid, sData)
                sessionRows.push({ sessionId: sid, ...sData })
              }
            }
          } catch {}
        }
        if (!isMounted) return
        setSessionsList(sessionRows)

        // 3. Fetch Records subcollection
        try {
          const recSnap = await getDocs(collection(db, 'patients', selectedPatientId, 'records'))
          const recList = []
          recSnap.forEach((rd) => {
            recList.push({ id: rd.id, ...rd.data() })
          })
          recList.sort((a, b) => {
            const tA = a.uploadedAt?.toMillis ? a.uploadedAt.toMillis() : 0
            const tB = b.uploadedAt?.toMillis ? b.uploadedAt.toMillis() : 0
            return tB - tA
          })
          if (!isMounted) return
          setRecordsList(recList)
        } catch {
          if (!isMounted) return
          setRecordsList([])
        }

        // 4. Fetch Appointments subcollection
        try {
          const apptList = await listAppointments(selectedPatientId)
          if (!isMounted) return
          setAppointmentsList(apptList)
        } catch {
          if (!isMounted) return
          setAppointmentsList([])
        }
      } catch {
        onShowMessage?.('Could not load patient details')
      } finally {
        if (isMounted) setLoadingDetails(false)
      }
    }

    loadPatientDetails()

    return () => {
      isMounted = false
    }
  }, [selectedPatientId])

  // Filtered patients list for search
  const filteredPatients = patients.filter((p) => {
    const q = searchTerm.trim().toLowerCase()
    return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
  })

  // BMI calculation for selected patient
  const hMeters = (patientData?.height_cm || 0) / 100
  const rawBmi = hMeters > 0 ? (patientData?.weight_kg || 0) / (hMeters * hMeters) : 0
  const safeBmi = Number.isFinite(rawBmi) && rawBmi > 0 ? Number(rawBmi.toFixed(1)) : 0
  const bmiStatus = safeBmi > 0 ? getBmiStatus(safeBmi) : '—'

  // View screenshot overlay
  async function handleViewScreenshot(s) {
    let url = s.screenshotUrl
    if (!url && s.screenshotPath) {
      try {
        url = await getDownloadURL(ref(storage, s.screenshotPath))
      } catch {
        onShowMessage?.('Could not load screenshot')
        return
      }
    }
    if (!url) {
      onShowMessage?.('No screenshot available for this session')
      return
    }
    setScreenshotOverlay({ sessionId: s.sessionId, url })
  }

  // View medical record PDF overlay
  async function handleViewRecordPdf(record) {
    if (!record?.storagePath) return
    try {
      const url = await getDownloadURL(ref(storage, record.storagePath))
      setPdfOverlay({ ...record, url })
    } catch {
      onShowMessage?.('Could not fetch document link')
    }
  }

  return (
    <div className="relative flex flex-col h-full w-full min-h-0 bg-[#314490] text-[#2d3035]">
      {/* Top Header */}
      <header className="shrink-0 bg-white/95 px-5 py-2.5 flex items-center justify-between border-b border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#ebddfa] flex items-center justify-center font-bold text-sm text-[#7e42ba]">
            👨‍⚕️
          </div>
          <div>
            <h1 className="font-['Space_Grotesk'] text-[16px] font-bold text-[#2d3035] leading-tight">
              HealthDost Doctor Portal
            </h1>
            <p className="font-mulish text-[11px] text-slate-500">
              Logged in as: <span className="font-semibold text-[#7e42ba]">{doctorInfo?.name || 'Dr. Doctor'}</span> ({doctorInfo?.id || 'DOC001'})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchPatients}
            disabled={loadingPatients}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-['Space_Grotesk'] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingPatients ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-['Space_Grotesk'] font-medium transition-colors"
          >
            <span>Exit Portal</span>
          </button>
        </div>
      </header>

      {/* Main Workspace (Split View) */}
      <div className="flex-1 min-h-0 flex p-3 gap-3 overflow-hidden">
        {/* Left Column: Patient Directory (Width ~30%) */}
        <div className="w-[310px] shrink-0 bg-white rounded-2xl shadow-sm flex flex-col overflow-hidden border border-slate-200">
          <div className="p-3 border-b border-slate-100 bg-slate-50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-['Space_Grotesk'] text-xs font-bold text-[#2d3035]">
                Patients Directory ({patients.length})
              </span>
              <span className="text-[10px] text-slate-400">Search to select</span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search patient name or ID..."
                className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7e42ba]"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {loadingPatients ? (
              <div className="text-center py-8 text-xs text-slate-400">Loading patients...</div>
            ) : filteredPatients.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">No patients found.</div>
            ) : (
              filteredPatients.map((p) => {
                const isSelected = p.id === selectedPatientId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`w-full text-left p-2.5 transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#ebddfa]/50 border-l-4 border-[#7e42ba]'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-['Space_Grotesk'] text-xs font-bold text-[#2d3035] truncate">
                          {p.name}
                        </span>
                        <span className="text-[10px] font-['Space_Grotesk'] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                          {p.gender}
                        </span>
                      </div>
                      <div className="text-[11px] font-mulish text-slate-500 truncate mt-0.5">
                        ID: {p.id} • {p.sessionHistory.length} session{p.sessionHistory.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span className="text-slate-300 text-sm shrink-0">›</span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Patient Comprehensive File */}
        <div className="flex-1 min-w-0 bg-[#DCF7DE] rounded-2xl p-3 flex flex-col gap-2.5 overflow-hidden shadow-sm">
          {patientData ? (
            <>
              {/* Patient Banner */}
              <div className="shrink-0 rounded-xl bg-[#43474F] px-4 py-2.5 text-white flex items-center justify-between gap-3 shadow-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-['Space_Grotesk'] text-[18px] font-bold text-white truncate">
                      {patientData.name}
                    </span>
                    <span className="text-[10px] font-['Space_Grotesk'] text-[#97aaf6] border border-[#97aaf6] px-1.5 py-0.5 rounded">
                      {patientData.gender}
                    </span>
                    <span className="text-[11px] font-mulish text-slate-300">
                      (ID: {patientData.id})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] font-mulish mt-1">
                    <span className="bg-white/10 px-2 py-0.5 rounded-full text-slate-200">
                      Height: {patientData.height_cm ? `${patientData.height_cm} cm` : '—'}
                    </span>
                    <span className="bg-white/10 px-2 py-0.5 rounded-full text-slate-200">
                      Weight: {patientData.weight_kg ? `${patientData.weight_kg} kg` : '—'}
                    </span>
                    <span className="bg-white/10 px-2 py-0.5 rounded-full text-slate-200">
                      BMI: {safeBmi > 0 ? `${safeBmi} (${bmiStatus})` : '—'}
                    </span>
                    {patientData.createdAt && (
                      <span className="bg-white/10 px-2 py-0.5 rounded-full text-slate-200">
                        Registered: {new Date(patientData.createdAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenPatientHistory?.(patientData.id, patientData)}
                    className="px-3 py-1.5 bg-[#ebddfa] hover:bg-[#E0C8FF] text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors whitespace-nowrap shadow-sm"
                  >
                    Open in Cloud History
                  </button>
                </div>
              </div>

              {/* Patient Content Box with Tabs */}
              <div className="flex-1 min-h-0 bg-white rounded-xl shadow-sm flex flex-col overflow-hidden">
                {/* Tab Switcher */}
                <div className="shrink-0 flex border-b border-slate-100 bg-slate-50 px-3 pt-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('sessions')}
                    className={`font-['Space_Grotesk'] text-xs font-semibold pb-2 px-2.5 border-b-2 transition-colors ${
                      activeTab === 'sessions'
                        ? 'border-[#7e42ba] text-[#7e42ba]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Vitals & Sessions ({sessionsList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('records')}
                    className={`font-['Space_Grotesk'] text-xs font-semibold pb-2 px-2.5 border-b-2 transition-colors ${
                      activeTab === 'records'
                        ? 'border-[#7e42ba] text-[#7e42ba]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Medical Records & Reports ({recordsList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('appointments')}
                    className={`font-['Space_Grotesk'] text-xs font-semibold pb-2 px-2.5 border-b-2 transition-colors ${
                      activeTab === 'appointments'
                        ? 'border-[#7e42ba] text-[#7e42ba]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Appointments ({appointmentsList.length})
                  </button>
                </div>

                {/* Tab Content Area */}
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  {loadingDetails ? (
                    <div className="text-center py-10 text-xs text-slate-400">Loading patient details...</div>
                  ) : activeTab === 'sessions' ? (
                    /* SESSIONS TAB */
                    sessionsList.length === 0 ? (
                      <div className="text-center py-10 text-xs text-slate-400">
                        No recorded sessions found for this patient.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {sessionsList.map((s) => {
                          const bp = Array.isArray(s.bloodPressure) ? s.bloodPressure[0] : (s.bloodPressure || '—')
                          const hr = Array.isArray(s.heartRate) ? s.heartRate[0] : (s.heartRate || '—')
                          const bo = Array.isArray(s.bloodOxygen) ? s.bloodOxygen[0] : (s.bloodOxygen || '—')
                          const temp = Array.isArray(s.temperature) ? s.temperature[0] : (s.temperature || '—')
                          const gluc = Array.isArray(s.glucose) ? s.glucose[0] : (s.glucose || null)

                          return (
                            <div
                              key={s.sessionId}
                              className="bg-slate-50 border border-slate-200 rounded-xl p-3 hover:bg-slate-100/60 transition-colors"
                            >
                              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                                <div>
                                  <span className="font-['Space_Grotesk'] text-xs font-bold text-[#2d3035]">
                                    {s.sessionId}
                                  </span>
                                  <span className="text-[11px] font-mulish text-slate-500 ml-2">
                                    Nurse: {s.nurseName || '—'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleViewScreenshot(s)}
                                    className="px-2.5 py-1 text-[11px] font-['Space_Grotesk'] rounded bg-[#ebddfa] hover:bg-[#E0C8FF] text-[#2d3035] transition-colors"
                                  >
                                    View Screenshot
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setVitalsOverlay({ sessionId: s.sessionId, data: s })}
                                    className="px-2.5 py-1 text-[11px] font-['Space_Grotesk'] rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
                                  >
                                    Full Vitals
                                  </button>
                                </div>
                              </div>

                              {/* Vitals quick badges */}
                              <div className="grid grid-cols-5 gap-2 pt-2 text-[11px] font-mulish">
                                <div className="bg-white p-1.5 rounded border border-slate-200">
                                  <span className="text-slate-400 block text-[9px]">BP</span>
                                  <span className="font-bold text-[#2d3035]">{bp}</span>
                                </div>
                                <div className="bg-white p-1.5 rounded border border-slate-200">
                                  <span className="text-slate-400 block text-[9px]">Heart Rate</span>
                                  <span className="font-bold text-[#2d3035]">{hr} bpm</span>
                                </div>
                                <div className="bg-white p-1.5 rounded border border-slate-200">
                                  <span className="text-slate-400 block text-[9px]">SpO2</span>
                                  <span className="font-bold text-[#2d3035]">{bo}%</span>
                                </div>
                                <div className="bg-white p-1.5 rounded border border-slate-200">
                                  <span className="text-slate-400 block text-[9px]">Temp</span>
                                  <span className="font-bold text-[#2d3035]">{temp}°F</span>
                                </div>
                                <div className="bg-white p-1.5 rounded border border-slate-200">
                                  <span className="text-slate-400 block text-[9px]">Glucose</span>
                                  <span className="font-bold text-[#2d3035]">{gluc ? `${gluc} mg/dL` : '—'}</span>
                                </div>
                              </div>

                              {s.diagnosisText && s.diagnosisText !== 'Not Generated' && (
                                <p className="text-[11px] font-mulish text-slate-600 bg-white/70 p-1.5 rounded mt-2 border border-slate-100">
                                  <strong className="text-[#2d3035]">Diagnosis:</strong> {s.diagnosisText}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  ) : activeTab === 'records' ? (
                    /* RECORDS TAB */
                    recordsList.length === 0 ? (
                      <div className="text-center py-10 text-xs text-slate-400">
                        No medical records or reports uploaded for this patient.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {recordsList.map((rec) => (
                          <div
                            key={rec.id}
                            className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between hover:bg-slate-100/60 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-xl">📄</span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-['Space_Grotesk'] text-xs font-bold text-[#2d3035] truncate">
                                    {rec.title || 'Medical Record'}
                                  </span>
                                  <span className="text-[10px] font-['Space_Grotesk'] px-2 py-0.5 rounded bg-[#DCF7DE] text-[#1E6F5C]">
                                    {rec.category || 'Record'}
                                  </span>
                                </div>
                                <div className="text-[11px] font-mulish text-slate-500 mt-0.5 flex gap-2">
                                  {rec.documentDate && <span>Date: {rec.documentDate}</span>}
                                  {rec.hospital && <span>Hospital: {rec.hospital}</span>}
                                  <span>Pages: {rec.pages || 1}</span>
                                  {rec.sizeBytes && <span>{(rec.sizeBytes / 1024).toFixed(0)} KB</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleViewRecordPdf(rec)}
                                className="px-3 py-1.5 text-xs font-['Space_Grotesk'] rounded-lg bg-[#ebddfa] hover:bg-[#E0C8FF] text-[#2d3035] transition-colors"
                              >
                                View PDF
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const u = await getDownloadURL(ref(storage, rec.storagePath))
                                    window.open(u, '_blank')
                                  } catch {
                                    onShowMessage?.('Could not open file')
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-['Space_Grotesk'] rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
                              >
                                Download
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    /* APPOINTMENTS TAB */
                    appointmentsList.length === 0 ? (
                      <div className="text-center py-10 text-xs text-slate-400">
                        No scheduled appointments for this patient.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {appointmentsList.map((a) => (
                          <div
                            key={a.appointmentId}
                            className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between"
                          >
                            <div>
                              <div className="font-['Space_Grotesk'] text-xs font-bold text-[#2d3035]">
                                Consultation with Dr. {a.doctorName || '—'}
                              </div>
                              <div className="text-[11px] font-mulish text-slate-500 mt-0.5">
                                Scheduled: {a.date} at {a.time}
                              </div>
                            </div>
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[#DCE3FC] text-[#2d3035]">
                              Scheduled
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
              <span className="text-3xl mb-2">📋</span>
              Select a patient from the directory on the left to inspect their medical records and vitals history.
            </div>
          )}
        </div>
      </div>

      {/* Vitals Overlay */}
      {vitalsOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          aria-modal="true"
          role="dialog"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h2 className="font-['Space_Grotesk'] text-[16px] font-bold text-[#2d3035] truncate">
                {vitalsOverlay.sessionId}
              </h2>
              <button
                type="button"
                onClick={() => setVitalsOverlay(null)}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                Exit
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 font-mulish text-xs text-[#2d3035]">
              <p><span className="font-semibold">Nurse:</span> {vitalsOverlay.data.nurseName ?? '—'}</p>
              {[
                { key: 'bloodOxygen', label: 'Blood Oxygen', unit: '%' },
                { key: 'bloodPressure', label: 'Blood Pressure' },
                { key: 'glucose', label: 'Blood Glucose', unit: 'mg/dL' },
                { key: 'heartRate', label: 'Heart Rate', unit: 'bpm' },
                { key: 'stressLevel', label: 'Stress Level' },
                { key: 'temperature', label: 'Temperature', unit: '°F' },
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
                    {status !== '—' ? <span className="text-slate-500"> ({status})</span> : null}
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

      {/* Screenshot Overlay */}
      {screenshotOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          aria-modal="true"
          role="dialog"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h2 className="font-['Space_Grotesk'] text-[16px] font-bold text-[#2d3035] truncate">
                Session Screenshot: {screenshotOverlay.sessionId}
              </h2>
              <button
                type="button"
                onClick={() => setScreenshotOverlay(null)}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                Exit
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-3 bg-slate-100">
              <img
                src={screenshotOverlay.url}
                alt="Screenshot"
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* PDF Overlay */}
      {pdfOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          aria-modal="true"
          role="dialog"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <div className="min-w-0">
                <h2 className="font-['Space_Grotesk'] text-[16px] font-bold text-[#2d3035] truncate">
                  {pdfOverlay.title || 'Medical Record'}
                </h2>
                <span className="text-[10px] font-mulish text-slate-500">
                  {pdfOverlay.category} • {pdfOverlay.pages || 1} page(s)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.open(pdfOverlay.url, '_blank')}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Open in Tab
                </button>
                <button
                  type="button"
                  onClick={() => setPdfOverlay(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Exit
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-[480px] p-2 bg-slate-100">
              <iframe
                src={pdfOverlay.url}
                title="Medical Record PDF"
                className="w-full h-full border-0 rounded-lg bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
