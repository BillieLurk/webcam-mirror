export const PRODUCT_FILES = [
  'Cover All Mix.png',
  'Defintion Pro Lip Liner - 20 Bloom_1.png',
  'Defintion Pro Lip Liner - 40 Couture_1.png',
  'Defintion Pro Lip Liner- 60 Autumn_1.png',
  'Eye-PencilChocolate-NO-cap.png',
  'Eye-PencilTuxedo-NO-cap.png',
  'Eyeshadow_Sticks_Creamy_Quartz_Tube.png',
  'Eyeshadow_Sticks_Pink_Opal_Tube.png',
  'Eyeshadow_Sticks_Smokey_Crystal_Tube.png',
  'Iconic Glow Bronzer - 02 Terracotta.png',
  'Iconic Glow Bronzer - 04 Ember.png',
  'Iconic Luster Blush - 02 Frosted Pink.png',
  'Iconic Luster Blush - 04 Vintage Rose.png',
  'Iconic Luster Blush 05 - Velvet Plum.png',
  'Iconic Radiance Highlighter - 01 Pearl Glow.png',
  'MUS_brush_07-2000x2000.png',
  'MUS-Hydra_Silk_Setting_Powder-grid-2000x2000.png',
  'Smooth-Silk-UV-Primer-Primary.png',
  'Stay All Day Setting Spray_1.png',
  'Superior Colour Blush Stick Rusty Rose_2.png',
  'Superior Colour Blush Stick Warm Petal_2.png',
  'Superior Sun Bronzer Stick Caramel Touch_2.png',
  'Superior Sun Bronzer Stick Soft Tan_1.png',
  'Tri Brow 2.0.png',
  'Wonder_Powder_Open_Atacama.png',
  'Wonder_Powder_Open_Gobi.png',
  'Wonder_Powder_Open_Kalahari.png',
  'Wonder_Powder_Open_Sahara.png',
]

/**
 * Returns a scale multiplier for a product filename so that each category
 * renders at a consistent size relative to others.
 */
export function getCategoryScale(filename: string): number {
  if (filename.startsWith('Defintion Pro Lip Liner')) return 0.95   // thin lip liners
  if (filename.startsWith('Eye-Pencil'))              return 0.95   // eye pencils
  if (filename.startsWith('Tri Brow'))                return 1.0    // brow pencil
  if (filename.startsWith('Eyeshadow_Sticks'))        return 1.0    // eyeshadow sticks
  if (filename.startsWith('Superior Colour Blush Stick') ||
      filename.startsWith('Superior Sun Bronzer Stick')) return 1.0  // blush/bronzer sticks
  if (filename.startsWith('Smooth-Silk-UV-Primer'))   return 1.0    // primer tube
  if (filename.startsWith('Stay All Day Setting Spray')) return 1.0  // spray bottle
  if (filename.startsWith('MUS_brush_07'))             return 1.05  // brush
  if (filename.startsWith('Iconic Luster Blush') ||
      filename.startsWith('Iconic Glow Bronzer') ||
      filename.startsWith('Iconic Radiance Highlighter')) return 1.1 // compacts
  if (filename.startsWith('Cover All Mix'))            return 1.1   // compact
  if (filename.startsWith('Wonder_Powder_Open'))       return 1.25  // open powder
  if (filename.startsWith('MUS-Hydra_Silk_Setting_Powder')) return 1.3 // large powder
  return 1.0
}

export interface ImageInfo {
  el: HTMLImageElement
  /** Normalized (0–1) tight bounds of the non-transparent content. */
  contentX: number
  contentY: number
  contentW: number
  contentH: number
}

/** Find the tight bounding box of pixels with alpha > threshold. */
function analyzeTightBounds(img: HTMLImageElement): Pick<ImageInfo, 'contentX' | 'contentY' | 'contentW' | 'contentH'> {
  const w = img.naturalWidth
  const h = img.naturalHeight

  // Down-sample large images to keep analysis fast (max 256px on longest side)
  const scale = Math.min(1, 256 / Math.max(w, h))
  const sw = Math.max(1, Math.round(w * scale))
  const sh = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, sw, sh)
  const data = ctx.getImageData(0, 0, sw, sh).data

  let minX = sw, maxX = 0, minY = sh, maxY = 0
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // Fallback: use full image if nothing found
  if (minX > maxX) return { contentX: 0, contentY: 0, contentW: 1, contentH: 1 }

  return {
    contentX: minX / sw,
    contentY: minY / sh,
    contentW: (maxX - minX + 1) / sw,
    contentH: (maxY - minY + 1) / sh,
  }
}

export async function preloadImages(): Promise<Map<string, ImageInfo>> {
  const map = new Map<string, ImageInfo>()
  await Promise.all(
    PRODUCT_FILES.map(
      name =>
        new Promise<void>(resolve => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            const bounds = analyzeTightBounds(img)
            map.set(name, { el: img, ...bounds })
            resolve()
          }
          img.onerror = () => resolve()
          img.src = `/assets/${encodeURIComponent(name)}`
        }),
    ),
  )
  return map
}
