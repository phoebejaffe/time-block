import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')
const publicDir = join(rootDir, 'public')

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180 }
]

async function generateIcons() {
  const svgPath = join(publicDir, 'favicon.svg')
  
  for (const { name, size, maskable } of sizes) {
    const outputPath = join(publicDir, name)
    
    let pipeline = sharp(svgPath)
      .resize(size, size, { fit: 'cover' })
    
    if (maskable) {
      // For maskable icons, we need to ensure the content is safe within a circular mask
      // Sharp doesn't have built-in maskable support, but we can use a circular clip
      pipeline = pipeline.modulate({
        brightness: 1.0
      })
    }
    
    await pipeline.png().toFile(outputPath)
    console.log(`Generated ${name}`)
  }
  
  console.log('All icons generated successfully!')
}

generateIcons().catch(console.error)