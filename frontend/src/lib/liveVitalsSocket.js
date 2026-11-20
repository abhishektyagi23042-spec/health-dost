/**
 * Live vitals Socket.IO client – connects to Pi server for Arduino serial data.
 * Env: VITE_SOCKET_URL (default http://localhost:5175)
 */

import { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5175'
const ECG_MAX_SAMPLES = 800

const INITIAL_VITALS = {
  heartRate: 0,
  bloodOxygen: 0,
  temperature: 0,
  stressLevel: 0,
  bloodPressure: '0/0',
}

const INITIAL_STATUS = { connected: false, port: '', lastFrameAt: null, message: null }

/**
 * React hook for live vitals from Arduino via Pi server.
 * @returns {{ arduinoStatus: Object, vitals: Object, requestReset: function, requestReconnect: function }}
 */
export function useLiveVitals() {
  const [arduinoStatus, setArduinoStatus] = useState(INITIAL_STATUS)
  const [vitals, setVitals] = useState(INITIAL_VITALS)
  const [ecgSamples, setEcgSamples] = useState([])
  const socketRef = useRef(null)

  useEffect(() => {
    const socket = io(SOCKET_URL)
    socketRef.current = socket

    socket.on('arduinoStatus', (status) => {
      setArduinoStatus((s) => ({ ...s, ...status }))
    })

    socket.on('vitalsUpdate', (v) => {
      setVitals({ ...INITIAL_VITALS, ...v })
    })

    socket.on('ecgUpdate', (payload) => {
      const incoming = Array.isArray(payload?.samples)
        ? payload.samples.map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : []
      if (incoming.length === 0) return
      setEcgSamples((prev) => {
        const next = prev.concat(incoming)
        return next.length > ECG_MAX_SAMPLES ? next.slice(next.length - ECG_MAX_SAMPLES) : next
      })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  return {
    arduinoStatus,
    liveVitals: vitals,
    ecgSamples,
    requestReset: () => socketRef.current?.emit('requestReset'),
    requestReconnect: () => socketRef.current?.emit('requestReconnect'),
  }
}
