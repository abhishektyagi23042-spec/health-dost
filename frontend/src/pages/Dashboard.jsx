import { useState, useRef, useEffect } from 'react'
import html2canvas from 'html2canvas'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { doc, getDoc, writeBatch, arrayUnion, serverTimestamp } from 'firebase/firestore'
import { storage, db } from '../lib/firebase'
import { generateSessionId } from '../lib/idUtils'
import {
  getBmiStatus,
  statusBloodOxygen,
  statusBloodPressure,
  statusHeartRate,
  statusStressLevel,
  statusTemperature,
} from '../lib/vitals'
import { getDiagnosisFromVitals } from '../lib/gemini'
import { useLiveVitals } from '../lib/liveVitalsSocket'
import { formatAppointmentDateLabel, getNextUpcoming } from '../lib/appointments'
// [glucose] Glucose module imports
import GlucoseCard from '../components/GlucoseCard'
import { useGlucose } from '../lib/glucoseSocket'
import { getGlucoseStatus } from '../constants/glucose'
// [records] Import AddRecordsDialog component
import AddRecordsDialog from '../components/AddRecordsDialog'

/**
 * Health Dashboard – base layout from Figma.
 * Sidebar (right): expandable via menu_stack icon. Collapsed: icons only. Expanded: icons + labels (Space Grotesk 20px).
 */
const ICON_SIZE = 24;
const LOGO_WIDTH = 36;
const LOGO_HEIGHT = 50;
const ECG_Y_MIN = 0;
const ECG_Y_MAX = 1023;

function HealthCard({ icon, iconBg, title, value, unit, status, statusBg, statusText }) {
  return (
    <div className="h-[120px] bg-white rounded-xl shadow-md p-3 flex flex-col justify-between min-w-0 flex-1">
      <div className="flex items-center gap-2 shrink-0">
        <div className={`w-[34px] h-[34px] rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
          <img src={icon} alt="" className="w-[22px] h-[22px] object-contain" />
        </div>
        <span className="font-['Mulish'] text-[9px] leading-[13px] text-[#2d3035] font-bold flex-1 text-right">
          {title}
        </span>
      </div>
      <div className="flex items-baseline gap-1 shrink-0">
        <span className="font-['Mulish'] text-[#2d3035] font-bold text-base">{value}</span>
        <span className="font-['Mulish'] text-slate-500 text-xs">{unit}</span>
      </div>
      <div className={`w-fit shrink-0 flex items-center justify-center py-1 px-2 rounded-md ${statusBg} ${statusText}`}>
        <span className="font-['Mulish'] text-[9px] font-medium leading-tight">
          {status}
        </span>
      </div>
    </div>
  )
}

function EcgWaveform({ samples }) {
  const canvasRef = useRef(null)
  const samplesRef = useRef(samples)
  const drawRef = useRef(null)
  const frameRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const resizeAndDraw = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const dpr = window.devicePixelRatio || 1
      const nextWidth = Math.floor(rect.width * dpr)
      const nextHeight = Math.floor(rect.height * dpr)
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth
        canvas.height = nextHeight
      }
      drawRef.current?.()
    }

    const draw = () => {
      const width = canvas.width
      const height = canvas.height
      if (!width || !height) return

      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      const baseline = Math.floor(height * 0.5)
      ctx.strokeStyle = '#f2f4f7'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, baseline)
      ctx.lineTo(width, baseline)
      ctx.stroke()

      const liveSamples = samplesRef.current
      if (!Array.isArray(liveSamples) || liveSamples.length < 2) return

      const maxPoints = Math.max(2, Math.floor(width))
      const points = liveSamples.length > maxPoints
        ? liveSamples.slice(liveSamples.length - maxPoints)
        : liveSamples

      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = Math.max(1, Math.floor((window.devicePixelRatio || 1)))
      ctx.beginPath()

      let hasActiveSegment = false
      const denom = Math.max(1, points.length - 1)
      for (let i = 0; i < points.length; i++) {
        const raw = Number(points[i])
        const x = (i / denom) * (width - 1)

        if (!Number.isFinite(raw)) {
          hasActiveSegment = false
          continue
        }

        // If lead-off detection triggers, firmware emits `E:0`. Render that as the
        // baseline so the graph stays readable (instead of sparse dots/gaps).
        const isLeadOff = raw <= 0
        const clamped = isLeadOff
          ? ECG_Y_MIN
          : Math.max(ECG_Y_MIN, Math.min(ECG_Y_MAX, raw))
        const normalized = (clamped - ECG_Y_MIN) / (ECG_Y_MAX - ECG_Y_MIN)
        const ySignal = height - normalized * (height - 1)
        const y = isLeadOff ? baseline : ySignal

        if (!hasActiveSegment) {
          ctx.moveTo(x, y)
          hasActiveSegment = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    }

    drawRef.current = draw
    resizeAndDraw()

    const observer = new ResizeObserver(() => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(resizeAndDraw)
    })
    observer.observe(canvas)

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    samplesRef.current = samples
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      drawRef.current?.()
    })

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [samples])

  return <canvas ref={canvasRef} className="w-full h-full block" aria-label="Live ECG waveform" />
}

const navItems = [
  { id: 'menu', src: '/icons/menu_stack.png', alt: 'Menu', label: 'Close' },
  { id: 'home', src: '/icons/home.png', alt: 'Home', label: 'Home' },
  { id: 'appointments', src: '/icons/appointments.png', alt: 'Appointments', label: 'Appointment' },
  { id: 'cloud', src: '/icons/cloud.png', alt: 'Cloud', label: 'Cloud' },
  { id: 'machine', src: '/icons/machine.png', alt: 'Machines', label: 'Syringe' },
]

function mapLiveSnapshotToSavedVitals(snapshot, bmiValue) {
  const bloodPressureRaw = typeof snapshot?.bloodPressure === 'string' ? snapshot.bloodPressure : '0/0'
  const [bpSys, bpDia] = bloodPressureRaw.split('/').map((x) => parseInt(x, 10) || 0)
  const heartRate = Number(snapshot?.heartRate) || 0
  const bloodOxygen = Number(snapshot?.bloodOxygen) || 0
  const stressLevel = Number(snapshot?.stressLevel) || 0
  const temperature = Number(snapshot?.temperature) || 0
  const safeBmi = Number.isFinite(bmiValue) ? Number(bmiValue.toFixed(1)) : 0

  return {
    bloodOxygen: [bloodOxygen, statusBloodOxygen(bloodOxygen) || 'nil'],
    bloodPressure: [bloodPressureRaw, statusBloodPressure(bpSys, bpDia) || 'nil'],
    bmi: [safeBmi, getBmiStatus(safeBmi) || 'nil'],
    heartRate: [heartRate, statusHeartRate(heartRate) || 'nil'],
    stressLevel: [stressLevel, statusStressLevel(stressLevel) || 'nil'],
    temperature: [temperature, statusTemperature(temperature) || 'nil'],
  }
}

export default function Dashboard({
  onLogout,
  onHome,
  onAppointments,
  onCloud,
  patientId,
  nurseName,
  patientProfile,
  onShowMessage,
  dashboardContainerRef,
  isOfflineGuest = false,
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [lastVitals, setLastVitals] = useState(null)
  const {
    arduinoStatus,
    liveVitals,
    ecgSamples,
    requestReset,
    requestReconnect,
  } = useLiveVitals()
  // [glucose] Hook for glucometer reading, sync, and clear
  const {
    glucoseData,
    syncing: glucoseSyncing,
    errorMessage: glucoseError,
    syncGlucose,
    clearGlucose,
  } = useGlucose()

  useEffect(() => {
    if (glucoseError) {
      onShowMessage?.(glucoseError)
    }
  }, [glucoseError, onShowMessage])

  // [glucose] Formatted glucose entry and metadata
  const glucoseEntry = [
    glucoseData?.mgdl ?? null,
    glucoseData?.mgdl != null ? getGlucoseStatus(glucoseData.mgdl).status : 'not measured',
  ]
  const glucoseMeta = glucoseData
    ? {
        timestamp: glucoseData.timestamp ?? null,
        device: glucoseData.device ?? null,
        seq: glucoseData.seq ?? null,
      }
    : null
  const [diagnosisText, setDiagnosisText] = useState('')
  const [generateLoading, setGenerateLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  // [records] State for Add Records dialog modal
  const [showAddRecords, setShowAddRecords] = useState(false)

  // [records] Open Add Records dialog requiring valid patient
  function handleOpenAddRecords() {
    if (!patientId || !patientName) {
      onShowMessage?.('Patient not found')
      return
    }
    setShowAddRecords(true)
  }
  const [nextAppointment, setNextAppointment] = useState(null)
  const saveTimedOutRef = useRef(false)
  const height = patientProfile?.height_cm ?? 0
  const weight = patientProfile?.weight_kg ?? 0
  const patientName = patientProfile?.name ?? ''
  const patientGender = patientProfile?.gender ?? ''
  const bmi = height > 0 ? weight / ((height / 100) ** 2) : 0
  const bmiIndicatorPosition = Math.min(100, Math.max(0, ((bmi - 16) / (40 - 16)) * 100))
  // Underweight: BMI < 18.5 | Healthy: 18.5 <= BMI < 25 | Overweight: 25 <= BMI < 30 | Obese: 30 <= BMI
  const bmiStatus = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Healthy' : bmi < 30 ? 'Overweight' : 'Obese'

  const todayLabel = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
  })

  useEffect(() => {
    if (!patientId || isOfflineGuest) {
      setNextAppointment(null)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const next = await getNextUpcoming(patientId)
        if (!cancelled) setNextAppointment(next)
      } catch {
        if (!cancelled) setNextAppointment(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [patientId, isOfflineGuest])

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

  async function handleGenerate() {
    if (isOfflineGuest) return
    setGenerateLoading(true)
    try {
      const liveSnapshot = { ...liveVitals }
      // [glucose] Include glucose in vitals for Gemini diagnosis
      const vitals = {
        ...mapLiveSnapshotToSavedVitals(liveSnapshot, bmi),
        glucose: glucoseEntry,
        glucoseMeta,
      }
      setLastVitals(vitals)
      const diagnosis = await getDiagnosisFromVitals(vitals)
      setDiagnosisText(diagnosis || 'Unable to connect to Gemini API')
    } finally {
      setGenerateLoading(false)
    }
  }

  async function handleSaveSession() {
    if (!patientId || !patientName) {
      onShowMessage?.('Patient not found')
      return
    }
    const liveSnapshot = { ...liveVitals }
    const savedVitals = mapLiveSnapshotToSavedVitals(liveSnapshot, bmi)
    saveTimedOutRef.current = false
    setSaveLoading(true)
    const doSave = async () => {
      const sessionId = generateSessionId()
      const diagnosis = lastVitals ? diagnosisText : 'Not Generated'
      if (isOfflineGuest) {
        let screenshotBase64 = ''
        const el = dashboardContainerRef?.current
        if (el) {
          const canvas = await html2canvas(el, {
            useCORS: true,
            scale: 1,
            width: el.clientWidth,
            height: el.clientHeight,
          })
          screenshotBase64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1] || ''
        }
        const localPayload = {
          sessionId,
          sessionDate: new Date().toISOString(),
          patientId,
          patientName,
          nurseName: nurseName ?? 'Guest',
          gender: patientGender,
          height_cm: height ?? 0,
          weight_kg: weight ?? 0,
          bloodOxygen: savedVitals.bloodOxygen,
          bloodPressure: savedVitals.bloodPressure,
          bmi: savedVitals.bmi,
          heartRate: savedVitals.heartRate,
          stressLevel: savedVitals.stressLevel,
          temperature: savedVitals.temperature,
          diagnosisText: diagnosis,
          mode: 'offline',
          // [glucose] Include glucose reading and metadata in offline session
          glucose: glucoseEntry,
          glucoseMeta,
        }
        const offlineSaveRes = await fetch(`${import.meta.env.VITE_SOCKET_URL || 'http://localhost:5175'}/offline-saves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payload: localPayload,
            screenshotBase64,
          }),
        })
        if (!offlineSaveRes.ok) {
          throw new Error('Failed to save offline session')
        }
        return
      }

      const screenshotPath = `screenshots/${patientId}/${sessionId}.jpg`
      let blob
      const el = dashboardContainerRef?.current
      if (el) {
        const canvas = await html2canvas(el, {
          useCORS: true,
          scale: 1,
          width: el.clientWidth,
          height: el.clientHeight,
        })
        blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92)
        })
      } else {
        const res = await fetch('/session_test.jpg')
        if (!res.ok) throw new Error('Fixed image not found')
        blob = await res.blob()
      }
      const storageRef = ref(storage, screenshotPath)
      await uploadBytes(storageRef, blob)
      const screenshotUrl = await getDownloadURL(storageRef)
      const patientDocRef = doc(db, 'patients', patientId)
      const patientSnap = await getDoc(patientDocRef)
      const patientData = patientSnap.data() ?? {}
      const payload = {
        bloodOxygen: savedVitals.bloodOxygen,
        bloodPressure: savedVitals.bloodPressure,
        bmi: savedVitals.bmi,
        heartRate: savedVitals.heartRate,
        stressLevel: savedVitals.stressLevel,
        temperature: savedVitals.temperature,
        diagnosisText: diagnosis,
        screenshotPath,
        screenshotUrl,
        sessionId,
        sessionDate: serverTimestamp(),
        mode: 'online',
        nurseName: nurseName ?? '',
        height_cm: patientData.height_cm ?? 0,
        weight_kg: patientData.weight_kg ?? 0,
        // [glucose] Include glucose reading and metadata in cloud session
        glucose: glucoseEntry,
        glucoseMeta,
      }
      const sessionDocRef = doc(db, 'patients', patientId, 'sessions', sessionId)
      const batch = writeBatch(db)
      batch.set(sessionDocRef, payload)
      batch.update(patientDocRef, {
        sessionHistory: arrayUnion(sessionId),
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
    }
    const savePromise = doSave()
    savePromise.catch(() => {})
    savePromise.then(() => {
      if (saveTimedOutRef.current) onShowMessage?.('Session successfully recorded')
    })
    const timeoutPromise = new Promise((_, rej) =>
      setTimeout(() => rej({ isTimeout: true }), 10000)
    )
    try {
      await Promise.race([savePromise, timeoutPromise])
      if (!saveTimedOutRef.current) {
        setSaveLoading(false)
        onShowMessage?.('Session successfully recorded')
      }
    } catch (err) {
      if (err?.isTimeout) {
        saveTimedOutRef.current = true
        setSaveLoading(false)
        onShowMessage?.('Session timed out')
      } else {
        setSaveLoading(false)
        onShowMessage?.('Failed to record session')
      }
    }
  }

  async function handlePrintVitals() {
    if (!patientId || !patientName) {
      onShowMessage?.('Patient not found')
      return
    }

    const normalizeVital = (v) => (Array.isArray(v) ? v[0] : v)
    const liveSnapshot = { ...liveVitals }
    const savedVitals = mapLiveSnapshotToSavedVitals(liveSnapshot, bmi)
    const diagnosis = lastVitals ? diagnosisText : 'Not Generated'

    try {
      const serverUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5175'
      const res = await fetch(`${serverUrl}/print-vitals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nurseName: nurseName ?? '',
          patient: {
            id: patientId,
            name: patientName,
            gender: patientGender || '',
            height_cm: Number(height) || 0,
            weight_kg: Number(weight) || 0,
          },
          vitals: {
            bloodOxygen: normalizeVital(savedVitals.bloodOxygen),
            bloodPressure: normalizeVital(savedVitals.bloodPressure),
            bmi: normalizeVital(savedVitals.bmi),
            heartRate: normalizeVital(savedVitals.heartRate),
            stressLevel: normalizeVital(savedVitals.stressLevel),
            temperature: normalizeVital(savedVitals.temperature),
            // [glucose] Pass glucose reading and metadata to print receipt
            glucose: glucoseEntry,
            glucoseMeta,
            diagnosisText: diagnosis,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Print failed')
      onShowMessage?.('Printed')
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to print')
    }
  }

  const v = liveVitals
  const bpVal = v?.bloodPressure ?? '0/0'
  const [bpSys, bpDia] = String(bpVal).split('/').map((x) => parseInt(x, 10) || 0)
  const bp = {
    value: bpVal,
    status: statusBloodPressure(bpSys, bpDia) || '',
  }
  const tempVal = v?.temperature ?? 0
  const temp = {
    value: typeof tempVal === 'number' && tempVal > 0 ? String(tempVal.toFixed(1)) : String(tempVal),
    status: statusTemperature(tempVal) || '',
  }
  const boVal = v?.bloodOxygen ?? 0
  const bo = { value: String(boVal), status: statusBloodOxygen(boVal) || '' }
  const stressVal = v?.stressLevel ?? 0
  const stress = { value: String(stressVal), status: statusStressLevel(stressVal) || '' }
  const hrVal = v?.heartRate ?? 0
  const hr = { value: String(hrVal), status: statusHeartRate(hrVal) || '' }

  return (
    <div className="relative flex h-full w-full min-h-0 bg-[#314490]">
      {/* Main content area – always excludes 72px right gutter (sidebar slot) for layout continuity */}
      <main className="flex-1 min-w-0 flex flex-col p-2.5 overflow-auto">
        <div className="flex-1 min-h-0 bg-[#DCF7DE] rounded-3xl p-3.5 flex gap-3">
          {/* Left: header + health metric cards */}
          <div className="flex-1 flex flex-col min-w-0 gap-2 min-h-0">
            <div className="shrink-0 flex justify-between items-center">
              <h2 className="font-['Space_Grotesk'] text-[36px] leading-[42px] text-[#2d3035] font-semibold">
                Health Overview
              </h2>
              <span className="font-['Space_Grotesk'] text-slate-500 text-sm">
                {todayLabel}
              </span>
            </div>
            {/* Arduino connection status – between header and cards */}
            <div className="shrink-0 flex items-center gap-3 py-2 px-3 bg-white/60 rounded-lg">
              <span className="flex items-center gap-2 font-['Mulish'] text-sm text-[#2d3035]">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${arduinoStatus?.connected ? 'bg-green-500' : 'bg-red-500'}`}
                  aria-hidden="true"
                ></span>
                Arduino: {arduinoStatus?.connected ? 'Connected' : 'Disconnected'}
                {arduinoStatus?.port && (
                  <span className="text-slate-500 text-xs">({arduinoStatus.port})</span>
                )}
              </span>
              <button
                type="button"
                onClick={requestReset}
                disabled={!arduinoStatus?.connected}
                className="font-['Space_Grotesk'] text-xs text-[#2d3035] bg-[#ebddfa] hover:bg-[#E0C8FF] px-2 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset Arduino
              </button>
              <button
                type="button"
                onClick={requestReconnect}
                className="font-['Space_Grotesk'] text-xs text-[#2d3035] bg-[#ebddfa] hover:bg-[#E0C8FF] px-2 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset Connection
              </button>
            </div>
            {/* Health metric cards + Live Heart Rate + Upcoming Appointment */}
            <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-auto">
            <div className="flex gap-2 min-h-0 shrink-0">
              <HealthCard
                icon="/icons/blood_pressure.png"
                iconBg="bg-[#FFFBEB]"
                title="Blood Pressure"
                value={bp.value}
                unit="mmHg"
                status={bp.status}
                statusBg="bg-[#FFFBEB]"
                statusText="text-orange-600"
              />
              {/* [glucose] Additive GlucoseCard placed between Blood Pressure and Temperature */}
              <GlucoseCard
                glucoseData={glucoseData}
                syncing={glucoseSyncing}
                onSync={syncGlucose}
              />
              <HealthCard
                icon="/icons/temperature.png"
                iconBg="bg-[#F5F3FF]"
                title="Temperature"
                value={temp.value}
                unit="°F"
                status={temp.status}
                statusBg="bg-[#F5F3FF]"
                statusText="text-purple-600"
              />
              <HealthCard
                icon="/icons/blood_oxygen.png"
                iconBg="bg-[#E0E7EB]"
                title="Blood Oxygen"
                value={bo.value}
                unit="%"
                status={bo.status}
                statusBg="bg-[#E0E7EB]"
                statusText="text-slate-600"
              />
              <HealthCard
                icon="/icons/stress_level.png"
                iconBg="bg-[#FEE2E2]"
                title="Stress Level"
                value={stress.value}
                unit="%"
                status={stress.status}
                statusBg="bg-[#ECFDF5]"
                statusText="text-green-700"
              />
            </div>
            {/* Live Heart Rate card – expands to fill gap above Upcoming Appointments */}
            <div className="w-full bg-white rounded-xl shadow-md p-2 flex flex-col gap-1.5 flex-1 min-h-0">
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-[28px] h-[28px] rounded-lg bg-[#FEE2E2] flex items-center justify-center shrink-0">
                  <img src="/icons/heart_rate.png" alt="" className="w-[18px] h-[18px] object-contain" />
                </div>
                <span className="font-['Mulish'] text-xs leading-tight text-[#2d3035] font-bold flex-1 text-right">
                  Live Heart Rate
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 shrink-0">
                <span className="font-['Mulish'] text-[#2d3035] font-bold text-sm">{hr.value} <span className="text-slate-500 font-normal text-xs">bpm</span></span>
                <div className="w-fit flex items-center justify-center py-0.5 px-1.5 rounded-md bg-[#FEE2E2] text-red-600">
                  <span className="font-['Mulish'] text-[8px] font-medium leading-tight">{hr.status}</span>
                </div>
              </div>
              <div className="flex-1 min-h-0 w-full rounded-lg overflow-hidden bg-white">
                <EcgWaveform samples={ecgSamples} />
              </div>
            </div>
            {/* Upcoming Appointment card */}
            <div className="w-full bg-white rounded-xl shadow-md p-3 flex flex-col gap-2 min-h-0 shrink-0">
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-[34px] h-[34px] rounded-lg bg-[#DBEAFE] flex items-center justify-center shrink-0">
                  <img src="/icons/camera.png" alt="" className="w-[22px] h-[22px] object-contain" />
                </div>
                <span className="font-['Mulish'] text-sm leading-[18px] text-[#2d3035] font-bold flex-1 text-right">
                  Upcoming Appointment
                </span>
              </div>
              {nextAppointment ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-['Mulish'] text-[10px] text-[#2d3035] bg-slate-100 px-1.5 py-0.5 rounded-md leading-tight">
                    {formatAppointmentDateLabel(String(nextAppointment.date || ''))}
                  </span>
                  <span className="font-['Mulish'] text-[10px] text-[#2d3035] leading-tight">
                    Consultation with Dr. {nextAppointment.doctorName || '—'}
                  </span>
                </div>
              ) : (
                <div className="flex items-center shrink-0">
                  <span className="font-['Mulish'] text-[10px] text-slate-500 leading-tight">—</span>
                </div>
              )}
            </div>
            </div>
          </div>
          {/* Right: two boxes with fixed dimensions */}
          <div className="w-[285px] flex flex-col gap-3 shrink-0">
            {/* Patient details */}
            <div className="w-full h-[180px] bg-[#43474F] rounded-2xl p-3.5 flex flex-col gap-2.5">
              <div className="flex justify-between items-start shrink-0">
                <span className="font-['Space_Grotesk'] text-[18px] text-white font-medium truncate">{patientName || '—'}</span>
                <span className="font-['Space_Grotesk'] text-[10px] text-white/80 bg-white/20 px-2 py-0.5 rounded-md">
                  {patientGender || '—'}
                </span>
              </div>
              <div className="flex gap-2 flex-1 min-h-0">
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <button
                    type="button"
                    className="flex-1 min-h-0 bg-[#B9EFBD] rounded-2xl px-2.5 py-1.5 flex items-center justify-between gap-1 hover:brightness-95 active:scale-[0.98] transition-all cursor-pointer border-0 text-left"
                  >
                    <span className="font-['Space_Grotesk'] text-[11px] text-[#2d3035] font-medium">Height</span>
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-end gap-0.5 h-2">
                        {[...Array(11)].map((_, i) => (
                          <div
                            key={i}
                            className={`w-0.5 rounded-full ${i === 5 ? 'h-2 bg-[#e07a7a]' : 'h-1.5 bg-[#2d3035]/40'}`}
                          />
                        ))}
                      </div>
                      <span className="font-['Space_Grotesk'] text-[11px] text-[#2d3035] font-medium">{height} cm</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="flex-1 min-h-0 bg-[#EDA9AC] rounded-2xl px-2.5 py-1.5 flex items-center justify-between gap-1 hover:brightness-95 active:scale-[0.98] transition-all cursor-pointer border-0 text-left"
                  >
                    <span className="font-['Space_Grotesk'] text-[11px] text-[#2d3035] font-medium">Weight</span>
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex items-end gap-0.5 h-2">
                        {[...Array(11)].map((_, i) => (
                          <div
                            key={i}
                            className={`w-0.5 rounded-full ${i === 5 ? 'h-2 bg-[#e07a7a]' : 'h-1.5 bg-[#2d3035]/40'}`}
                          />
                        ))}
                      </div>
                      <span className="font-['Space_Grotesk'] text-[11px] text-[#2d3035] font-medium">{weight}kg</span>
                    </div>
                  </button>
                </div>
                <div className="flex-1 min-w-0 bg-[#2D2D2D] rounded-2xl p-2 flex flex-col gap-1">
                  <span className="font-['Space_Grotesk'] text-[8.5px] text-[#B0B0B0]">Body Mass Index (BMI)</span>
                  <div className="flex justify-between items-center">
                    <span className="font-['Space_Grotesk'] text-[15px] text-white font-semibold">{bmi.toFixed(1)}</span>
                    <span className="font-['Space_Grotesk'] text-[8.5px] text-[#404040] bg-[#D0D0D0] px-1.5 py-0.5 rounded-md font-medium">
                      {bmiStatus}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 mt-auto">
                    <div className="relative h-1.5 w-full rounded-full overflow-hidden">
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: 'linear-gradient(to right, #ADD8E6, #7FFFD4, #FFD700, #FF7F7F)',
                        }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#FF0000] -translate-x-1/2"
                        style={{ left: `${bmiIndicatorPosition}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[8px] text-[#B0B0B0] font-['Space_Grotesk']">
                      <span>16</span>
                      <span>24</span>
                      <span>32</span>
                      <span>40</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* AI Diagnosis */}
            <div className="w-full flex-1 min-h-0 bg-[#3F215D] rounded-2xl p-3.5 flex flex-col gap-2.5">
              <div className="flex justify-between items-center text-left">
                <div>
                  <h3 className="font-['Space_Grotesk'] text-h3 text-[18px] text-white font-medium">AI Diagnosis</h3>
                  <p className="font-mulish text-p1 text-[10px] text-white/70 mt-0.5">Last checked August 10, 2021</p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isOfflineGuest || generateLoading || saveLoading}
                  className="font-['Space_Grotesk'] text-xs text-[#2d3035] bg-[#ebddfa] hover:bg-[#E0C8FF] px-2.5 py-1 rounded-lg shrink-0 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {generateLoading ? 'Generating…' : 'Generate'}
                </button>
              </div>
              <textarea
                value={diagnosisText}
                readOnly
                className="font-mulish text-p1 text-[11px] text-[#2d3035] bg-white flex-1 min-h-0 resize-none rounded-lg p-2.5 border-0 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
                placeholder="Click Generate for AI summary."
              />
              <p className="font-mulish text-[8.5px] text-white/60 shrink-0 leading-tight">
                This summary is for informational use only and does not replace professional medical advice.
              </p>
              <div className="flex justify-center w-full shrink-0 gap-2">
                <button
                  type="button"
                  onClick={handlePrintVitals}
                  disabled={generateLoading || saveLoading}
                  className="font-['Space_Grotesk'] text-xs text-[#2d3035] bg-white/90 hover:bg-white px-3 py-1.5 rounded-lg w-fit disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  Print
                </button>
                {/* [records] Add Records button */}
                <button
                  type="button"
                  onClick={handleOpenAddRecords}
                  disabled={generateLoading || saveLoading}
                  className="font-['Space_Grotesk'] text-xs text-[#2d3035] bg-white/90 hover:bg-white px-3 py-1.5 rounded-lg w-fit disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  Add Records
                </button>
                <button
                  type="button"
                  onClick={handleSaveSession}
                  disabled={generateLoading || saveLoading}
                  className="font-['Space_Grotesk'] text-xs text-[#2d3035] bg-[#ebddfa] hover:bg-[#E0C8FF] px-3 py-1.5 rounded-lg w-fit disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  {saveLoading ? (isOfflineGuest ? 'Saving…' : 'Saving…') : (isOfflineGuest ? 'Save to Local Device' : 'Save and Upload to Cloud')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Sidebar slot – 72px locked; sidebar always absolute, width animates */}
      <div className="w-[72px] shrink-0 relative">
        <aside
          className={`absolute right-0 top-0 bottom-0 flex flex-col justify-between py-5 bg-[#314490] border-l border-white/10 transition-[width] duration-200 ease-in-out ${
            isExpanded
              ? 'z-10 w-[220px] items-stretch px-5'
              : 'w-[72px] items-center'
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
          onClick={() => {
            // [glucose] Clear glucometer state on logout
            clearGlucose()
            onLogout?.()
          }}
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

      {/* [records] Render AddRecordsDialog modal */}
      {showAddRecords && (
        <AddRecordsDialog
          patientId={patientId}
          patientName={patientName}
          nurseName={nurseName}
          isOfflineGuest={isOfflineGuest}
          onClose={() => setShowAddRecords(false)}
          onShowMessage={onShowMessage}
        />
      )}
    </div>
  );
}
