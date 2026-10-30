/**
 * Build step for the wallpaper plugin.
 *
 * Generates the two original wallpapers (light/dark) into `art/` so they stay
 * reviewable files, then inlines them as data URIs into `client.js` because a
 * browser plugin's stylesheet cannot resolve package-relative asset URLs.
 *
 * Run: node build.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** Deterministic PRNG so rebuilding art does not reshuffle the stars. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 1600
const H = 1000

function lightArt() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0dd"/>
      <stop offset="0.48" stop-color="#e4eefb"/>
      <stop offset="1" stop-color="#d7e6f5"/>
    </linearGradient>
    <radialGradient id="warm" cx="0.17" cy="0.1" r="0.72">
      <stop offset="0" stop-color="#ffab63" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#ffdcb8" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#ffe7cf" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mint" cx="0.86" cy="0.34" r="0.62">
      <stop offset="0" stop-color="#74d6b0" stop-opacity="0.68"/>
      <stop offset="1" stop-color="#bfe8d6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sky" cx="0.62" cy="0.92" r="0.7">
      <stop offset="0" stop-color="#8bbcf0" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#c6ddf5" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lilac" cx="0.42" cy="0.6" r="0.5">
      <stop offset="0" stop-color="#c3a4ee" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#e3d9f6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="streak" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.045"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>
  <rect width="${W}" height="${H}" fill="url(#mint)"/>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#lilac)"/>
  <g opacity="0.5">
    <path d="M -120 860 C 320 700 560 760 900 520 C 1180 320 1400 300 1720 150" fill="none" stroke="url(#streak)" stroke-width="150" stroke-linecap="round"/>
    <path d="M -80 940 C 380 820 700 860 1020 700" fill="none" stroke="url(#streak)" stroke-width="60" stroke-linecap="round" opacity="0.6"/>
  </g>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
</svg>
`
}

function darkArt() {
  const rand = mulberry32(20261031)
  const stars = []
  for (let i = 0; i < 90; i += 1) {
    const x = Math.round(rand() * W)
    const y = Math.round(rand() * H * 0.8)
    const r = (0.5 + rand() * 1.3).toFixed(2)
    const o = (0.16 + rand() * 0.62).toFixed(2)
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#e8f0ff" opacity="${o}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="base" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#101a2e"/>
      <stop offset="0.45" stop-color="#16233d"/>
      <stop offset="1" stop-color="#0d2430"/>
    </linearGradient>
    <radialGradient id="indigo" cx="0.2" cy="0.16" r="0.68">
      <stop offset="0" stop-color="#5f7dff" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#5f7dff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="teal" cx="0.82" cy="0.74" r="0.62">
      <stop offset="0" stop-color="#2fbfcf" stop-opacity="0.62"/>
      <stop offset="1" stop-color="#2fbfcf" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="violet" cx="0.64" cy="0.1" r="0.5">
      <stop offset="0" stop-color="#9a63f0" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#9a63f0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.78">
      <stop offset="0.45" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070b" stop-opacity="0.72"/>
    </radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#indigo)"/>
  <rect width="${W}" height="${H}" fill="url(#teal)"/>
  <rect width="${W}" height="${H}" fill="url(#violet)"/>
  <g>${stars.join('')}</g>
  <path d="M -60 700 C 320 560 620 640 900 470 C 1120 335 1380 350 1680 250" fill="none" stroke="#8fb4ff" stroke-opacity="0.1" stroke-width="90" stroke-linecap="round"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.8"/>
</svg>
`
}

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`

const light = lightArt()
const dark = darkArt()

await mkdir(join(here, 'art'), { recursive: true })
await writeFile(join(here, 'art', 'light.svg'), light)
await writeFile(join(here, 'art', 'dark.svg'), dark)

const template = await readFile(join(here, 'client.template.js'), 'utf8')
const built = template
  .replace('@@LIGHT@@', dataUri(light))
  .replace('@@DARK@@', dataUri(dark))

if (built.includes('@@')) throw new Error('client.template.js still contains an unreplaced placeholder')
await writeFile(join(here, 'client.js'), built)

console.log(`art/light.svg ${light.length} B, art/dark.svg ${dark.length} B, client.js ${built.length} B`)
