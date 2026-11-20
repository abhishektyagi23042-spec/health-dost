import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

/**
 * Generate a unique appointment ID using local date/time.
 * @returns {string} e.g. "appt_21022026_153045" (appt_DDMMYYYY_HHmmss)
 */
export function generateAppointmentId() {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = now.getFullYear()
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `appt_${dd}${mm}${yyyy}_${hh}${min}${ss}`
}

/**
 * @param {string} date - YYYY-MM-DD
 * @param {string} time - HH:mm
 * @returns {Timestamp}
 */
export function scheduledAtFromDateAndTime(date, time) {
  const [y, m, d] = String(date).split('-').map((x) => parseInt(x, 10))
  const [hh, min] = String(time).split(':').map((x) => parseInt(x, 10))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error('Invalid date')
  }
  if (!Number.isFinite(hh) || !Number.isFinite(min)) {
    throw new Error('Invalid time')
  }
  const dt = new Date(y, m - 1, d, hh, min, 0, 0)
  return Timestamp.fromDate(dt)
}

/**
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string}
 */
export function formatAppointmentDateLabel(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '—'
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
  })
}

/**
 * @param {string} patientId
 * @param {{ doctorName: string, date: string, time: string }} payload
 */
export async function createAppointment({ patientId, doctorName, date, time }) {
  if (!patientId) throw new Error('Missing patientId')
  const name = String(doctorName || '').trim()
  if (!name) throw new Error('Doctor name is required')

  const appointmentId = generateAppointmentId()
  const scheduledAt = scheduledAtFromDateAndTime(date, time)

  const appointmentRef = doc(db, 'patients', patientId, 'appointments', appointmentId)
  const patientRef = doc(db, 'patients', patientId)

  const batch = writeBatch(db)
  batch.set(appointmentRef, {
    appointmentId,
    doctorName: name,
    date,
    time,
    scheduledAt,
    createdAt: serverTimestamp(),
  })
  batch.update(patientRef, {
    appointmentHistory: arrayUnion(appointmentId),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/**
 * @param {string} patientId
 * @param {string} appointmentId
 */
export async function deleteAppointment({ patientId, appointmentId }) {
  if (!patientId || !appointmentId) return

  const appointmentRef = doc(db, 'patients', patientId, 'appointments', appointmentId)
  const patientRef = doc(db, 'patients', patientId)

  const batch = writeBatch(db)
  batch.delete(appointmentRef)
  batch.update(patientRef, {
    appointmentHistory: arrayRemove(appointmentId),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}

/**
 * @param {string} patientId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listAppointments(patientId) {
  if (!patientId) return []
  const colRef = collection(db, 'patients', patientId, 'appointments')
  const snapshot = await getDocs(colRef)
  const items = []
  snapshot.forEach((d) => {
    items.push({ ...d.data(), appointmentId: d.id })
  })
  items.sort((a, b) => {
    const ta = a.scheduledAt?.toMillis?.() ?? 0
    const tb = b.scheduledAt?.toMillis?.() ?? 0
    return ta - tb
  })
  return items
}

/**
 * Soonest appointment strictly after now (local clock vs scheduledAt).
 * @param {string} patientId
 * @returns {Promise<null | Record<string, unknown>>}
 */
export async function getNextUpcoming(patientId) {
  const items = await listAppointments(patientId)
  const nowMs = Date.now()
  const future = items.filter((a) => {
    const t = a.scheduledAt?.toDate?.()
    if (!t) return false
    return t.getTime() > nowMs
  })
  return future.length ? future[0] : null
}
