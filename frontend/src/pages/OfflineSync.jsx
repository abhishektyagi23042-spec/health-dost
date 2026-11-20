import { useEffect, useMemo, useState } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db, storage } from '../lib/firebase'
import { normalizePatientId } from '../lib/idUtils'

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5175'

function base64ToBlob(base64) {
  const binary = atob(base64 || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'image/jpeg' })
}

// [records] Convert base64 to PDF Blob for offline record sync
function base64ToPdfBlob(base64) {
  const binary = atob(base64 || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'application/pdf' })
}

export default function OfflineSync({ onBack, onShowMessage }) {
  const [patients, setPatients] = useState([])
  const [loadingPatients, setLoadingPatients] = useState(false)
  const [activePatient, setActivePatient] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [syncingSessionId, setSyncingSessionId] = useState('')
  const [deletingSessionId, setDeletingSessionId] = useState('')

  // [records] State for offline records tab and operations
  const [syncTab, setSyncTab] = useState('sessions') // 'sessions' | 'records'
  const [offlineRecords, setOfflineRecords] = useState([])
  const [loadingOfflineRecords, setLoadingOfflineRecords] = useState(false)
  const [syncingRecordId, setSyncingRecordId] = useState('')
  const [deletingRecordId, setDeletingRecordId] = useState('')

  const activeTitle = useMemo(() => activePatient?.patientName || activePatient?.patientId || '', [activePatient])

  async function loadPatients() {
    setLoadingPatients(true)
    try {
      const res = await fetch(`${SERVER_URL}/offline-saves/patients`)
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load offline patients')
      setPatients(Array.isArray(data.patients) ? data.patients : [])
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to load offline patients')
    } finally {
      setLoadingPatients(false)
    }
  }

  async function loadSessions(patientId) {
    if (!patientId) return
    setLoadingSessions(true)
    try {
      const res = await fetch(`${SERVER_URL}/offline-saves/patients/${encodeURIComponent(patientId)}/sessions`)
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load sessions')
      setSessions(Array.isArray(data.sessions) ? data.sessions : [])
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to load sessions')
    } finally {
      setLoadingSessions(false)
    }
  }

  useEffect(() => {
    loadPatients()
    // [records] Load offline medical records on mount
    loadOfflineRecords()
  }, [])

  async function syncSession(patientId, sessionId) {
    setSyncingSessionId(sessionId)
    try {
      const res = await fetch(`${SERVER_URL}/offline-saves/patients/${encodeURIComponent(patientId)}/sessions/${encodeURIComponent(sessionId)}`)
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to read session')
      const payload = data.payload || {}
      const patientName = (payload.patientName || '').trim()
      if (!patientName) throw new Error('Missing patient name in offline session')

      const nameMatchQuery = query(collection(db, 'patients'), where('name', '==', patientName), limit(1))
      const nameMatchSnapshot = await getDocs(nameMatchQuery)
      let targetPatientId = ''
      let targetPatientData = {}

      if (!nameMatchSnapshot.empty) {
        const existingDoc = nameMatchSnapshot.docs[0]
        targetPatientId = existingDoc.id
        targetPatientData = existingDoc.data() || {}
      } else {
        targetPatientId = normalizePatientId(patientName)
        const targetRef = doc(db, 'patients', targetPatientId)
        const targetSnap = await getDoc(targetRef)
        if (targetSnap.exists()) {
          targetPatientId = `${targetPatientId}_${Date.now()}`
        }
        await setDoc(doc(db, 'patients', targetPatientId), {
          name: patientName,
          gender: payload.gender || '',
          height_cm: Number(payload.height_cm) || 0,
          weight_kg: Number(payload.weight_kg) || 0,
          createdAt: serverTimestamp(),
          sessionHistory: [],
          updatedAt: serverTimestamp(),
        })
        targetPatientData = {
          height_cm: Number(payload.height_cm) || 0,
          weight_kg: Number(payload.weight_kg) || 0,
        }
      }

      const screenshotPath = `screenshots/${targetPatientId}/${sessionId}.jpg`
      let screenshotUrl = ''
      if (data.screenshotBase64) {
        const blob = base64ToBlob(data.screenshotBase64)
        const storageRef = ref(storage, screenshotPath)
        await uploadBytes(storageRef, blob)
        screenshotUrl = await getDownloadURL(storageRef)
      }

      const cloudPayload = {
        bloodOxygen: payload.bloodOxygen,
        bloodPressure: payload.bloodPressure,
        bmi: payload.bmi,
        heartRate: payload.heartRate,
        stressLevel: payload.stressLevel,
        temperature: payload.temperature,
        diagnosisText: payload.diagnosisText || 'Not Generated',
        screenshotPath,
        screenshotUrl,
        sessionId,
        sessionDate: serverTimestamp(),
        mode: 'offline',
        nurseName: payload.nurseName || '',
        height_cm: targetPatientData.height_cm ?? (Number(payload.height_cm) || 0),
        weight_kg: targetPatientData.weight_kg ?? (Number(payload.weight_kg) || 0),
        // [glucose] Preserve offline glucose data and metadata in cloud payload
        ...(payload.glucose !== undefined && { glucose: payload.glucose }),
        ...(payload.glucoseMeta !== undefined && { glucoseMeta: payload.glucoseMeta }),
      }

      const patientDocRef = doc(db, 'patients', targetPatientId)
      const sessionDocRef = doc(db, 'patients', targetPatientId, 'sessions', sessionId)
      const batch = writeBatch(db)
      batch.set(sessionDocRef, cloudPayload)
      batch.update(patientDocRef, {
        sessionHistory: arrayUnion(sessionId),
        updatedAt: serverTimestamp(),
      })
      await batch.commit()

      // Prevent duplicate syncs by removing the local offline copy after successful upload.
      const deleteRes = await fetch(
        `${SERVER_URL}/offline-saves/patients/${encodeURIComponent(patientId)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' }
      )
      const deleteData = await deleteRes.json()
      if (!deleteRes.ok || !deleteData?.ok) {
        throw new Error(deleteData?.error || 'Synced, but failed to delete local offline session')
      }

      if (deleteData.removedPatient) {
        setActivePatient(null)
        setSessions([])
      } else {
        await loadSessions(patientId)
      }
      await loadPatients()
      onShowMessage?.('Session synced and removed from offline storage')
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to sync session')
    } finally {
      setSyncingSessionId('')
    }
  }

  async function deleteSession(patientId, sessionId) {
    setDeletingSessionId(sessionId)
    try {
      const res = await fetch(
        `${SERVER_URL}/offline-saves/patients/${encodeURIComponent(patientId)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to delete session')
      if (data.removedPatient) {
        setActivePatient(null)
        setSessions([])
      } else {
        await loadSessions(patientId)
      }
      await loadPatients()
      onShowMessage?.('Offline session deleted')
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to delete session')
    } finally {
      setDeletingSessionId('')
    }
  }

  // [records] Load offline medical records from local server
  async function loadOfflineRecords() {
    setLoadingOfflineRecords(true)
    try {
      const res = await fetch(`${SERVER_URL}/records/offline`)
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load offline records')
      setOfflineRecords(Array.isArray(data.records) ? data.records : [])
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to load offline records')
      setOfflineRecords([])
    } finally {
      setLoadingOfflineRecords(false)
    }
  }

  // [records] Sync an offline medical record to Firebase Storage and Firestore
  async function syncRecord(patientId, recordId) {
    setSyncingRecordId(recordId)
    try {
      const res = await fetch(
        `${SERVER_URL}/records/offline/${encodeURIComponent(patientId)}/${encodeURIComponent(recordId)}`
      )
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to read offline record')

      const { metadata, pdfBase64 } = data.record || {}
      if (!pdfBase64) throw new Error('Missing PDF data in offline record')

      const pdfBlob = base64ToPdfBlob(pdfBase64)

      // Re-use patient matching logic: if guest, match by registered name or create registered doc
      let targetPatientId = patientId
      const isGuest = String(patientId).startsWith('guest_')
      const guestName = isGuest
        ? String(patientId).replace(/^guest_/, '').replace(/_/g, ' ')
        : ''

      if (isGuest && guestName) {
        const nameMatchQuery = query(
          collection(db, 'patients'),
          where('name', '==', guestName),
          limit(1)
        )
        const nameMatchSnapshot = await getDocs(nameMatchQuery)
        if (!nameMatchSnapshot.empty) {
          targetPatientId = nameMatchSnapshot.docs[0].id
        } else {
          targetPatientId = normalizePatientId(guestName)
          const targetRef = doc(db, 'patients', targetPatientId)
          const targetSnap = await getDoc(targetRef)
          if (targetSnap.exists()) {
            targetPatientId = `${targetPatientId}_${Date.now()}`
          }
          await setDoc(doc(db, 'patients', targetPatientId), {
            name: guestName,
            gender: '',
            height_cm: 0,
            weight_kg: 0,
            createdAt: serverTimestamp(),
            sessionHistory: [],
            updatedAt: serverTimestamp(),
          })
        }
      } else {
        const patientSnap = await getDoc(doc(db, 'patients', targetPatientId))
        if (!patientSnap.exists()) {
          targetPatientId = normalizePatientId(patientId)
        }
      }

      const timestamp = metadata?.timestamp || new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15)
      const categorySlug = String(metadata?.category || 'record').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const storagePath = `patients/${targetPatientId}/records/${timestamp}_${categorySlug}.pdf`

      // 1. Upload PDF to Storage with safe timeout
      const storageRef = ref(storage, storagePath)
      const storageTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Cloud storage upload timed out')), 10000)
      )
      await Promise.race([
        uploadBytes(storageRef, pdfBlob, { contentType: 'application/pdf' }),
        storageTimeout,
      ])

      // 2. Add document to Firestore subcollection
      const recordDocRef = doc(collection(db, 'patients', targetPatientId, 'records'))
      await setDoc(recordDocRef, {
        title: metadata?.title || `${metadata?.category || 'Record'} - ${timestamp}`,
        category: metadata?.category || 'Other',
        documentDate: metadata?.documentDate || '',
        hospital: metadata?.hospital || '',
        note: metadata?.note || '',
        storagePath,
        pages: metadata?.pages || 1,
        sizeBytes: pdfBlob.size,
        source: metadata?.source || 'file',
        uploadedAt: serverTimestamp(),
        uploadedBy: metadata?.uploadedBy || 'Sync Operator',
        consent: true,
      })

      // 3. Delete local offline files only after confirmed upload
      const deleteRes = await fetch(
        `${SERVER_URL}/records/offline/${encodeURIComponent(patientId)}/${encodeURIComponent(recordId)}`,
        { method: 'DELETE' }
      )
      const deleteData = await deleteRes.json()
      if (!deleteRes.ok || !deleteData?.ok) {
        throw new Error('Synced to cloud, but failed to delete local offline record')
      }

      await loadOfflineRecords()
      onShowMessage?.('Record synced and removed from offline storage')
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to sync medical record')
    } finally {
      setSyncingRecordId('')
    }
  }

  // [records] Delete an offline medical record locally
  async function deleteRecord(patientId, recordId) {
    setDeletingRecordId(recordId)
    try {
      const res = await fetch(
        `${SERVER_URL}/records/offline/${encodeURIComponent(patientId)}/${encodeURIComponent(recordId)}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to delete record')
      await loadOfflineRecords()
      onShowMessage?.('Offline record deleted')
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to delete record')
    } finally {
      setDeletingRecordId('')
    }
  }

  return (
    <div className="flex-1 min-h-0 px-8 pb-8">
      <div className="bg-white rounded-xl shadow-lg h-full p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-['Space_Grotesk'] text-[24px] font-bold text-[#2d3035]">Sync Offline Data</h1>
          <button
            type="button"
            onClick={onBack}
            className="py-2 px-4 bg-[#ebddfa] text-[#2d3035] rounded-lg hover:bg-[#E0C8FF]"
          >
            Back
          </button>
        </div>

        {/* [records] Tab Switcher for Offline Sessions vs Offline Records */}
        <div className="flex gap-3 mb-4 border-b border-slate-200 pb-2">
          <button
            type="button"
            onClick={() => setSyncTab('sessions')}
            className={`py-1.5 px-3 rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors ${
              syncTab === 'sessions'
                ? 'bg-[#ebddfa] text-[#2d3035] font-bold shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Offline Sessions ({patients.reduce((sum, p) => sum + (p.sessionCount || 0), 0)})
          </button>
          <button
            type="button"
            onClick={() => {
              setSyncTab('records')
              loadOfflineRecords()
            }}
            className={`py-1.5 px-3 rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors ${
              syncTab === 'records'
                ? 'bg-[#ebddfa] text-[#2d3035] font-bold shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Offline Medical Records ({offlineRecords.length})
          </button>
        </div>

        {syncTab === 'sessions' ? (
          <>
            <div className="mb-3">
              <button
                type="button"
                onClick={loadPatients}
                className="py-2 px-4 bg-[#ebddfa] text-[#2d3035] rounded-lg hover:bg-[#E0C8FF]"
                disabled={loadingPatients}
              >
                {loadingPatients ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <div className="space-y-2">
              {patients.map((patient) => (
                <button
                  key={patient.patientId}
                  type="button"
                  onClick={async () => {
                    setActivePatient(patient)
                    await loadSessions(patient.patientId)
                  }}
                  className="w-full text-left border border-slate-200 rounded-lg p-3 hover:bg-slate-50"
                >
                  <div className="font-medium text-[#2d3035]">{patient.patientName || patient.patientId}</div>
                  <div className="text-xs text-slate-500">{patient.patientId} • {patient.sessionCount} session(s)</div>
                </button>
              ))}
              {!loadingPatients && patients.length === 0 && (
                <div className="text-slate-500 text-sm">No offline patients found.</div>
              )}
            </div>
          </>
        ) : (
          /* [records] Offline Medical Records view */
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-mulish text-slate-500">
                {offlineRecords.length} offline record{offlineRecords.length === 1 ? '' : 's'} waiting to sync
              </span>
              <button
                type="button"
                onClick={loadOfflineRecords}
                disabled={loadingOfflineRecords}
                className="py-1.5 px-3 bg-[#ebddfa] text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] hover:bg-[#E0C8FF] disabled:opacity-50"
              >
                {loadingOfflineRecords ? 'Refreshing…' : 'Refresh Records'}
              </button>
            </div>

            {offlineRecords.length === 0 ? (
              <div className="text-slate-500 text-sm text-center py-8">
                No offline medical records found.
              </div>
            ) : (
              <div className="space-y-2">
                {offlineRecords.map((rec) => (
                  <div
                    key={`${rec.patientId}_${rec.recordId}`}
                    className="border border-slate-200 rounded-lg p-3.5 flex items-center justify-between bg-slate-50 hover:bg-white transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-sm shrink-0">
                        📄
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-['Space_Grotesk'] font-semibold text-sm text-[#2d3035] truncate">
                            {rec.metadata?.title || rec.recordId}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-['Space_Grotesk'] bg-[#DCF7DE] text-[#1E6F5C]">
                            {rec.metadata?.category || 'Record'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 font-mulish flex gap-3 mt-0.5">
                          <span>Patient: {rec.patientId}</span>
                          {rec.metadata?.documentDate && <span>Date: {rec.metadata.documentDate}</span>}
                          {rec.metadata?.pages && <span>Pages: {rec.metadata.pages}</span>}
                          {rec.metadata?.sizeBytes && <span>Size: {(rec.metadata.sizeBytes / 1024).toFixed(0)} KB</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => syncRecord(rec.patientId, rec.recordId)}
                        disabled={syncingRecordId === rec.recordId || deletingRecordId === rec.recordId}
                        className="py-1.5 px-4 bg-[#ebddfa] text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] font-medium hover:bg-[#E0C8FF] disabled:opacity-60"
                      >
                        {syncingRecordId === rec.recordId ? 'Syncing…' : 'Sync to Cloud'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRecord(rec.patientId, rec.recordId)}
                        disabled={syncingRecordId === rec.recordId || deletingRecordId === rec.recordId}
                        className="py-1.5 px-3 bg-rose-100 text-rose-800 rounded-lg text-xs font-['Space_Grotesk'] font-medium hover:bg-rose-200 disabled:opacity-60"
                      >
                        {deletingRecordId === rec.recordId ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {activePatient && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] overflow-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-['Space_Grotesk'] text-[22px] font-bold text-[#2d3035]">{activeTitle}</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => loadSessions(activePatient.patientId)}
                  className="py-2 px-4 bg-[#ebddfa] text-[#2d3035] rounded-lg hover:bg-[#E0C8FF]"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActivePatient(null)
                    setSessions([])
                  }}
                  className="py-2 px-4 bg-[#ebddfa] text-[#2d3035] rounded-lg hover:bg-[#E0C8FF]"
                >
                  Exit
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {sessions.map((session) => (
                <div key={session.sessionId} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-[#2d3035]">{session.sessionId}</div>
                    <div className="text-xs text-slate-500">{session.sessionDate || 'No timestamp'}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => syncSession(activePatient.patientId, session.sessionId)}
                      disabled={syncingSessionId === session.sessionId || deletingSessionId === session.sessionId}
                      className="py-2 px-4 bg-[#ebddfa] text-[#2d3035] rounded-lg hover:bg-[#E0C8FF] disabled:opacity-60"
                    >
                      {syncingSessionId === session.sessionId ? 'Syncing…' : 'Sync'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSession(activePatient.patientId, session.sessionId)}
                      disabled={syncingSessionId === session.sessionId || deletingSessionId === session.sessionId}
                      className="py-2 px-4 bg-rose-100 text-rose-800 rounded-lg hover:bg-rose-200 disabled:opacity-60"
                    >
                      {deletingSessionId === session.sessionId ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
              {!loadingSessions && sessions.length === 0 && (
                <div className="text-slate-500 text-sm">No sessions found for this patient.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

