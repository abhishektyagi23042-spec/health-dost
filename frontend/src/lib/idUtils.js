/**
 * Normalize a patient name to a stable Firestore document ID.
 * @param {string} name - Patient name (e.g. from register or login form)
 * @returns {string} e.g. "patient_john_doe" or "patient_unknown" if result would be empty
 */
export function normalizePatientId(name) {
  if (typeof name !== 'string') return 'patient_unknown'
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '_')
  return cleaned ? `patient_${cleaned}` : 'patient_unknown'
}

/**
 * Generate a unique session ID using local date/time.
 * @returns {string} e.g. "session_21022026_153045" (session_DDMMYYYY_HHmmss)
 */
export function generateSessionId() {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yyyy = now.getFullYear()
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `session_${dd}${mm}${yyyy}_${hh}${min}${ss}`
}
