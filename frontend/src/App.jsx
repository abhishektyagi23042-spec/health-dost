import { useState, useRef, useEffect } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './lib/firebase'
import { normalizePatientId } from './lib/idUtils'
import Dashboard from './pages/Dashboard'
import CloudHistory from './pages/CloudHistory'
import OfflineSync from './pages/OfflineSync'
import Appointments from './pages/Appointments'
import DoctorPortal from './pages/DoctorPortal'
import VirtualKeyboard from './components/VirtualKeyboard'

function WelcomeScreen({ onNewPatient, onExistingPatient, onDoctorLogin, onOfflineGuest, onSyncOffline, onExitApp }) {
  return (
    <div className="flex-1 flex items-start justify-center px-12 pt-0">
      <div className="bg-white rounded-xl shadow-lg px-8 py-8 w-full max-w-xl">
        <h1 className="font-['Space_Grotesk'] text-[24px] leading-[30px] text-[#2d3035] font-bold mb-6">Welcome</h1>
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={onNewPatient}
            className="py-3 px-3 bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors text-center text-sm"
          >
            New Patient
          </button>
          <button
            onClick={onExistingPatient}
            className="py-3 px-3 bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors text-center text-sm"
          >
            Existing Patient
          </button>
          <button
            onClick={onDoctorLogin}
            className="py-3 px-3 bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors text-center text-sm"
          >
            Doctor Login
          </button>
          <button
            onClick={onOfflineGuest}
            className="py-3 px-3 bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors text-center text-sm"
          >
            Offline Guest
          </button>
          <button
            onClick={onSyncOffline}
            className="py-3 px-3 bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors text-center text-sm"
          >
            Sync Offline
          </button>
          <button
            onClick={onExitApp}
            className="py-3 px-3 bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors text-center text-sm"
          >
            Exit App
          </button>
        </div>
      </div>
    </div>
  )
}

function OfflineGuestScreen({ onBack, onStartGuest, onShowMessage }) {
  const [name, setName] = useState('')
  const [gender, setGender] = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const normalizedName = normalizePatientId(name)
    if (!normalizedName || normalizedName === 'patient_unknown') {
      onShowMessage?.('Please enter a valid patient name.')
      return
    }
    const genderTrimmed = gender.trim()
    if (!genderTrimmed || !/^[a-zA-Z\s]+$/.test(genderTrimmed)) {
      onShowMessage?.('Please enter valid gender.')
      return
    }
    const heightTrimmed = height.trim()
    const weightTrimmed = weight.trim()
    const heightNum = Number(heightTrimmed)
    const weightNum = Number(weightTrimmed)
    if (
      heightTrimmed === '' ||
      weightTrimmed === '' ||
      Number.isNaN(heightNum) ||
      Number.isNaN(weightNum) ||
      !Number.isFinite(heightNum) ||
      !Number.isFinite(weightNum)
    ) {
      onShowMessage?.('Please enter valid numbers for height and weight.')
      return
    }

    onStartGuest?.({
      patientId: `guest_${normalizedName}`,
      patientProfile: {
        name: name.trim(),
        gender: genderTrimmed,
        height_cm: heightNum,
        weight_kg: weightNum,
        createdAt: new Date(),
        sessionHistory: [],
      },
    })
  }

  return (
    <div className="flex-1 flex items-start justify-center px-12 pt-0 min-h-0">
      <div className="bg-white rounded-xl shadow-lg px-10 py-7 w-full max-w-xl shrink-0">
        <h1 className="font-['Space_Grotesk'] text-[24px] leading-[30px] text-[#2d3035] font-bold mb-6">Offline Guest Login</h1>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Name
              </label>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Allen Doe"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Gender
              </label>
            </div>
            <input
              type="text"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              placeholder="Male"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Weight (kg)
              </label>
            </div>
            <input
              type="text"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="75"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Height (cm)
              </label>
            </div>
            <input
              type="text"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="175"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex gap-6 pt-6">
            <button
              type="submit"
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors"
            >
              Start Offline
            </button>
            <button
              type="button"
              onClick={onBack}
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors"
            >
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RegisterScreen({ onBack, onRegisterSuccess, onShowMessage }) {
  const [name, setName] = useState('')
  const [gender, setGender] = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const patientId = normalizePatientId(name)
    if (!patientId || patientId === 'patient_unknown') {
      onShowMessage?.('Please enter a valid patient name.')
      return
    }
    const genderTrimmed = gender.trim()
    if (!genderTrimmed || !/^[a-zA-Z\s]+$/.test(genderTrimmed)) {
      onShowMessage?.('Please enter valid gender.')
      return
    }
    const heightTrimmed = height.trim()
    const weightTrimmed = weight.trim()
    const heightNum = Number(heightTrimmed)
    const weightNum = Number(weightTrimmed)
    if (
      heightTrimmed === '' ||
      weightTrimmed === '' ||
      Number.isNaN(heightNum) ||
      Number.isNaN(weightNum) ||
      !Number.isFinite(heightNum) ||
      !Number.isFinite(weightNum)
    ) {
      onShowMessage?.('Please enter valid numbers for height and weight.')
      return
    }
    setLoading(true)
    try {
      const patientRef = doc(db, 'patients', patientId)
      const snapshot = await getDoc(patientRef)
      if (snapshot.exists()) {
        onShowMessage?.('Patient already registered')
        return
      }
      await setDoc(patientRef, {
        name: name.trim(),
        gender: genderTrimmed,
        height_cm: heightNum,
        weight_kg: weightNum,
        createdAt: serverTimestamp(),
        // Cloud history support: initialize empty session history and updatedAt
        sessionHistory: [],
        updatedAt: serverTimestamp(),
      })
      onRegisterSuccess?.()
    } catch (err) {
      const msg = err?.message ?? ''
      onShowMessage?.(
        msg.includes('client is offline') ? 'Failed to connect to server' : msg || 'Registration failed'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex items-start justify-center px-12 pt-0 min-h-0">
      <div className="bg-white rounded-xl shadow-lg px-10 py-7 w-full max-w-xl shrink-0">
        <h1 className="font-['Space_Grotesk'] text-[24px] leading-[30px] text-[#2d3035] font-bold mb-6">Register New Patient</h1>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Name
              </label>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Allen Doe"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Gender
              </label>
            </div>
            <input
              type="text"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              placeholder="Male"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Weight (kg)
              </label>
            </div>
            <input
              type="text"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="75"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Height (cm)
              </label>
            </div>
            <input
              type="text"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="175"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>

          <div className="flex gap-6 pt-6">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Registering…' : 'Register'}
            </button>
            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function LoginScreen({ onBack, onLoginSuccess, onShowMessage }) {
  const [patientName, setPatientName] = useState('')
  const [nurseName, setNurseName] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const patientId = normalizePatientId(patientName)
    if (!patientId || patientId === 'patient_unknown') {
      onShowMessage?.('Please enter a valid patient name.')
      return
    }
    const nurseNameTrimmed = nurseName.trim()
    if (!nurseNameTrimmed || !/^[a-zA-Z\s]+$/.test(nurseNameTrimmed)) {
      onShowMessage?.('Please enter valid nurse name')
      return
    }
    setLoading(true)
    try {
      const patientRef = doc(db, 'patients', patientId)
      const snapshot = await getDoc(patientRef)
      if (!snapshot.exists()) {
        onShowMessage?.('Patient not found')
        return
      }
      onLoginSuccess?.(patientId, nurseNameTrimmed)
    } catch (err) {
      const msg = err?.message ?? ''
      onShowMessage?.(
        msg.includes('client is offline') ? 'Failed to connect to server' : msg || 'Login failed'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex items-start justify-center px-12 pt-0 min-h-0">
      <div className="bg-white rounded-xl shadow-lg px-10 py-7 w-full max-w-xl shrink-0">
        <h1 className="font-['Space_Grotesk'] text-[24px] leading-[30px] text-[#2d3035] font-bold mb-6">Enter Existing Patient</h1>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Patient Name
              </label>
            </div>
            <input
              type="text"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Allen Doe"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Nurse Name
              </label>
            </div>
            <input
              type="text"
              value={nurseName}
              onChange={(e) => setNurseName(e.target.value)}
              placeholder="Sally Page"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>

          <div className="flex gap-6 pt-6">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Checking…' : 'Start'}
            </button>
            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DoctorLoginScreen({ onBack, onLoginSuccess, onShowMessage }) {
  const [doctorId, setDoctorId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const cleanId = doctorId.trim()
    const cleanPass = password.trim()
    if (!cleanId) {
      onShowMessage?.('Please enter Doctor ID or Username.')
      return
    }
    if (!cleanPass) {
      onShowMessage?.('Please enter Password / PIN.')
      return
    }

    setLoading(true)
    try {
      const lowerId = cleanId.toLowerCase()
      // Fallback / Built-in credentials so doctor login works immediately
      if (
        (lowerId === 'doctor' && cleanPass === 'doctor123') ||
        (lowerId === 'admin' && cleanPass === 'admin123') ||
        (lowerId === 'dr_healthdost' && cleanPass === 'healthdost2026')
      ) {
        onLoginSuccess?.({
          id: cleanId,
          name: lowerId === 'doctor' ? 'Dr. Doctor' : cleanId,
          role: 'doctor',
        })
        return
      }

      // Check Firestore 'doctors' collection
      const docRef = doc(db, 'doctors', cleanId)
      const docSnap = await getDoc(docRef)
      if (docSnap.exists()) {
        const data = docSnap.data()
        const storedPass = String(data.password || data.pin || '')
        if (storedPass === cleanPass) {
          onLoginSuccess?.({
            id: cleanId,
            name: data.name || `Dr. ${cleanId}`,
            role: data.role || 'doctor',
            specialty: data.specialty || '',
          })
          return
        } else {
          onShowMessage?.('Incorrect password or PIN.')
          return
        }
      }

      onShowMessage?.('Invalid Doctor credentials. (Default: doctor / doctor123)')
    } catch (err) {
      const msg = err?.message ?? ''
      const lowerId = cleanId.toLowerCase()
      if (lowerId === 'doctor' && cleanPass === 'doctor123') {
        onLoginSuccess?.({ id: cleanId, name: 'Dr. Doctor', role: 'doctor' })
        return
      }
      onShowMessage?.(
        msg.includes('client is offline') ? 'Failed to connect to server' : msg || 'Login failed'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex items-start justify-center px-12 pt-0 min-h-0">
      <div className="bg-white rounded-xl shadow-lg px-10 py-7 w-full max-w-xl shrink-0">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-['Space_Grotesk'] text-[24px] leading-[30px] text-[#2d3035] font-bold">
            Doctor Login
          </h1>
          <span className="text-xs font-semibold px-2.5 py-1 bg-[#ebddfa] text-[#7e42ba] rounded-full">
            Healthcare Provider
          </span>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Doctor ID / User
              </label>
            </div>
            <input
              type="text"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              placeholder="e.g. doctor or dr_sharma"
              autoComplete="username"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <label className="inline-block px-2.5 py-1 bg-[#E0F2E0] text-[#1E6F5C] text-xs font-medium rounded-md w-fit">
                Password / PIN
              </label>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="flex-1 px-2.5 py-1.5 text-sm bg-white border-2 border-[#7e42ba] rounded-md text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7e42ba]"
            />
          </div>

          <p className="text-[11px] text-slate-500 pl-1">
            Default credentials: <span className="font-semibold text-slate-700">doctor</span> / <span className="font-semibold text-slate-700">doctor123</span>
          </p>

          <div className="flex gap-6 pt-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying…' : 'Enter Portal'}
            </button>
            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              className="flex-1 py-3.5 px-8 text-sm bg-[#ebddfa] text-[#2d3035] font-medium rounded-lg hover:bg-[#E0C8FF] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const TOAST_DURATION_MS = 2000
const TOAST_FADE_MS = 300

function App() {
  const [screen, setScreen] = useState('welcome')
  const [patientId, setPatientId] = useState(null)
  const [nurseName, setNurseName] = useState(null)
  const [patientProfile, setPatientProfile] = useState(null)
  const [isOfflineGuest, setIsOfflineGuest] = useState(false)
  const [doctorInfo, setDoctorInfo] = useState(null)
  const [toastMessage, setToastMessage] = useState(null)
  const [toastFading, setToastFading] = useState(false)
  const toastTimeoutRef = useRef(null)
  const toastFadeRef = useRef(null)

  async function handleLoginSuccess(pid, nName) {
    try {
      const snap = await getDoc(doc(db, 'patients', pid))
      if (!snap.exists()) return
      const d = snap.data()
      const createdAt =
        d.createdAt && typeof d.createdAt.toDate === 'function'
          ? d.createdAt.toDate()
          : null
      const sessionHistory = Array.isArray(d.sessionHistory) ? d.sessionHistory : []
      setPatientProfile({
        name: d.name ?? '',
        gender: d.gender ?? '',
        height_cm: d.height_cm ?? 0,
        weight_kg: d.weight_kg ?? 0,
        createdAt,
        sessionHistory,
      })
      setPatientId(pid)
      setNurseName(nName ?? '')
      setDoctorInfo(null)
      setScreen('dashboard')
    } catch {
      // rare (e.g. offline after login check); leave screen on login
    }
  }

  async function reloadPatientProfile() {
    if (!patientId) return
    try {
      const snap = await getDoc(doc(db, 'patients', patientId))
      if (!snap.exists()) return
      const d = snap.data()
      const createdAt =
        d.createdAt && typeof d.createdAt.toDate === 'function'
          ? d.createdAt.toDate()
          : null
      const sessionHistory = Array.isArray(d.sessionHistory) ? d.sessionHistory : []
      setPatientProfile((prev) => ({
        name: d.name ?? prev?.name ?? '',
        gender: d.gender ?? prev?.gender ?? '',
        height_cm: d.height_cm ?? prev?.height_cm ?? 0,
        weight_kg: d.weight_kg ?? prev?.weight_kg ?? 0,
        createdAt,
        sessionHistory,
      }))
      showToast('Sessions refreshed')
    } catch {
      showToast('Failed to refresh sessions')
    }
  }

  function handleLogout() {
    // [glucose] Reset server glucose cache on session end
    fetch('http://localhost:5175/api/glucose/clear', { method: 'POST' }).catch(() => {})
    setPatientId(null)
    setNurseName(null)
    setPatientProfile(null)
    setIsOfflineGuest(false)
    setDoctorInfo(null)
    setScreen('welcome')
  }

  function showToast(message) {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    if (toastFadeRef.current) clearTimeout(toastFadeRef.current)
    setToastMessage(message)
    setToastFading(false)
    toastTimeoutRef.current = setTimeout(() => {
      setToastFading(true)
      toastTimeoutRef.current = null
      toastFadeRef.current = setTimeout(() => {
        setToastMessage(null)
        setToastFading(false)
        toastFadeRef.current = null
      }, TOAST_FADE_MS)
    }, TOAST_DURATION_MS)
  }

  const dashboardContainerRef = useRef(null)

  async function handleExitApp() {
    // [glucose] Clear server glucose cache on app exit
    fetch('http://localhost:5175/api/glucose/clear', { method: 'POST' }).catch(() => {})
    try {
      await fetch('http://localhost:5175/app/shutdown', {
        method: 'POST',
      })
      showToast('Shutting down...')
    } catch {
      showToast('Failed to trigger shutdown')
    }
  }

  useEffect(() => {
    setToastMessage(null)
    setToastFading(false)
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
      toastTimeoutRef.current = null
    }
    if (toastFadeRef.current) {
      clearTimeout(toastFadeRef.current)
      toastFadeRef.current = null
    }
  }, [screen])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-200">
      <div ref={dashboardContainerRef} className="w-[1024px] h-[600px] bg-[#dcf7de] flex flex-col overflow-hidden shadow-xl relative">
        {toastMessage && (
          <div
            className={`absolute top-0 left-0 right-0 z-20 flex justify-center px-4 py-2 text-sm font-medium text-amber-800 bg-amber-100 border-b border-amber-200 shadow-sm transition-opacity duration-300 ${
              toastFading ? 'opacity-0' : 'opacity-100'
            }`}
            role="alert"
          >
            {toastMessage}
          </div>
        )}
        {(screen === 'welcome' || screen === 'register' || screen === 'login' || screen === 'doctor-login' || screen === 'guest' || screen === 'sync') && (
          <header className="flex justify-center pt-6 pb-4 shrink-0">
            <img src="/Dark.png" alt="Health Dost" className="w-[293px] h-[122px] object-contain" />
          </header>
        )}

        {screen === 'welcome' && (
          <WelcomeScreen
            onNewPatient={() => setScreen('register')}
            onExistingPatient={() => setScreen('login')}
            onDoctorLogin={() => setScreen('doctor-login')}
            onOfflineGuest={() => setScreen('guest')}
            onSyncOffline={() => setScreen('sync')}
            onExitApp={handleExitApp}
          />
        )}
        {screen === 'doctor-login' && (
          <DoctorLoginScreen
            onBack={() => setScreen('welcome')}
            onLoginSuccess={(info) => {
              setDoctorInfo(info)
              setScreen('doctor-portal')
            }}
            onShowMessage={showToast}
          />
        )}
        {screen === 'doctor-portal' && (
          <div className="flex-1 min-h-0">
            <DoctorPortal
              doctorInfo={doctorInfo}
              onLogout={() => {
                setDoctorInfo(null)
                setScreen('welcome')
              }}
              onOpenPatientHistory={(pid, pProfile) => {
                setPatientId(pid)
                setPatientProfile(pProfile)
                setScreen('cloud')
              }}
              onShowMessage={showToast}
            />
          </div>
        )}
        {screen === 'register' && (
          <RegisterScreen
            onBack={() => setScreen('welcome')}
            onRegisterSuccess={() => setScreen('login')}
            onShowMessage={showToast}
          />
        )}
        {screen === 'login' && (
          <LoginScreen
            onBack={() => setScreen('welcome')}
            onLoginSuccess={handleLoginSuccess}
            onShowMessage={showToast}
          />
        )}
        {screen === 'guest' && (
          <OfflineGuestScreen
            onBack={() => setScreen('welcome')}
            onShowMessage={showToast}
            onStartGuest={({ patientId: guestId, patientProfile: guestProfile }) => {
              setIsOfflineGuest(true)
              setPatientId(guestId)
              setNurseName('Guest')
              setPatientProfile(guestProfile)
              setScreen('dashboard')
            }}
          />
        )}
        {screen === 'dashboard' && (
          <div className="flex-1 min-h-0">
            <Dashboard
              onLogout={handleLogout}
              onHome={() => setScreen('dashboard')}
              onAppointments={() => {
                if (isOfflineGuest) return
                setScreen('appointments')
              }}
              onCloud={() => {
                if (isOfflineGuest) return
                setScreen('cloud')
              }}
              patientId={patientId}
              nurseName={nurseName}
              patientProfile={patientProfile}
              onShowMessage={showToast}
              dashboardContainerRef={dashboardContainerRef}
              isOfflineGuest={isOfflineGuest}
            />
          </div>
        )}
        {screen === 'cloud' && (
          <div className="flex-1 min-h-0">
            <CloudHistory
              onLogout={handleLogout}
              onHome={() => {
                if (doctorInfo) {
                  setScreen('doctor-portal')
                } else {
                  setScreen('dashboard')
                }
              }}
              onAppointments={() => {
                if (isOfflineGuest) return
                setScreen('appointments')
              }}
              onCloud={() => setScreen('cloud')}
              patientId={patientId}
              nurseName={nurseName}
              patientProfile={patientProfile}
              onShowMessage={showToast}
              onRefreshSessions={reloadPatientProfile}
            />
          </div>
        )}
        {screen === 'appointments' && (
          <div className="flex-1 min-h-0">
            <Appointments
              onLogout={handleLogout}
              onHome={() => {
                if (doctorInfo) {
                  setScreen('doctor-portal')
                } else {
                  setScreen('dashboard')
                }
              }}
              onAppointments={() => {
                if (isOfflineGuest) return
                setScreen('appointments')
              }}
              onCloud={() => {
                if (isOfflineGuest) return
                setScreen('cloud')
              }}
              patientId={patientId}
              patientProfile={patientProfile}
              onShowMessage={showToast}
            />
          </div>
        )}
        {screen === 'sync' && (
          <OfflineSync
            onBack={() => setScreen('welcome')}
            onShowMessage={showToast}
          />
        )}
      </div>
      <VirtualKeyboard />
    </div>
  )
}

export default App
