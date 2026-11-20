import { GoogleGenAI } from '@google/genai'
import { formatVitalsForPrompt } from './vitals.js'

const PRIMARY_MODEL = 'gemini-2.0-flash'
const FALLBACK_MODEL = 'gemini-1.5-flash'
const MAX_LINES = 4

/**
 * Get a concise, non-diagnostic summary (max 4 lines) from Gemini based on vitals.
 * @param {Parameters<typeof formatVitalsForPrompt>[0]} vitals - Vitals object from generateRandomVitals()
 * @returns {Promise<string|null>} Diagnosis text (at most 4 lines) or null if API cannot be used
 */
export async function getDiagnosisFromVitals(vitals) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    console.warn('Gemini API key is not configured in .env (VITE_GEMINI_API_KEY)')
    return null
  }

  try {
    const ai = new GoogleGenAI({ apiKey })
    const vitalsSummary = formatVitalsForPrompt(vitals)
    const prompt = `${vitalsSummary}\n\nBased on these vitals only, provide a concise, non-diagnostic summary in at most ${MAX_LINES} lines of plain text. Do not give medical advice or a diagnosis. Do not use bullet points.`

    let response
    try {
      response = await ai.models.generateContent({
        model: PRIMARY_MODEL,
        contents: prompt,
      })
    } catch {
      response = await ai.models.generateContent({
        model: FALLBACK_MODEL,
        contents: prompt,
      })
    }

    let text = response?.text
    if (typeof text === 'function') text = text()
    if (text == null || typeof text !== 'string') return null

    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const capped = lines.slice(0, MAX_LINES).join('\n').trim()
    return capped || null
  } catch (err) {
    console.error('Gemini generateContent error:', err?.message || err)
    return null
  }
}
