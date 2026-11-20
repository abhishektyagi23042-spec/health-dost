import { doc, getDoc, writeBatch, arrayRemove } from 'firebase/firestore'
import { ref, deleteObject } from 'firebase/storage'
import { db, storage } from './firebase'

/**
 * Delete a session document, remove its id from the parent patient's
 * sessionHistory array, and delete the associated screenshot from Storage
 * (if screenshotPath exists on the session doc).
 *
 * Firestore operations are committed first in a batch; the screenshot
 * deletion is attempted afterwards and failures there are ignored.
 */
export async function deleteSessionAndAssets({ patientId, sessionId }) {
  if (!patientId || !sessionId) return

  const patientRef = doc(db, 'patients', patientId)
  const sessionRef = doc(db, 'patients', patientId, 'sessions', sessionId)

  // Fetch session once to get screenshotPath (if any)
  const snap = await getDoc(sessionRef)
  const data = snap.exists() ? snap.data() : null
  const screenshotPath = data?.screenshotPath

  const batch = writeBatch(db)
  batch.delete(sessionRef)
  batch.update(patientRef, {
    sessionHistory: arrayRemove(sessionId),
  })

  await batch.commit()

  if (screenshotPath) {
    try {
      const storageRef = ref(storage, screenshotPath)
      await deleteObject(storageRef)
    } catch {
      // Ignore screenshot deletion failures; Firestore state is already consistent
    }
  }
}

