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

export interface ProductInfo { name: string; description: string; howToUse?: string }

export const PRODUCT_INFO: Record<string, ProductInfo> = {
  'Blending Sponge  N°1.png':                              { name: 'Blending Sponge', description: 'Evens out makeup for a natural finish. Dampen for radiance or use dry for coverage.', howToUse: 'Dampen for a radiant look or use dry for more coverage.' },
  'Classic Coordinator_Beige Maxi Toiletry bag_1.png':     { name: 'Classic Coordinator Maxi — Beige', description: 'Vegan leather beauty organiser with removable dividers and a lid pocket.' },
  'Classic Coordinator_Black Maxi Toiletry bag_1.png':     { name: 'Classic Coordinator Maxi — Black', description: 'Vegan leather beauty organiser with removable dividers and a lid pocket.' },
  'Cover All Mix.png':                                     { name: 'Cover All Mix', description: 'Highly pigmented concealer palette. Mix shades to neutralise and brighten.', howToUse: 'Use shades individually or blend to adjust finish to your skin tone.' },
  'Defintion Pro Lip Liner - 20 Bloom_1.png':              { name: 'Lip Liner Definition Pro — Bloom', description: 'Creamy, smudge-proof liner. Twist-up sharpener built in. Enriched with antioxidants.', howToUse: 'Built-in sharpener keeps tip precise — never needs separate sharpening.' },
  'Defintion Pro Lip Liner - 40 Couture_1.png':            { name: 'Lip Liner Definition Pro — Couture', description: 'Dark pink-brown-mauve. Adds depth and character to the lips.', howToUse: 'Built-in sharpener keeps tip precise — never needs separate sharpening.' },
  'Defintion Pro Lip Liner- 60 Autumn_1.png':              { name: 'Lip Liner Definition Pro — Autumn', description: 'Medium dark brown with hints of mauve. Warm and striking definition.', howToUse: 'Built-in sharpener keeps tip precise — never needs separate sharpening.' },
  'Draw Master Dip Liner.png':                             { name: 'Draw Master Dip Liner', description: 'Waterproof, quick-dry formula. Ultrafine to dramatic lines, all-day smudge-proof.', howToUse: 'Shake well and apply from inner corner; layer for a more dramatic look.' },
  'Effortless Expert Curl Mascara.png':                    { name: 'Effortless Expert Curl Mascara', description: 'Curls, lifts and volumises. Ultra-light vegan formula, water resistant all day.' },
  'Eye-PencilBallet-NO-cap.png':                           { name: 'Eternal Pro Eye Pencil — Ballet', description: 'Soft, smudge-proof eyeliner. Defined lines in a single stroke. Up to 32 hrs wear.', howToUse: 'Apply along inner or outer lash line; works as eyeliner or kohl.' },
  'Eye-PencilChocolate-NO-cap.png':                        { name: 'Eternal Pro Eye Pencil — Chocolate', description: 'Soft, smudge-proof eyeliner. Defined lines in a single stroke. Up to 32 hrs wear.', howToUse: 'Apply along inner or outer lash line; works as eyeliner or kohl.' },
  'Eye-PencilMerlot-NO-cap.png':                           { name: 'Eternal Pro Eye Pencil — Merlot', description: 'Soft, smudge-proof eyeliner. Defined lines in a single stroke. Up to 32 hrs wear.', howToUse: 'Apply along inner or outer lash line; works as eyeliner or kohl.' },
  'Eye-PencilTuxedo-NO-cap.png':                           { name: 'Eternal Pro Eye Pencil — Tuxedo', description: 'Soft, smudge-proof eyeliner. Defined lines in a single stroke. Up to 32 hrs wear.', howToUse: 'Apply along inner or outer lash line; works as eyeliner or kohl.' },
  'Eyeshadow_Sticks_Amber_Tube.png':                       { name: 'Longwear Luxe Eyeshadow Stick — Amber', description: 'Creamy shimmer stick. Intense colour, up to 12 hrs wear, water & sweat resistant.', howToUse: 'Apply with fingertips or a blending/buffer eyeshadow brush.' },
  'Eyeshadow_Sticks_Creamy_Quartz_Tube.png':               { name: 'Longwear Luxe Eyeshadow Stick — Creamy Quartz', description: 'Creamy shimmer stick. Intense colour, up to 12 hrs wear, water & sweat resistant.', howToUse: 'Apply with fingertips or a blending/buffer eyeshadow brush.' },
  'Eyeshadow_Sticks_Pink_Opal_Tube.png':                   { name: 'Longwear Luxe Eyeshadow Stick — Pink Opal', description: 'Creamy shimmer stick. Intense colour, up to 12 hrs wear, water & sweat resistant.', howToUse: 'Apply with fingertips or a blending/buffer eyeshadow brush.' },
  'Eyeshadow_Sticks_Ruby_Tube.png':                        { name: 'Longwear Luxe Eyeshadow Stick — Ruby', description: 'Creamy shimmer stick. Intense colour, up to 12 hrs wear, water & sweat resistant.', howToUse: 'Apply with fingertips or a blending/buffer eyeshadow brush.' },
  'Eyeshadow_Sticks_Smokey_Crystal_Tube.png':              { name: 'Longwear Luxe Eyeshadow Stick — Smokey Crystal', description: 'Creamy shimmer stick. Intense colour, up to 12 hrs wear, water & sweat resistant.', howToUse: 'Apply with fingertips or a blending/buffer eyeshadow brush.' },
  'Glassy Beauty Case_Burgundy Transparent Toiletry Bag.png': { name: 'Glassy Beauty Case — Burgundy', description: 'Transparent oval bag in vegan leather. Elegant and functional on-the-go organiser.' },
  'Iconic Glow Bronzer - 01 Maple.png':                    { name: 'Iconic Glow Bronzer — Maple', description: 'Hybrid powder-cream formula. Melts into skin for a warm, buildable sun-kissed glow.', howToUse: 'Use the Large Pointed Powder Brush for precise application.' },
  'Iconic Glow Bronzer - 02 Terracotta.png':               { name: 'Iconic Glow Bronzer — Terracotta', description: 'Hybrid powder-cream formula. Melts into skin for a warm, buildable sun-kissed glow.', howToUse: 'Use the Large Pointed Powder Brush for precise application.' },
  'Iconic Glow Bronzer - 03 Dune.png':                     { name: 'Iconic Glow Bronzer — Dune', description: 'Hybrid powder-cream formula. Melts into skin for a warm, buildable sun-kissed glow.', howToUse: 'Use the Large Pointed Powder Brush for precise application.' },
  'Iconic Glow Bronzer - 04 Ember.png':                    { name: 'Iconic Glow Bronzer — Ember', description: 'Hybrid powder-cream formula. Melts into skin for a warm, buildable sun-kissed glow.', howToUse: 'Use the Large Pointed Powder Brush for precise application.' },
  'Iconic Luster Blush - 01 Soft Peach.png':               { name: 'Iconic Luster Blush — Soft Peach', description: 'Silky powder-cream blush. Natural glow with buildable, all-day lasting colour.', howToUse: 'Apply with the Angled Blush Brush for optimal results.' },
  'Iconic Luster Blush - 02 Frosted Pink.png':             { name: 'Iconic Luster Blush — Frosted Pink', description: 'Silky powder-cream blush. Natural glow with buildable, all-day lasting colour.', howToUse: 'Apply with the Angled Blush Brush for optimal results.' },
  'Iconic Luster Blush - 04 Vintage Rose.png':             { name: 'Iconic Luster Blush — Vintage Rose', description: 'Silky powder-cream blush. Natural glow with buildable, all-day lasting colour.', howToUse: 'Apply with the Angled Blush Brush for optimal results.' },
  'Iconic Luster Blush 05 - Velvet Plum.png':              { name: 'Iconic Luster Blush — Velvet Plum', description: 'Silky powder-cream blush. Natural glow with buildable, all-day lasting colour.', howToUse: 'Apply with the Angled Blush Brush for optimal results.' },
  'Iconic Radiance Highlighter - 01 Pearl Glow.png':       { name: 'Iconic Radiance Highlighter — Pearl Glow', description: 'Powder-cream hybrid. Soft pearlescent glow that melts into skin for all-day radiance.', howToUse: 'Use the Tapered Highlighter Brush for best results.' },
  'Lip Plumper Berry.png':                                  { name: 'Lip Plumper — Berry', description: 'Increases plumpness by 40% and moisture by 60% after 29 days. Ultra-glossy finish.', howToUse: 'Apply to upper and lower lip with applicator, then press lips together.' },
  'MUS-Hydra_Silk_Setting_Powder-grid-2000x2000.png':       { name: 'Hydra Silk Setting Powder', description: 'Featherlight powder for combination & oily skin. Mattifies and locks makeup all day.', howToUse: 'Tap over complexion with a brush, alone or over foundation.' },
  'MUS_brush_01-2000x2000.png':                             { name: 'Domed Buffer Foundation Brush #01', description: 'Rounded fluffy brush for seamless foundation blending and a soft, even base.', howToUse: 'Sweep gently over skin for a perfect, smooth base.' },
  'MUS_brush_02-2000x2000.png':                             { name: 'Angled Foundation Brush #02', description: 'Angled cut for fingertip-like precision. Works with liquid and cream formulas.' },
  'MUS_brush_04-2000x2000.png':                             { name: 'Tapered Highlighter Brush #04', description: 'Slim, soft brush for precise highlighter placement on cheekbones and the nose bridge.' },
  'MUS_brush_05-2000x2000.png':                             { name: 'Loose Powder Brush #05', description: 'Small-headed brush for controlled powder application under the eyes and T-zone.' },
  'MUS_brush_07-2000x2000.png':                             { name: 'Large Pointed Powder Brush #07', description: 'Lush tapered brush. Perfect for bronzer — follows face contours for a natural glow.' },
  'MUS_brush_10-2000x2000.png':                             { name: 'Blending Eyeshadow Brush #10', description: 'Narrow blending brush that softens harsh lines and creates seamless colour transitions.' },
  'MUS_brush_11-2000x2000.png':                             { name: 'Buffer Eyeshadow Brush #11', description: 'Dense, sloped bristles for building eyelid intensity with complete control.' },
  'Multi Lash 2.0 Mascara.png':                             { name: 'Multi Lash Mascara', description: 'Iconic 3-in-1 mascara — length, definition, separation. All-day, no smudge or flaking.' },
  'Powder puff.png':                                        { name: 'Powder Puff', description: 'Sets base without disturbing foundation. Use pressing motions for maximum longevity.', howToUse: 'Press into skin with pressing motions for extra durability.' },
  'Smooth-Silk-UV-Primer-Primary.png':                      { name: 'Smoothing Primer Silk Touch SPF30', description: 'Lightweight SPF30 primer. Blurs imperfections and locks makeup all day.' },
  'Stay All Day Setting Spray_1.png':                       { name: 'Stay All Day Setting Spray', description: 'Long-lasting setting spray with aloe vera and cucumber for a refreshing airbrushed finish.', howToUse: 'Hold 8–10 inches from face and spray evenly. Can be reapplied throughout the day.' },
  'Superior Colour Blush Stick Cool Pink_2.png':            { name: 'Superior Colour Blush Stick — Cool Pink', description: 'Creamy blush stick with satin finish. Crisp cool-pink hue for a sophisticated flush.' },
  'Superior Colour Blush Stick Rusty Rose_2.png':           { name: 'Superior Colour Blush Stick — Rusty Rose', description: 'Creamy blush stick. Muted terracotta-rust-dusty pink for timeless, vintage warmth.' },
  'Superior Colour Blush Stick Soft Coral_2.png':           { name: 'Superior Colour Blush Stick — Soft Coral', description: 'Creamy blush stick. Gentle coral with warm peach-orange tones, ideal for summer.' },
  'Superior Colour Blush Stick Warm Petal_2.png':           { name: 'Superior Colour Blush Stick — Warm Petal', description: 'Creamy blush stick. Raspberry-rose warmth universally flattering on all skin tones.' },
  'Superior Sun Bronzer Stick Caramel Touch_2.png':         { name: 'Superior Sun Bronzer Stick — Caramel Touch', description: 'Golden caramel bronzer stick with a satin finish. Soft, subtle summer glow.' },
  'Superior Sun Bronzer Stick Midnight Bronze_2.png':       { name: 'Superior Sun Bronzer Stick — Midnight Bronze', description: 'Deep dark brown-copper bronzer. Rich and luminous — ideal for evening elegance.' },
  'Superior Sun Bronzer Stick Soft Tan_1.png':              { name: 'Superior Sun Bronzer Stick — Soft Tan', description: 'Warm beige-brown bronzer. Effortless radiance for a balanced, sun-kissed look.' },
  'Tri Brow 2.0.png':                                       { name: 'Tri Brow', description: 'Three-shade brow palette. Mix to define, contour and fill for an individual finish.' },
  'Wonder_Powder_Open_Atacama.png':                         { name: 'Wonder Powder — Atacama', description: 'Featherlight mineral powder with pearl pigments. Dewy glow like a natural filter.' },
  'Wonder_Powder_Open_Gobi.png':                            { name: 'Wonder Powder — Gobi', description: 'Featherlight mineral powder with pearl pigments. Dewy glow like a natural filter.' },
  'Wonder_Powder_Open_Kalahari.png':                        { name: 'Wonder Powder — Kalahari', description: 'Featherlight mineral powder with pearl pigments. Dewy glow like a natural filter.' },
  'Wonder_Powder_Open_Sahara.png':                          { name: 'Wonder Powder — Sahara', description: 'Featherlight mineral powder with pearl pigments. Dewy glow like a natural filter.' },
}

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
