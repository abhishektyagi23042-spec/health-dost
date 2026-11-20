// [records] Scanner service supporting SANE scanimage and mock pages for testing.
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import zlib from 'zlib'

export function getScanConfig() {
  const enabled = process.env.SCAN_ENABLED === '1'
  const mock = process.env.SCAN_MOCK === '1'
  const device = process.env.SCAN_DEVICE || ''

  return {
    enabled,
    mock,
    device: device || null,
    sources: ['Flatbed', 'ADF', 'ADF Duplex'],
  }
}

/**
 * Creates a valid PNG buffer of width x height with a background color and an accent bar.
 * Uses Node's built-in zlib module to produce standard compliant PNGs without dependencies.
 */
function createMockPagePng(pageNumber) {
  const width = 400
  const height = 560

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR Chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type: 2 (Truecolor RGB)
  ihdrData[10] = 0 // compression method
  ihdrData[11] = 0 // filter method
  ihdrData[12] = 0 // interlace method

  function createChunk(type, data) {
    const len = data.length
    const buf = Buffer.alloc(4 + 4 + len + 4)
    buf.writeUInt32BE(len, 0)
    buf.write(type, 4, 4, 'ascii')
    data.copy(buf, 8)
    // CRC32 calculation
    const crc = crc32(buf.subarray(4, 8 + len))
    buf.writeInt32BE(crc, 8 + len)
    return buf
  }

  // Pre-computed CRC table
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1)
      else c = c >>> 1
    }
    crcTable[n] = c
  }

  function crc32(buf) {
    let crc = 0xffffffff
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) | 0
  }

  const ihdrChunk = createChunk('IHDR', ihdrData)

  // Raw image data: filter byte (0) + 3 bytes (RGB) per pixel per row
  const rawData = Buffer.alloc(height * (1 + width * 3))
  let offset = 0

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0 // Filter type: None
    for (let x = 0; x < width; x++) {
      if (y < 50) {
        // Header bar: HealthDost purple or green
        if (pageNumber === 1) {
          rawData[offset++] = 49 // R (HealthDost blue/purple)
          rawData[offset++] = 68 // G
          rawData[offset++] = 144 // B
        } else {
          rawData[offset++] = 30 // R (HealthDost green)
          rawData[offset++] = 111 // G
          rawData[offset++] = 92 // B
        }
      } else if (y >= 70 && y <= 75 && x >= 30 && x <= 250) {
        // Accent rule
        rawData[offset++] = 200
        rawData[offset++] = 200
        rawData[offset++] = 200
      } else if (y >= 100 && y <= 104 && x >= 30 && x <= 350) {
        // Mock text line
        rawData[offset++] = 180
        rawData[offset++] = 180
        rawData[offset++] = 180
      } else if (y >= 120 && y <= 124 && x >= 30 && x <= 300) {
        // Mock text line
        rawData[offset++] = 180
        rawData[offset++] = 180
        rawData[offset++] = 180
      } else {
        // White paper background
        rawData[offset++] = 250
        rawData[offset++] = 250
        rawData[offset++] = 250
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData)
  const idatChunk = createChunk('IDAT', compressedData)
  const iendChunk = createChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk])
}

/**
 * Execute scanner via scanimage or produce mock scan pages.
 */
export async function executeScan({ source = 'Flatbed' } = {}) {
  const scanEnabled = process.env.SCAN_ENABLED === '1'
  const scanMock = process.env.SCAN_MOCK === '1'
  const scanDevice = process.env.SCAN_DEVICE || ''

  if (!scanEnabled) {
    throw new Error('Scanner feature is disabled (SCAN_ENABLED is not set to 1)')
  }

  if (scanMock) {
    // Generate 2 test pages
    const page1 = createMockPagePng(1)
    const page2 = createMockPagePng(2)
    return [
      {
        pageIndex: 0,
        mimeType: 'image/png',
        base64: page1.toString('base64'),
        sizeBytes: page1.length,
      },
      {
        pageIndex: 1,
        mimeType: 'image/png',
        base64: page2.toString('base64'),
        sizeBytes: page2.length,
      },
    ]
  }

  // Real SANE scanimage execution
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'healthdost_scan_'))
  try {
    const isMultiPage = source === 'ADF' || source === 'ADF Duplex'
    const outputPattern = isMultiPage
      ? path.join(tmpDir, 'page_%04d.jpg')
      : path.join(tmpDir, 'page.jpg')

    const args = ['--format=jpeg', '--source', source]
    if (scanDevice) {
      args.push('--device-name', scanDevice)
    }

    if (isMultiPage) {
      args.push(`--batch=${outputPattern}`)
    } else {
      args.push('--output-file', outputPattern)
    }

    await new Promise((resolve, reject) => {
      const child = spawn('scanimage', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stderr = ''
      child.stderr.on('data', (d) => {
        stderr += String(d)
      })

      child.on('error', (err) => {
        reject(new Error(`Failed to start scanimage: ${err.message}`))
      })

      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`scanimage exited with code ${code}: ${stderr.trim()}`))
      })
    })

    const files = await fs.readdir(tmpDir)
    const imageFiles = files
      .filter((f) => f.endsWith('.jpg') || f.endsWith('.jpeg'))
      .sort()

    if (imageFiles.length === 0) {
      throw new Error('Scanner produced no image files')
    }

    const pages = []
    for (let i = 0; i < imageFiles.length; i++) {
      const imgPath = path.join(tmpDir, imageFiles[i])
      const buf = await fs.readFile(imgPath)
      pages.push({
        pageIndex: i,
        mimeType: 'image/jpeg',
        base64: buf.toString('base64'),
        sizeBytes: buf.length,
      })
    }

    return pages
  } finally {
    // Clean up temporary files
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
