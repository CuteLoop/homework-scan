import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'

type ScanPage = {
  id: string
  file: File
  preview: string
  rotation: number
}

type Output = {
  blob: Blob
  url: string
  filename: string
  size: string
}

const MAX_EDGE = 2000
const JPEG_QUALITY = 0.82

function safeFilename(value: string) {
  const clean = value.trim().replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${clean || 'homework'}_${new Date().toISOString().slice(0, 10)}.pdf`
}

function readableSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not read ${file.name}`))
    }
    image.src = url
  })
}

async function prepareJpeg(page: ScanPage) {
  const image = await loadImage(page.file)
  const rotated = page.rotation % 180 !== 0
  const sourceWidth = rotated ? image.naturalHeight : image.naturalWidth
  const sourceHeight = rotated ? image.naturalWidth : image.naturalHeight
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight))
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.translate(width / 2, height / 2)
  context.rotate((page.rotation * Math.PI) / 180)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Image conversion failed'))), 'image/jpeg', JPEG_QUALITY),
  )
  return { bytes: await blob.arrayBuffer(), width, height }
}

export default function App() {
  const [pages, setPages] = useState<ScanPage[]>([])
  const [assignment, setAssignment] = useState('')
  const [output, setOutput] = useState<Output | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    pages.forEach((page) => URL.revokeObjectURL(page.preview))
    if (output) URL.revokeObjectURL(output.url)
  }, [])

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'))
    if (!files.length) return
    setOutput((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
    setError('')
    setPages((current) => [
      ...current,
      ...files.map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), rotation: 0 })),
    ])
    event.target.value = ''
  }

  function rotate(id: string) {
    setPages((current) => current.map((page) => (page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page)))
  }

  function move(index: number, direction: -1 | 1) {
    setPages((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function remove(id: string) {
    setPages((current) => {
      const page = current.find((item) => item.id === id)
      if (page) URL.revokeObjectURL(page.preview)
      return current.filter((item) => item.id !== id)
    })
  }

  async function createPdf() {
    if (!pages.length) return
    setWorking(true)
    setError('')
    try {
      const document = await PDFDocument.create()
      document.setTitle(assignment.trim() || 'Homework scan')
      for (const scan of pages) {
        const prepared = await prepareJpeg(scan)
        const image = await document.embedJpg(prepared.bytes)
        const page = document.addPage([prepared.width, prepared.height])
        page.drawImage(image, { x: 0, y: 0, width: prepared.width, height: prepared.height })
      }
      const bytes = await document.save()
      const pdfBuffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(pdfBuffer).set(bytes)
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setOutput((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { blob, url, filename: safeFilename(assignment), size: readableSize(blob.size) }
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong while creating the PDF.')
    } finally {
      setWorking(false)
    }
  }

  async function sharePdf() {
    if (!output) return
    const file = new File([output.blob], output.filename, { type: 'application/pdf' })
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: output.filename })
      } else {
        const link = document.createElement('a')
        link.href = output.url
        link.download = output.filename
        link.click()
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError('Sharing is not available here. Use Download PDF instead.')
    }
  }

  function reset() {
    pages.forEach((page) => URL.revokeObjectURL(page.preview))
    if (output) URL.revokeObjectURL(output.url)
    setPages([])
    setOutput(null)
    setAssignment('')
    setError('')
  }

  return (
    <main>
      <header className="hero">
        <div className="brand"><span className="brand-mark">HS</span><span>Homework Scan</span></div>
        <div className="privacy"><span /> Private by design</div>
        <h1>Photos in.<br /><em>Homework ready.</em></h1>
        <p>Turn your pages into one clean PDF. Nothing leaves your phone.</p>
      </header>

      <section className="workspace">
        <div className="picker-row">
          <button className="picker primary" onClick={() => cameraRef.current?.click()}>
            <span className="picker-icon">⌁</span>
            <span><strong>Take a photo</strong><small>Use your camera</small></span>
          </button>
          <button className="picker" onClick={() => galleryRef.current?.click()}>
            <span className="picker-icon">▧</span>
            <span><strong>Choose photos</strong><small>Select multiple pages</small></span>
          </button>
          <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={addFiles} />
          <input ref={galleryRef} hidden type="file" accept="image/*" multiple onChange={addFiles} />
        </div>

        {pages.length > 0 ? (
          <>
            <div className="section-heading">
              <div><span className="eyebrow">Your pages</span><h2>{pages.length} {pages.length === 1 ? 'page' : 'pages'} ready</h2></div>
              <button className="text-button" onClick={() => galleryRef.current?.click()}>+ Add pages</button>
            </div>
            <p className="hint">Use the arrows to put your pages in the right order.</p>
            <div className="pages">
              {pages.map((page, index) => (
                <article className="page-card" key={page.id}>
                  <div className="page-number">{index + 1}</div>
                  <img src={page.preview} style={{ transform: `rotate(${page.rotation}deg)` }} alt={`Page ${index + 1}`} />
                  <div className="page-actions">
                    <button aria-label="Move earlier" disabled={index === 0} onClick={() => move(index, -1)}>←</button>
                    <button aria-label="Move later" disabled={index === pages.length - 1} onClick={() => move(index, 1)}>→</button>
                    <button aria-label="Rotate page" onClick={() => rotate(page.id)}>↻</button>
                    <button aria-label="Remove page" onClick={() => remove(page.id)}>×</button>
                  </div>
                </article>
              ))}
            </div>

            <label className="filename">
              <span>Assignment name</span>
              <input value={assignment} onChange={(event) => setAssignment(event.target.value)} placeholder="e.g. CHN101_L2D2" />
              <small>{safeFilename(assignment)}</small>
            </label>
            <button className="create" disabled={working} onClick={createPdf}>
              {working ? <><span className="spinner" /> Creating your PDF…</> : <>Create PDF <span>→</span></>}
            </button>
          </>
        ) : (
          <div className="empty">
            <span className="empty-icon">✓</span>
            <div><strong>Quick, clean, private</strong><p>Your photos are processed entirely on this device.</p></div>
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        {output && (
          <div className="result" role="status">
            <div className="success-mark">✓</div>
            <span className="eyebrow">Ready to submit</span>
            <h2>Your PDF is done</h2>
            <div className="file-pill"><span>PDF</span><div><strong>{output.filename}</strong><small>{output.size} · {pages.length} {pages.length === 1 ? 'page' : 'pages'}</small></div></div>
            <div className="result-actions">
              <a className="download" href={output.url} download={output.filename}>Download PDF</a>
              <button onClick={sharePdf}>Share</button>
            </div>
            <button className="text-button" onClick={reset}>Scan another assignment</button>
          </div>
        )}
      </section>

      <footer><span>Images stay on your device</span><span>•</span><span>Works offline after your first visit</span></footer>
    </main>
  )
}
