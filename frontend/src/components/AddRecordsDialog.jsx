// [records] Add Records Dialog component for uploading patient medical records via file, USB drive, or scanner.
import { useState, useEffect, useRef } from 'react'
import { PDFDocument } from 'pdf-lib'
import { ref, uploadBytes, uploadBytesResumable } from 'firebase/storage'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, storage } from '../lib/firebase'

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5175'

const CATEGORIES = [
  'Lab report',
  'Prescription',
  'Discharge summary',
  'Imaging/X-ray report',
  'ECG report',
  'Other',
]

/**
 * Downscale image if longest side > 2000px, convert to JPEG with quality 0.8
 */
async function processImageToJpeg(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob)
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url)
      reject(new Error('Image processing timed out'))
    }, 8000)

    const img = new Image()
    img.onload = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      let { width, height } = img
      const maxDim = 2000
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      // Fill white background for transparent PNGs
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to convert image to JPEG'))
            return
          }
          resolve(blob)
        },
        'image/jpeg',
        0.8
      )
    }
    img.onerror = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('Could not load image file'))
    }
    img.src = url
  })
}

/**
 * Merge list of image blobs and PDF blobs into a single A4 PDF using pdf-lib.
 */
async function buildMergedPdf(items, onProgress) {
  const mergedPdf = await PDFDocument.create()
  // A4 dimensions in points
  const A4_WIDTH = 595.28
  const A4_HEIGHT = 841.89
  const MARGIN = 20
  const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2
  const CONTENT_HEIGHT = A4_HEIGHT - MARGIN * 2

  let processed = 0
  for (const item of items) {
    if (item.type === 'image') {
      const jpegBlob = await processImageToJpeg(item.file)
      const jpegBytes = await jpegBlob.arrayBuffer()
      const embeddedImg = await mergedPdf.embedJpg(jpegBytes)

      const imgWidth = embeddedImg.width
      const imgHeight = embeddedImg.height
      const scale = Math.min(CONTENT_WIDTH / imgWidth, CONTENT_HEIGHT / imgHeight, 1)

      const finalWidth = imgWidth * scale
      const finalHeight = imgHeight * scale
      const x = (A4_WIDTH - finalWidth) / 2
      const y = (A4_HEIGHT - finalHeight) / 2

      const page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT])
      page.drawImage(embeddedImg, {
        x,
        y,
        width: finalWidth,
        height: finalHeight,
      })
    } else if (item.type === 'pdf') {
      const pdfBytes = await item.file.arrayBuffer()
      const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
      const pageIndices = srcDoc.getPageIndices()
      const copiedPages = await mergedPdf.copyPages(srcDoc, pageIndices)
      for (const p of copiedPages) {
        mergedPdf.addPage(p)
      }
    }
    processed++
    onProgress?.(processed, items.length)
  }

  const totalPages = mergedPdf.getPageCount()
  if (totalPages === 0) {
    throw new Error('No pages found in selected documents')
  }
  if (totalPages > 30) {
    throw new Error(`Maximum 30 pages allowed. Selected documents contain ${totalPages} pages.`)
  }

  const finalPdfBytes = await mergedPdf.save()
  const sizeBytes = finalPdfBytes.byteLength
  if (sizeBytes > 25 * 1024 * 1024) {
    throw new Error(
      `Total document size exceeds 25 MB limit (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB).`
    )
  }

  return {
    pdfBlob: new Blob([finalPdfBytes], { type: 'application/pdf' }),
    pages: totalPages,
    sizeBytes,
  }
}

export default function AddRecordsDialog({
  patientId,
  patientName,
  nurseName,
  isOfflineGuest,
  onClose,
  onShowMessage,
}) {
  const [activeTab, setActiveTab] = useState('files') // 'files' | 'scanner'
  const [items, setItems] = useState([]) // Array of { id, name, type: 'image'|'pdf', file: Blob|File, previewUrl, source: 'file'|'usb'|'scan' }
  const [category, setCategory] = useState(CATEGORIES[0])
  const [documentDate, setDocumentDate] = useState('')
  const [hospital, setHospital] = useState('')
  const [title, setTitle] = useState('')
  const [consent, setConsent] = useState(false)

  // USB browser state
  const [showUsbBrowser, setShowUsbBrowser] = useState(false)
  const [usbFiles, setUsbFiles] = useState([])
  const [loadingUsb, setLoadingUsb] = useState(false)
  const [selectedUsbPaths, setSelectedUsbPaths] = useState(new Set())

  // Scanner state
  const [scanConfig, setScanConfig] = useState({ enabled: false, sources: ['Flatbed'] })
  const [scanSource, setScanSource] = useState('Flatbed')
  const [scanning, setScanning] = useState(false)

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatusText, setUploadStatusText] = useState('')
  const uploadTaskRef = useRef(null)

  const fileInputRef = useRef(null)

  // Check scanner config on mount
  useEffect(() => {
    fetch(`${SERVER_URL}/scan/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data.config) {
          setScanConfig(data.config)
        }
      })
      .catch(() => {})
  }, [])

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      items.forEach((it) => {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl)
      })
    }
  }, [items])

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    const newItems = files.map((f) => {
      const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      const previewUrl = !isPdf ? URL.createObjectURL(f) : null
      return {
        id: `${Date.now()}_${Math.random()}`,
        name: f.name,
        type: isPdf ? 'pdf' : 'image',
        file: f,
        previewUrl,
        source: 'file',
      }
    })

    setItems((prev) => [...prev, ...newItems])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function loadUsbFiles() {
    setLoadingUsb(true)
    setSelectedUsbPaths(new Set())
    try {
      const res = await fetch(`${SERVER_URL}/records/usb`)
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to list USB drive')
      setUsbFiles(Array.isArray(data.files) ? data.files : [])
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to access USB drive')
      setUsbFiles([])
    } finally {
      setLoadingUsb(false)
    }
  }

  function toggleUsbSelect(path) {
    setSelectedUsbPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function importSelectedUsbFiles() {
    if (selectedUsbPaths.size === 0) return
    const pathsToImport = Array.from(selectedUsbPaths)
    setLoadingUsb(true)

    try {
      const imported = []
      for (const p of pathsToImport) {
        const fileObj = usbFiles.find((f) => f.path === p)
        const res = await fetch(`${SERVER_URL}/records/usb/file?path=${encodeURIComponent(p)}`)
        if (!res.ok) throw new Error(`Failed to load USB file: ${fileObj?.name || p}`)
        const blob = await res.blob()
        const isPdf = p.toLowerCase().endsWith('.pdf')
        const previewUrl = !isPdf ? URL.createObjectURL(blob) : null
        imported.push({
          id: `${Date.now()}_${Math.random()}`,
          name: fileObj?.name || p.split(/[/\\]/).pop(),
          type: isPdf ? 'pdf' : 'image',
          file: blob,
          previewUrl,
          source: 'usb',
        })
      }

      setItems((prev) => [...prev, ...imported])
      setShowUsbBrowser(false)
      setSelectedUsbPaths(new Set())
      onShowMessage?.(`Imported ${imported.length} file(s) from USB`)
    } catch (err) {
      onShowMessage?.(err?.message || 'Failed to import files from USB')
    } finally {
      setLoadingUsb(false)
    }
  }

  async function handleScan() {
    setScanning(true)
    try {
      const res = await fetch(`${SERVER_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: scanSource }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Scan failed')

      const pages = Array.isArray(data.pages) ? data.pages : []
      if (pages.length === 0) throw new Error('No pages returned by scanner')

      const scannedItems = pages.map((p, idx) => {
        const byteCharacters = atob(p.base64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: p.mimeType || 'image/jpeg' })
        const previewUrl = URL.createObjectURL(blob)

        return {
          id: `${Date.now()}_scan_${idx}`,
          name: `Scan_Page_${idx + 1}.jpg`,
          type: 'image',
          file: blob,
          previewUrl,
          source: 'scan',
        }
      })

      setItems((prev) => [...prev, ...scannedItems])
      onShowMessage?.(`Scanned ${scannedItems.length} page(s)`)
    } catch (err) {
      onShowMessage?.(err?.message || 'Scanner operation failed')
    } finally {
      setScanning(false)
    }
  }

  function handleMoveItem(index, direction) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= items.length) return
    setItems((prev) => {
      const updated = [...prev]
      const [moved] = updated.splice(index, 1)
      updated.splice(targetIndex, 0, moved)
      return updated
    })
  }

  function handleDeleteItem(index) {
    setItems((prev) => {
      const updated = [...prev]
      const [removed] = updated.splice(index, 1)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return updated
    })
  }

  const cancelledRef = useRef(false)

  function handleCancelUpload() {
    cancelledRef.current = true
    if (uploadTaskRef.current?.cancel) {
      try {
        uploadTaskRef.current.cancel()
      } catch {}
    }
    uploadTaskRef.current = null
    setUploading(false)
    setUploadProgress(0)
    setUploadStatusText('')
    onShowMessage?.('Upload canceled')
  }

  // [records] Save record to offline local storage with base64 payload
  async function saveRecordLocally(pdfBlob, metadata) {
    setUploadStatusText('Saving offline...')
    setUploadProgress(70)

    const reader = new FileReader()
    const base64Promise = new Promise((resolve, reject) => {
      reader.onloadend = () => {
        const result = reader.result || ''
        const base64 = String(result).split(',')[1] || ''
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(pdfBlob)
    })

    const pdfBase64 = await base64Promise
    const res = await fetch(`${SERVER_URL}/records/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId,
        metadata,
        pdfBase64,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to save offline record')

    setUploadProgress(100)
    onShowMessage?.('Saved locally – will upload on Sync')
    onClose?.()
  }

  async function handleUpload() {
    if (items.length === 0) {
      onShowMessage?.('Please select or scan at least one file')
      return
    }
    if (!consent) {
      onShowMessage?.('Patient consent is required to store medical records')
      return
    }

    cancelledRef.current = false
    setUploading(true)
    setUploadProgress(5)
    setUploadStatusText('Preparing document...')

    try {
      // 1. Combine images and PDFs into a single A4 PDF with progress updates
      const { pdfBlob, pages, sizeBytes } = await buildMergedPdf(items, (step, total) => {
        if (total > 0) {
          const pct = Math.round((step / total) * 20) + 5 // 5% -> 25%
          setUploadProgress(pct)
        }
      })
      setUploadProgress(25)

      if (cancelledRef.current) return

      // Determine predominant source
      const sourceCounts = items.reduce((acc, it) => {
        acc[it.source] = (acc[it.source] || 0) + 1
        return acc
      }, {})
      let primarySource = 'file'
      let maxCount = 0
      for (const [s, c] of Object.entries(sourceCounts)) {
        if (c > maxCount) {
          primarySource = s
          maxCount = c
        }
      }

      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15)
      const categorySlug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-')

      const metadata = {
        title: title.trim() || `${category} - ${documentDate || new Date().toISOString().slice(0, 10)}`,
        category,
        documentDate: documentDate || '',
        hospital: hospital.trim(),
        note: title.trim(),
        pages,
        sizeBytes,
        source: primarySource,
        uploadedBy: nurseName || '',
        consent: true,
        timestamp,
      }

      // If offline guest or navigator is strictly offline, immediately save locally
      if (isOfflineGuest || !navigator.onLine) {
        await saveRecordLocally(pdfBlob, metadata)
        return
      }

      // Online attempt: Try uploading to Cloud Storage with a safe timeout
      let cloudSucceeded = false
      setUploadStatusText('Uploading to Cloud...')
      setUploadProgress(35)

      let uploadTimer = setInterval(() => {
        setUploadProgress((p) => (p < 80 ? p + 5 : p))
      }, 400)

      try {
        const storagePath = `patients/${patientId}/records/${timestamp}_${categorySlug}.pdf`
        const storageRef = ref(storage, storagePath)

        // Upload using uploadBytes with a 6-second timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cloud upload timed out')), 6000)
        )

        const uploadTask = uploadBytes(storageRef, pdfBlob, {
          contentType: 'application/pdf',
        })
        uploadTaskRef.current = uploadTask

        await Promise.race([uploadTask, timeoutPromise])
        clearInterval(uploadTimer)
        uploadTimer = null

        if (cancelledRef.current) return

        setUploadProgress(85)
        setUploadStatusText('Saving record details...')

        const firestoreTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Firestore save timed out')), 5000)
        )

        const firestoreTask = addDoc(collection(db, 'patients', patientId, 'records'), {
          title: metadata.title,
          category: metadata.category,
          documentDate: metadata.documentDate,
          hospital: metadata.hospital,
          note: metadata.note,
          storagePath,
          pages,
          sizeBytes,
          source: metadata.source,
          uploadedAt: serverTimestamp(),
          uploadedBy: nurseName || '',
          consent: true,
        })

        await Promise.race([firestoreTask, firestoreTimeout])
        cloudSucceeded = true
        setUploadProgress(100)
        onShowMessage?.('Uploaded')
        onClose?.()
      } catch (cloudErr) {
        if (uploadTimer) clearInterval(uploadTimer)
        if (cancelledRef.current) return
        console.warn('Cloud upload unavailable, falling back to offline storage:', cloudErr)
      }

      // If cloud upload timed out, failed, or bucket is unreachable, save offline locally
      if (!cloudSucceeded && !cancelledRef.current) {
        setUploadStatusText('Cloud unavailable, saving offline...')
        await saveRecordLocally(pdfBlob, metadata)
      }
    } catch (err) {
      if (cancelledRef.current || err?.code === 'storage/canceled') return
      onShowMessage?.(err?.message || 'Failed to upload medical records')
    } finally {
      setUploading(false)
      uploadTaskRef.current = null
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[940px] max-h-[570px] flex flex-col overflow-hidden text-[#2d3035]">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="font-['Space_Grotesk'] text-[18px] font-bold text-[#2d3035]">
              Add Medical Records
            </h2>
            <p className="font-mulish text-xs text-slate-500">
              Patient: <span className="font-semibold text-[#2d3035]">{patientName}</span> ({patientId})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mulish text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Exit
          </button>
        </div>

        {/* Tab Selector */}
        <div className="shrink-0 flex border-b border-slate-200 bg-white px-5 gap-3 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`font-['Space_Grotesk'] text-xs font-medium pb-2 border-b-2 transition-colors ${
              activeTab === 'files'
                ? 'border-[#7e42ba] text-[#7e42ba] font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            📁 File / USB Drive
          </button>
          {scanConfig.enabled && (
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className={`font-['Space_Grotesk'] text-xs font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'scanner'
                  ? 'border-[#7e42ba] text-[#7e42ba] font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              🖨 Scanner
            </button>
          )}
        </div>

        {/* Main Body (2 Columns) */}
        <div className="flex-1 min-h-0 flex divide-x divide-slate-200 overflow-hidden">
          {/* Left Column: Source & Page Preview */}
          <div className="w-[58%] flex flex-col p-3.5 overflow-hidden">
            {/* Source controls */}
            {activeTab === 'files' && !showUsbBrowser && (
              <div className="shrink-0 flex items-center gap-2 mb-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="application/pdf,image/jpeg,image/png,image/heic"
                  multiple
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex-1 py-2 px-3 bg-[#ebddfa] hover:bg-[#E0C8FF] text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors"
                >
                  ➕ Choose Local Files (PDF / Image)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUsbBrowser(true)
                    loadUsbFiles()
                  }}
                  disabled={uploading}
                  className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors border border-slate-200"
                >
                  💾 Browse USB Drive
                </button>
              </div>
            )}

            {/* USB Browser view */}
            {activeTab === 'files' && showUsbBrowser && (
              <div className="shrink-0 flex flex-col mb-3 bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-[170px]">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="font-['Space_Grotesk'] text-xs font-semibold text-[#2d3035]">
                    USB Drive Files (/media)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={loadUsbFiles}
                      disabled={loadingUsb}
                      className="text-[11px] text-[#7e42ba] hover:underline"
                    >
                      {loadingUsb ? 'Scanning…' : 'Refresh'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUsbBrowser(false)}
                      className="text-[11px] text-slate-500 hover:text-slate-800"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto py-1 space-y-1">
                  {loadingUsb ? (
                    <div className="text-center py-3 text-xs text-slate-400">Searching USB drive...</div>
                  ) : usbFiles.length === 0 ? (
                    <div className="text-center py-3 text-xs text-slate-400">
                      No PDF/Image files found under /media
                    </div>
                  ) : (
                    usbFiles.map((file) => (
                      <label
                        key={file.path}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white text-xs cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUsbPaths.has(file.path)}
                          onChange={() => toggleUsbSelect(file.path)}
                          className="rounded text-[#7e42ba] focus:ring-[#7e42ba] h-4 w-4"
                        />
                        <span className="truncate flex-1 font-mulish text-slate-700">{file.name}</span>
                        <span className="text-[10px] text-slate-400 uppercase shrink-0">
                          {file.ext} • {(file.sizeBytes / 1024).toFixed(0)} KB
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {usbFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={importSelectedUsbFiles}
                    disabled={selectedUsbPaths.size === 0 || loadingUsb}
                    className="mt-2 py-1.5 px-3 bg-[#ebddfa] hover:bg-[#E0C8FF] text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] font-medium disabled:opacity-50"
                  >
                    Import Selected ({selectedUsbPaths.size})
                  </button>
                )}
              </div>
            )}

            {/* Scanner Tab controls */}
            {activeTab === 'scanner' && (
              <div className="shrink-0 flex items-center gap-2 mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-xs font-mulish text-slate-600 shrink-0 font-medium">Source:</span>
                <select
                  value={scanSource}
                  onChange={(e) => setScanSource(e.target.value)}
                  disabled={scanning || uploading}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-[#2d3035] focus:outline-none focus:ring-1 focus:ring-[#7e42ba]"
                >
                  {(scanConfig.sources || ['Flatbed', 'ADF', 'ADF Duplex']).map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={scanning || uploading}
                  className="flex-1 py-1.5 px-3 bg-[#ebddfa] hover:bg-[#E0C8FF] text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] font-medium disabled:opacity-50 transition-colors"
                >
                  {scanning ? 'Scanning…' : 'Start Scan'}
                </button>
              </div>
            )}

            {/* Preview Thumbnails / Reorder list */}
            <div className="flex-1 min-h-0 flex flex-col bg-slate-50 border border-slate-200 rounded-xl p-2.5">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200 text-xs font-['Space_Grotesk'] text-slate-600">
                <span>Selected Documents ({items.length} item{items.length === 1 ? '' : 's'})</span>
                <span className="text-[11px] text-slate-400">Limit: 30 pages / 25 MB</span>
              </div>

              <div className="flex-1 overflow-y-auto py-2 space-y-1.5 pr-1">
                {items.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400 text-xs font-mulish">
                    <span className="text-2xl mb-1">📄</span>
                    No pages added yet.
                    <span className="text-[11px] text-slate-400 mt-1">
                      Pick PDF/image files from local storage, USB, or scanner above.
                    </span>
                  </div>
                ) : (
                  items.map((it, idx) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-2.5 bg-white p-2 rounded-lg border border-slate-200 shadow-sm"
                    >
                      {/* Thumbnail or PDF icon */}
                      <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden border border-slate-200">
                        {it.previewUrl ? (
                          <img
                            src={it.previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-base">📄</span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-mulish text-xs text-[#2d3035] truncate font-medium">
                          {it.name}
                        </p>
                        <p className="font-mulish text-[10px] text-slate-400 uppercase">
                          {it.type} • source: {it.source}
                        </p>
                      </div>

                      {/* Reorder and Delete controls */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMoveItem(idx, -1)}
                          disabled={idx === 0 || uploading}
                          title="Move Up"
                          className="w-6 h-6 rounded flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-xs disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveItem(idx, 1)}
                          disabled={idx === items.length - 1 || uploading}
                          title="Move Down"
                          className="w-6 h-6 rounded flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-xs disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(idx)}
                          disabled={uploading}
                          title="Remove Page"
                          className="w-6 h-6 rounded flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs disabled:opacity-30"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Metadata Form & Upload */}
          <div className="w-[42%] flex flex-col p-3.5 justify-between overflow-y-auto">
            <div className="space-y-2.5">
              <span className="font-['Space_Grotesk'] text-xs font-semibold text-[#2d3035] block border-b border-slate-100 pb-1">
                Record Metadata
              </span>

              {/* Category */}
              <div>
                <label className="block font-mulish text-[11px] font-semibold text-slate-600 mb-0.5">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={uploading}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-[#2d3035] focus:outline-none focus:ring-1 focus:ring-[#7e42ba]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Document Date */}
              <div>
                <label className="block font-mulish text-[11px] font-semibold text-slate-600 mb-0.5">
                  Document Date (optional)
                </label>
                <input
                  type="date"
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                  disabled={uploading}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-[#2d3035] focus:outline-none focus:ring-1 focus:ring-[#7e42ba]"
                />
              </div>

              {/* Hospital / Doctor */}
              <div>
                <label className="block font-mulish text-[11px] font-semibold text-slate-600 mb-0.5">
                  Hospital / Doctor (optional)
                </label>
                <input
                  type="text"
                  value={hospital}
                  onChange={(e) => setHospital(e.target.value)}
                  placeholder="e.g. City Hospital / Dr. Sharma"
                  disabled={uploading}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7e42ba]"
                />
              </div>

              {/* Title / Note */}
              <div>
                <label className="block font-mulish text-[11px] font-semibold text-slate-600 mb-0.5">
                  Title / Note (optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Blood test lipid profile"
                  disabled={uploading}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-[#2d3035] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7e42ba]"
                />
              </div>

              {/* Consent Checkbox */}
              <div className="pt-2">
                <label className="flex items-start gap-2 bg-[#DCF7DE]/60 p-2.5 rounded-lg border border-[#B9EFBD] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={uploading}
                    className="mt-0.5 rounded text-[#1E6F5C] focus:ring-[#1E6F5C] h-4 w-4 shrink-0"
                  />
                  <span className="font-mulish text-[11px] text-[#1E6F5C] font-semibold leading-tight">
                    Patient consents to storing these records
                  </span>
                </label>
              </div>
            </div>

            {/* Bottom Actions & Upload Progress */}
            <div className="pt-3 border-t border-slate-100">
              {uploading && (
                <div className="mb-2 space-y-1">
                  <div className="flex justify-between text-[11px] font-mulish text-slate-600">
                    <span>{uploadStatusText}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-[#7e42ba] h-2 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                {uploading ? (
                  <button
                    type="button"
                    onClick={handleCancelUpload}
                    className="w-full py-2.5 px-4 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-lg text-xs font-['Space_Grotesk'] font-semibold transition-colors"
                  >
                    Cancel Upload
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-['Space_Grotesk'] font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleUpload}
                      disabled={items.length === 0 || !consent}
                      className="flex-1 py-2.5 px-3 bg-[#ebddfa] hover:bg-[#E0C8FF] text-[#2d3035] rounded-lg text-xs font-['Space_Grotesk'] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isOfflineGuest ? 'Save Offline' : 'Upload Records'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
