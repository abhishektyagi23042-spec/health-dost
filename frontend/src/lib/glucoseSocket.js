import { useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5175'

export function useGlucose() {
  const [glucoseData, setGlucoseData] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const socketRef = useRef(null)

  useEffect(() => {
    // Initial fetch of last reading from server
    fetch(`${SOCKET_URL}/api/glucose/last`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.mgdl != null) {
          setGlucoseData(data)
        }
      })
      .catch(() => {})

    const socket = io(SOCKET_URL)
    socketRef.current = socket

    socket.on('glucose', (payload) => {
      setSyncing(false)
      if (!payload) return

      if (payload.status === 'ok') {
        setGlucoseData({
          mgdl: payload.mgdl,
          timestamp: payload.timestamp,
          seq: payload.seq,
          device: payload.device,
        })
        setErrorMessage(null)
      } else if (payload.status === 'cleared') {
        setGlucoseData(null)
        setErrorMessage(null)
      } else {
        // stale, not_found, pairing_required, timeout, error
        setGlucoseData(null)
        setErrorMessage(payload.message || `Status: ${payload.status}`)
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const syncGlucose = useCallback(async () => {
    setSyncing(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`${SOCKET_URL}/api/glucose/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setErrorMessage(data.message || data.error || 'Failed to sync glucometer')
      }
      return data
    } catch (err) {
      setErrorMessage(err.message || 'Connection error to server')
      return { ok: false, error: err.message }
    } finally {
      setSyncing(false)
    }
  }, [])

  const clearGlucose = useCallback(async () => {
    setGlucoseData(null)
    setErrorMessage(null)
    try {
      await fetch(`${SOCKET_URL}/api/glucose/clear`, {
        method: 'POST',
      })
    } catch {}
  }, [])

  return {
    glucoseData,
    syncing,
    errorMessage,
    syncGlucose,
    clearGlucose,
  }
}
