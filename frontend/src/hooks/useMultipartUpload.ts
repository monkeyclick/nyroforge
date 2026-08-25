import { useCallback, useRef, useState } from 'react'
import { apiClient } from '../services/api'

/**
 * Browser-side multipart upload to S3.
 *
 * Parts go directly to S3 with presigned URLs — API Gateway caps request
 * bodies at 10 MB, so an installer can never travel through the API. Progress,
 * per-part retry and resume-after-refresh all live here; the wizard component
 * only renders what this reports.
 */

/** Parts uploaded at once. Enough to saturate a link without stalling retries. */
const CONCURRENCY = 4
/** Presigned URLs are requested in batches so none expires while queued. */
const URL_BATCH_SIZE = 25
const MAX_PART_ATTEMPTS = 4
const RESUME_STORAGE_KEY = 'nyroforge.packageUpload.resume'

export type UploadPhase = 'idle' | 'preparing' | 'uploading' | 'finalizing' | 'done' | 'error' | 'cancelled'

export interface UploadState {
  phase: UploadPhase
  packageId?: string
  fileName?: string
  /** 0–100 across all parts. */
  progress: number
  uploadedBytes: number
  totalBytes: number
  partsCompleted: number
  partCount: number
  bytesPerSecond: number
  error?: string
}

interface ResumeRecord {
  packageId: string
  fileName: string
  fileSizeBytes: number
  partSizeBytes: number
  partCount: number
  completedParts: Array<{ partNumber: number; etag: string }>
  startedAt: number
}

const INITIAL: UploadState = {
  phase: 'idle',
  progress: 0,
  uploadedBytes: 0,
  totalBytes: 0,
  partsCompleted: 0,
  partCount: 0,
  bytesPerSecond: 0,
}

function readResume(): ResumeRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(RESUME_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ResumeRecord
    // A stale record points at a package the server may have already swept up
    // under the 14-day quarantine lifecycle rule.
    if (Date.now() - parsed.startedAt > 7 * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(RESUME_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeResume(record: ResumeRecord | null): void {
  if (typeof window === 'undefined') return
  try {
    if (record) {
      window.localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(record))
    } else {
      window.localStorage.removeItem(RESUME_STORAGE_KEY)
    }
  } catch {
    // Private browsing or a full quota: resume is a convenience, not a
    // requirement, so a failure here must not break the upload.
  }
}

/** Upload one part, retrying with backoff and re-signing on an expired URL. */
async function uploadPart(
  packageId: string,
  partNumber: number,
  blob: Blob,
  url: string,
  signal: AbortSignal,
  onBytes: (delta: number) => void
): Promise<string> {
  let currentUrl = url

  for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(currentUrl, { method: 'PUT', body: blob, signal })

      if (response.status === 403 && attempt < MAX_PART_ATTEMPTS) {
        // Presigned URLs are signed with the Lambda role's short-lived
        // credentials; a long upload can outlive them.
        const refreshed = await apiClient.getPackageUploadPartUrls(packageId, [partNumber])
        currentUrl = refreshed.parts[0].url
        continue
      }

      if (!response.ok) {
        throw new Error(`Part ${partNumber} failed with HTTP ${response.status}`)
      }

      // CompleteMultipartUpload needs every part's ETag, which is only
      // readable because the bucket CORS config exposes that header.
      const etag = response.headers.get('ETag')
      if (!etag) {
        throw new Error(
          `Part ${partNumber} returned no ETag. The bucket CORS policy must expose the ETag header.`
        )
      }

      onBytes(blob.size)
      return etag
    } catch (error) {
      if (signal.aborted) throw error
      if (attempt === MAX_PART_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
    }
  }

  throw new Error(`Part ${partNumber} could not be uploaded`)
}

export function useMultipartUpload() {
  const [state, setState] = useState<UploadState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const resumableRef = useRef<ResumeRecord | null>(null)

  const reset = useCallback(() => {
    abortRef.current = null
    setState(INITIAL)
  }, [])

  /** A previous session's interrupted upload, if there is one. */
  const findResumable = useCallback((): ResumeRecord | null => {
    const record = readResume()
    resumableRef.current = record
    return record
  }, [])

  const discardResumable = useCallback(() => {
    writeResume(null)
    resumableRef.current = null
  }, [])

  const cancel = useCallback(async () => {
    abortRef.current?.abort()
    const packageId = state.packageId
    if (packageId) {
      await apiClient.abortPackageUpload(packageId).catch(() => undefined)
    }
    writeResume(null)
    setState((prev) => ({ ...prev, phase: 'cancelled' }))
  }, [state.packageId])

  /**
   * Upload a file. When `resume` is supplied the already-completed parts are
   * skipped, so a refresh mid-transfer does not restart a 4 GB upload.
   */
  const upload = useCallback(
    async (
      file: File,
      options: { name?: string; description?: string; resume?: ResumeRecord } = {}
    ): Promise<string | null> => {
      const controller = new AbortController()
      abortRef.current = controller

      const startedAt = Date.now()
      let uploadedBytes = 0

      const bumpBytes = (delta: number): void => {
        uploadedBytes += delta
        const elapsed = (Date.now() - startedAt) / 1000
        setState((prev) => ({
          ...prev,
          uploadedBytes,
          progress: prev.totalBytes ? Math.min(99, (uploadedBytes / prev.totalBytes) * 100) : 0,
          bytesPerSecond: elapsed > 0 ? uploadedBytes / elapsed : 0,
        }))
      }

      try {
        setState({ ...INITIAL, phase: 'preparing', fileName: file.name, totalBytes: file.size })

        let session: ResumeRecord
        if (options.resume && options.resume.fileSizeBytes === file.size) {
          session = options.resume
        } else {
          const init = await apiClient.initPackageUpload({
            fileName: file.name,
            fileSizeBytes: file.size,
            contentType: file.type || 'application/octet-stream',
            name: options.name,
            description: options.description,
          })
          session = {
            packageId: init.packageId,
            fileName: init.fileName,
            fileSizeBytes: file.size,
            partSizeBytes: init.partSizeBytes,
            partCount: init.partCount,
            completedParts: [],
            startedAt: Date.now(),
          }
        }

        writeResume(session)

        const completed = new Map(session.completedParts.map((p) => [p.partNumber, p.etag]))
        uploadedBytes = completed.size * session.partSizeBytes

        setState({
          phase: 'uploading',
          packageId: session.packageId,
          fileName: session.fileName,
          progress: session.partCount ? (completed.size / session.partCount) * 100 : 0,
          uploadedBytes,
          totalBytes: file.size,
          partsCompleted: completed.size,
          partCount: session.partCount,
          bytesPerSecond: 0,
        })

        const pending: number[] = []
        for (let partNumber = 1; partNumber <= session.partCount; partNumber++) {
          if (!completed.has(partNumber)) pending.push(partNumber)
        }

        // Sign in batches so a URL cannot expire while sitting in the queue.
        for (let offset = 0; offset < pending.length; offset += URL_BATCH_SIZE) {
          if (controller.signal.aborted) throw new Error('Upload cancelled')

          const batch = pending.slice(offset, offset + URL_BATCH_SIZE)
          const signed = await apiClient.getPackageUploadPartUrls(session.packageId, batch)
          const urlByPart = new Map(signed.parts.map((p) => [p.partNumber, p.url]))

          let cursor = 0
          const worker = async (): Promise<void> => {
            while (cursor < batch.length) {
              if (controller.signal.aborted) return
              const partNumber = batch[cursor++]
              const start = (partNumber - 1) * session.partSizeBytes
              const blob = file.slice(start, Math.min(start + session.partSizeBytes, file.size))
              const url = urlByPart.get(partNumber)
              if (!url) throw new Error(`No signed URL for part ${partNumber}`)

              const etag = await uploadPart(
                session.packageId,
                partNumber,
                blob,
                url,
                controller.signal,
                bumpBytes
              )
              completed.set(partNumber, etag)

              // Persist after each part so a refresh resumes near where it left off.
              writeResume({
                ...session,
                completedParts: Array.from(completed, ([partNumber2, etag2]) => ({
                  partNumber: partNumber2,
                  etag: etag2,
                })),
              })

              setState((prev) => ({ ...prev, partsCompleted: completed.size }))
            }
          }

          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker())
          )
        }

        if (controller.signal.aborted) throw new Error('Upload cancelled')

        setState((prev) => ({ ...prev, phase: 'finalizing', progress: 99 }))

        await apiClient.completePackageUpload(
          session.packageId,
          Array.from(completed, ([partNumber, etag]) => ({ partNumber, etag }))
        )

        writeResume(null)
        setState((prev) => ({ ...prev, phase: 'done', progress: 100, uploadedBytes: file.size }))
        return session.packageId
      } catch (error) {
        if (controller.signal.aborted) {
          setState((prev) => ({ ...prev, phase: 'cancelled' }))
          return null
        }
        setState((prev) => ({
          ...prev,
          phase: 'error',
          // The resume record is deliberately kept so the user can retry
          // without re-sending everything already transferred.
          error: error instanceof Error ? error.message : 'Upload failed',
        }))
        return null
      }
    },
    []
  )

  return { state, upload, cancel, reset, findResumable, discardResumable }
}

export type { ResumeRecord }
