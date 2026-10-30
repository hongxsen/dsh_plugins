/**
 * Browser-side preparation of a user-selected wallpaper image.
 *
 * A photo from a phone can be tens of megabytes, which does not fit in
 * localStorage and is wasteful to paint every frame. The selected image is
 * decoded, scaled down, and re-encoded in the browser before it is stored, so
 * the durable preference stays small and the Web UI keeps its startup cost.
 */

/** Quality/size attempts, largest and highest quality first. */
const ENCODE_STEPS = Object.freeze([
  { edge: 2560, quality: 0.86 },
  { edge: 2560, quality: 0.68 },
  { edge: 1920, quality: 0.78 },
  { edge: 1920, quality: 0.62 },
  { edge: 1440, quality: 0.72 },
  { edge: 1280, quality: 0.6 },
])

/**
 * Scale dimensions to fit inside a square edge, never enlarging.
 * @param width - source width.
 * @param height - source height.
 * @param maxEdge - longest allowed side.
 * @returns integer target dimensions.
 */
export function fitWithin(width, height, maxEdge) {
  const sourceWidth = Math.max(1, Number(width) || 1)
  const sourceHeight = Math.max(1, Number(height) || 1)
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

/** Error carrying a stable code the UI translates. */
function coded(code) {
  const error = new Error(`wallpaper image: ${code}`)
  error.code = code
  return error
}

/**
 * Decode a File into a drawable source.
 * @param file - selected image file.
 * @returns the drawable, its intrinsic size, and a release function.
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    let bitmap
    try {
      // Phones store orientation in EXIF; ask the decoder to bake it in.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      try {
        bitmap = await createImageBitmap(file)
      } catch {
        bitmap = undefined
      }
    }
    if (bitmap !== undefined) {
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => { bitmap.close() },
        }
      }
      bitmap.close()
    }
  }
  if (typeof Image === 'undefined') throw coded('decode')
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw coded('decode')
  }
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  return {
    source: image,
    width,
    height,
    release: () => { URL.revokeObjectURL(url) },
  }
}

/**
 * Re-encode a decoded source as the smallest acceptable data URL.
 * @param decoded - output of {@link decodeImage}.
 * @returns accepted data URL plus final dimensions.
 */
function encodeSmallEnough(decoded) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context === null) throw coded('decode')
  for (const step of ENCODE_STEPS) {
    const size = fitWithin(decoded.width, decoded.height, step.edge)
    canvas.width = size.width
    canvas.height = size.height
    context.clearRect(0, 0, size.width, size.height)
    context.drawImage(decoded.source, 0, 0, size.width, size.height)
    let dataUrl
    try {
      dataUrl = canvas.toDataURL('image/webp', step.quality)
    } catch {
      throw coded('decode')
    }
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')
      && dataUrl.length <= MAX_CUSTOM_DATA_URL) {
      return { dataUrl, width: size.width, height: size.height }
    }
  }
  throw coded('large')
}

/**
 * Validate, decode, scale, and encode one picked image.
 * @param file - selected image file.
 * @returns the record stored in the wallpaper preference.
 */
export async function prepareCustomWallpaper(file) {
  const invalid = validateCustomFile(file)
  if (invalid !== null) throw coded(invalid)
  const decoded = await decodeImage(file)
  try {
    const encoded = encodeSmallEnough(decoded)
    const name = typeof file.name === 'string' ? file.name : ''
    return {
      name: name.replace(/\s+/gu, ' ').trim().slice(0, MAX_CUSTOM_NAME),
      dataUrl: encoded.dataUrl,
      width: encoded.width,
      height: encoded.height,
      updatedAt: Date.now(),
    }
  } finally {
    decoded.release()
  }
}
