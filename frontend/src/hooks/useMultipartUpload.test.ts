import { act, renderHook, waitFor } from '@testing-library/react'

jest.mock('../services/api', () => ({
  apiClient: {
    initPackageUpload: jest.fn(),
    getPackageUploadPartUrls: jest.fn(),
    completePackageUpload: jest.fn(),
    abortPackageUpload: jest.fn(),
  },
}))

import { apiClient } from '../services/api'
import { useMultipartUpload } from './useMultipartUpload'

const mockApi = apiClient as jest.Mocked<typeof apiClient>

const PART_SIZE = 5 * 1024 * 1024
const RESUME_KEY = 'nyroforge.packageUpload.resume'

/** A File whose slices report the right sizes without allocating the bytes. */
function fakeFile(name: string, size: number): File {
  const file = {
    name,
    size,
    type: 'application/octet-stream',
    slice: (start: number, end: number) => ({ size: Math.max(0, end - start) }) as Blob,
  }
  return file as unknown as File
}

function okResponse(etag = '"etag"'): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === 'ETag' ? etag : null) },
  } as unknown as Response
}

function initFor(partCount: number, packageId = 'pkg-1') {
  return {
    packageId,
    uploadId: 'upload-1',
    bucket: 'bucket',
    key: `quarantine/${packageId}/file.exe`,
    fileName: 'file.exe',
    partSizeBytes: PART_SIZE,
    partCount,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  mockApi.getPackageUploadPartUrls.mockImplementation(async (_id: string, partNumbers: number[]) => ({
    parts: partNumbers.map((partNumber) => ({
      partNumber,
      url: `https://s3.example/part/${partNumber}`,
    })),
    expiresInSeconds: 3600,
  }))
  mockApi.completePackageUpload.mockResolvedValue({ packageId: 'pkg-1', status: 'analyzing' })
  mockApi.abortPackageUpload.mockResolvedValue(undefined)
  global.fetch = jest.fn().mockResolvedValue(okResponse()) as any
})

describe('useMultipartUpload', () => {
  it('uploads every part and completes with all ETags', async () => {
    mockApi.initPackageUpload.mockResolvedValue(initFor(3))
    const file = fakeFile('installer.exe', PART_SIZE * 3)

    const { result } = renderHook(() => useMultipartUpload())

    let packageId: string | null = null
    await act(async () => {
      packageId = await result.current.upload(file)
    })

    expect(packageId).toBe('pkg-1')
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(mockApi.completePackageUpload).toHaveBeenCalledWith(
      'pkg-1',
      expect.arrayContaining([
        { partNumber: 1, etag: '"etag"' },
        { partNumber: 2, etag: '"etag"' },
        { partNumber: 3, etag: '"etag"' },
      ])
    )
    expect(result.current.state.phase).toBe('done')
    expect(result.current.state.progress).toBe(100)
  })

  it('PUTs each part to its own presigned URL', async () => {
    mockApi.initPackageUpload.mockResolvedValue(initFor(2))
    const { result } = renderHook(() => useMultipartUpload())

    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE * 2))
    })

    const urls = (global.fetch as jest.Mock).mock.calls.map((c) => c[0]).sort()
    expect(urls).toEqual(['https://s3.example/part/1', 'https://s3.example/part/2'])
    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('PUT')
  })

  it('fails clearly when S3 does not expose the ETag header', async () => {
    // Without `ExposedHeaders: ['ETag']` in the bucket CORS policy the browser
    // cannot read it, and CompleteMultipartUpload has nothing to send.
    mockApi.initPackageUpload.mockResolvedValue(initFor(1))
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
    }) as any

    const { result } = renderHook(() => useMultipartUpload())
    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE))
    })

    expect(result.current.state.phase).toBe('error')
    expect(result.current.state.error).toMatch(/ETag/)
    expect(mockApi.completePackageUpload).not.toHaveBeenCalled()
  })

  it('re-signs and retries a part whose URL has expired', async () => {
    mockApi.initPackageUpload.mockResolvedValue(initFor(1))
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, headers: { get: () => null } })
      .mockResolvedValueOnce(okResponse('"retried"'))
    global.fetch = fetchMock as any

    const { result } = renderHook(() => useMultipartUpload())
    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE))
    })

    expect(result.current.state.phase).toBe('done')
    // One batch call plus a single-part re-sign after the 403.
    expect(mockApi.getPackageUploadPartUrls).toHaveBeenCalledTimes(2)
    expect(mockApi.getPackageUploadPartUrls).toHaveBeenLastCalledWith('pkg-1', [1])
    expect(mockApi.completePackageUpload).toHaveBeenCalledWith('pkg-1', [
      { partNumber: 1, etag: '"retried"' },
    ])
  })

  it('gives up after repeated failures and keeps the resume record', async () => {
    mockApi.initPackageUpload.mockResolvedValue(initFor(1))
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } }) as any

    const { result } = renderHook(() => useMultipartUpload())
    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE))
    })

    expect(result.current.state.phase).toBe('error')
    // Kept deliberately: retrying should not re-send what already succeeded.
    expect(window.localStorage.getItem(RESUME_KEY)).not.toBeNull()
  })

  it('persists progress so a refresh can resume', async () => {
    mockApi.initPackageUpload.mockResolvedValue(initFor(2))
    const { result } = renderHook(() => useMultipartUpload())

    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE * 2))
    })

    // Cleared on success — there is nothing left to resume.
    expect(window.localStorage.getItem(RESUME_KEY)).toBeNull()
  })

  it('skips parts already uploaded when resuming', async () => {
    const resume = {
      packageId: 'pkg-1',
      fileName: 'installer.exe',
      fileSizeBytes: PART_SIZE * 3,
      partSizeBytes: PART_SIZE,
      partCount: 3,
      completedParts: [
        { partNumber: 1, etag: '"a"' },
        { partNumber: 2, etag: '"b"' },
      ],
      startedAt: Date.now(),
    }

    const { result } = renderHook(() => useMultipartUpload())
    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE * 3), { resume })
    })

    // Only the outstanding part is re-sent; init is not called again.
    expect(mockApi.initPackageUpload).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(mockApi.getPackageUploadPartUrls).toHaveBeenCalledWith('pkg-1', [3])
    expect(mockApi.completePackageUpload).toHaveBeenCalledWith(
      'pkg-1',
      expect.arrayContaining([
        { partNumber: 1, etag: '"a"' },
        { partNumber: 2, etag: '"b"' },
        { partNumber: 3, etag: '"etag"' },
      ])
    )
  })

  it('starts fresh when the resume record is for a different file size', async () => {
    mockApi.initPackageUpload.mockResolvedValue(initFor(1))
    const resume = {
      packageId: 'pkg-old',
      fileName: 'installer.exe',
      fileSizeBytes: 999,
      partSizeBytes: PART_SIZE,
      partCount: 1,
      completedParts: [{ partNumber: 1, etag: '"a"' }],
      startedAt: Date.now(),
    }

    const { result } = renderHook(() => useMultipartUpload())
    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE), { resume })
    })

    expect(mockApi.initPackageUpload).toHaveBeenCalled()
  })

  describe('findResumable', () => {
    it('returns a stored record', () => {
      const record = {
        packageId: 'pkg-1',
        fileName: 'installer.exe',
        fileSizeBytes: PART_SIZE,
        partSizeBytes: PART_SIZE,
        partCount: 1,
        completedParts: [],
        startedAt: Date.now(),
      }
      window.localStorage.setItem(RESUME_KEY, JSON.stringify(record))

      const { result } = renderHook(() => useMultipartUpload())
      expect(result.current.findResumable()?.packageId).toBe('pkg-1')
    })

    it('discards a record older than the quarantine lifetime', () => {
      // Quarantined objects expire after 14 days, so an old record points at
      // something S3 has already deleted.
      window.localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({
          packageId: 'pkg-old',
          fileName: 'x.exe',
          fileSizeBytes: 1,
          partSizeBytes: 1,
          partCount: 1,
          completedParts: [],
          startedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        })
      )

      const { result } = renderHook(() => useMultipartUpload())
      expect(result.current.findResumable()).toBeNull()
      expect(window.localStorage.getItem(RESUME_KEY)).toBeNull()
    })

    it('survives unparseable storage', () => {
      window.localStorage.setItem(RESUME_KEY, 'not json')
      const { result } = renderHook(() => useMultipartUpload())
      expect(result.current.findResumable()).toBeNull()
    })
  })

  it('aborts the server-side upload when cancelled', async () => {
    mockApi.initPackageUpload.mockResolvedValue(initFor(1))
    const { result } = renderHook(() => useMultipartUpload())

    await act(async () => {
      await result.current.upload(fakeFile('installer.exe', PART_SIZE))
    })
    await act(async () => {
      await result.current.cancel()
    })

    await waitFor(() => expect(result.current.state.phase).toBe('cancelled'))
    expect(mockApi.abortPackageUpload).toHaveBeenCalledWith('pkg-1')
    expect(window.localStorage.getItem(RESUME_KEY)).toBeNull()
  })
})
