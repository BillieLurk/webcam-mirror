export const PRODUCT_FILES = [
  'Blending Sponge  N°1.png',
  'Classic Coordinator_Beige Maxi Toiletry bag_1.png',
  'Classic Coordinator_Black Maxi Toiletry bag_1.png',
  'Cover All Mix.png',
  'Defintion Pro Lip Liner - 20 Bloom_1.png',
  'Defintion Pro Lip Liner - 40 Couture_1.png',
  'Defintion Pro Lip Liner- 60 Autumn_1.png',
  'Draw Master Dip Liner.png',
  'Effortless Expert Curl Mascara.png',
  'Eye-PencilBallet-NO-cap.png',
  'Eye-PencilChocolate-NO-cap.png',
  'Eye-PencilMerlot-NO-cap.png',
  'Eye-PencilTuxedo-NO-cap.png',
  'Eyeshadow_Sticks_Amber_Tube.png',
  'Eyeshadow_Sticks_Creamy_Quartz_Tube.png',
  'Eyeshadow_Sticks_Pink_Opal_Tube.png',
  'Eyeshadow_Sticks_Ruby_Tube.png',
  'Eyeshadow_Sticks_Smokey_Crystal_Tube.png',
  'Glassy Beauty Case_Burgundy Transparent Toiletry Bag.png',
  'Iconic Glow Bronzer - 01 Maple.png',
  'Iconic Glow Bronzer - 02 Terracotta.png',
  'Iconic Glow Bronzer - 03 Dune.png',
  'Iconic Glow Bronzer - 04 Ember.png',
  'Iconic Luster Blush - 01 Soft Peach.png',
  'Iconic Luster Blush - 02 Frosted Pink.png',
  'Iconic Luster Blush - 04 Vintage Rose.png',
  'Iconic Luster Blush 05 - Velvet Plum.png',
  'Iconic Radiance Highlighter - 01 Pearl Glow.png',
  'Lip Plumper Berry.png',
  'MUS-Hydra_Silk_Setting_Powder-grid-2000x2000.png',
  'MUS_brush_01-2000x2000.png',
  'MUS_brush_02-2000x2000.png',
  'MUS_brush_04-2000x2000.png',
  'MUS_brush_05-2000x2000.png',
  'MUS_brush_07-2000x2000.png',
  'MUS_brush_10-2000x2000.png',
  'MUS_brush_11-2000x2000.png',
  'Multi Lash 2.0 Mascara.png',
  'Powder puff.png',
  'Smooth-Silk-UV-Primer-Primary.png',
  'Stay All Day Setting Spray_1.png',
  'Superior Colour Blush Stick Cool Pink_2.png',
  'Superior Colour Blush Stick Rusty Rose_2.png',
  'Superior Colour Blush Stick Soft Coral_2.png',
  'Superior Colour Blush Stick Warm Petal_2.png',
  'Superior Sun Bronzer Stick Caramel Touch_2.png',
  'Superior Sun Bronzer Stick Midnight Bronze_2.png',
  'Superior Sun Bronzer Stick Soft Tan_1.png',
  'Tri Brow 2.0.png',
  'Wonder_Powder_Open_Atacama.png',
  'Wonder_Powder_Open_Gobi.png',
  'Wonder_Powder_Open_Kalahari.png',
  'Wonder_Powder_Open_Sahara.png',
]

/** Mutable scale multipliers per category — edit via the in-app slider panel. */
export const SCALE_CONFIG: Record<string, number> = {
  'Lip Liners':             0.95,
  'Eye Pencils':            0.95,
  'Mascaras':               1.0,
  'Brow':                   1.0,
  'Eyeshadow Sticks':       1.0,
  'Blush & Bronzer Sticks': 1.0,
  'Primer':                 1.0,
  'Spray':                  1.0,
  'Brushes':                1.05,
  'Compacts':               1.1,
  'Sponge & Puff':          1.1,
  'Open Powders':           1.25,
  'Large Powder':           1.3,
  'Bags & Cases':           1.4,
}

/** Returns a scale multiplier for a product filename based on SCALE_CONFIG. */
export function getCategoryScale(filename: string): number {
  if (filename.startsWith('Defintion Pro Lip Liner') ||
      filename.startsWith('Draw Master Dip Liner') ||
      filename.startsWith('Lip Plumper'))             return SCALE_CONFIG['Lip Liners']
  if (filename.startsWith('Eye-Pencil'))              return SCALE_CONFIG['Eye Pencils']
  if (filename.startsWith('Effortless Expert Curl Mascara') ||
      filename.startsWith('Multi Lash 2.0 Mascara'))  return SCALE_CONFIG['Mascaras']
  if (filename.startsWith('Tri Brow'))                return SCALE_CONFIG['Brow']
  if (filename.startsWith('Eyeshadow_Sticks'))        return SCALE_CONFIG['Eyeshadow Sticks']
  if (filename.startsWith('Superior Colour Blush Stick') ||
      filename.startsWith('Superior Sun Bronzer Stick')) return SCALE_CONFIG['Blush & Bronzer Sticks']
  if (filename.startsWith('Smooth-Silk-UV-Primer'))   return SCALE_CONFIG['Primer']
  if (filename.startsWith('Stay All Day Setting Spray')) return SCALE_CONFIG['Spray']
  if (filename.startsWith('MUS_brush'))               return SCALE_CONFIG['Brushes']
  if (filename.startsWith('Iconic Luster Blush') ||
      filename.startsWith('Iconic Glow Bronzer') ||
      filename.startsWith('Iconic Radiance Highlighter') ||
      filename.startsWith('Cover All Mix'))            return SCALE_CONFIG['Compacts']
  if (filename.startsWith('Blending Sponge') ||
      filename.startsWith('Powder puff'))              return SCALE_CONFIG['Sponge & Puff']
  if (filename.startsWith('Wonder_Powder_Open'))       return SCALE_CONFIG['Open Powders']
  if (filename.startsWith('MUS-Hydra_Silk_Setting_Powder')) return SCALE_CONFIG['Large Powder']
  if (filename.startsWith('Classic Coordinator') ||
      filename.startsWith('Glassy Beauty Case'))       return SCALE_CONFIG['Bags & Cases']
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
