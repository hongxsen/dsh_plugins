/**
 * Build step for the wallpaper plugin.
 *
 * Generates the built-in wallpapers into `art/` so they stay reviewable files,
 * then composes `src/` plus the inlined data URIs into `client.js`. A browser
 * plugin stylesheet cannot resolve package-relative asset URLs, so the art has
 * to travel inside the bundle.
 *
 * Run: node build.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const W = 1600
const H = 1000

/** Deterministic PRNG so rebuilding art does not reshuffle stars or bokeh. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const grain = (slope = '0.045') => `<filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="${slope}"/></feComponentTransfer>
    </filter>`

const doc = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${defs}
  </defs>
  ${body}
</svg>
`

const starField = (rand, count, color = '#e8f0ff', maxOpacity = 0.78) => {
  const stars = []
  for (let i = 0; i < count; i += 1) {
    const x = Math.round(rand() * W)
    const y = Math.round(rand() * H * 0.82)
    const r = (0.5 + rand() * 1.3).toFixed(2)
    const o = (0.12 + rand() * maxOpacity).toFixed(2)
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${o}"/>`)
  }
  return `<g>${stars.join('')}</g>`
}

/* -------------------------------------------------------------------------- */
/* Aurora                                                                     */
/* -------------------------------------------------------------------------- */

function auroraLight() {
  return doc(`
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
    ${grain()}
  `, `
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
`)
}

function auroraDark() {
  return doc(`
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
    ${grain('0.05')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#indigo)"/>
  <rect width="${W}" height="${H}" fill="url(#teal)"/>
  <rect width="${W}" height="${H}" fill="url(#violet)"/>
  ${starField(mulberry32(20261031), 90)}
  <path d="M -60 700 C 320 560 620 640 900 470 C 1120 335 1380 350 1680 250" fill="none" stroke="#8fb4ff" stroke-opacity="0.1" stroke-width="90" stroke-linecap="round"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.8"/>
`)
}

/* -------------------------------------------------------------------------- */
/* Dune                                                                       */
/* -------------------------------------------------------------------------- */

function duneLight() {
  return doc(`
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fdf4e7"/>
      <stop offset="0.52" stop-color="#f1ddc7"/>
      <stop offset="1" stop-color="#e4d3c8"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.2" cy="0.14" r="0.66">
      <stop offset="0" stop-color="#ffc57e" stop-opacity="0.92"/>
      <stop offset="0.55" stop-color="#ffdcb8" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#ffe9d2" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sky" cx="0.82" cy="0.06" r="0.55">
      <stop offset="0" stop-color="#c2dcef" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#d9e8f4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="rose" cx="0.5" cy="0.64" r="0.5">
      <stop offset="0" stop-color="#eaa88d" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#eaa88d" stop-opacity="0"/>
    </radialGradient>
    ${grain('0.05')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#sun)"/>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#rose)"/>
  <path d="M 0 730 C 260 640 470 700 720 735 C 980 772 1220 690 1600 640 L 1600 1000 L 0 1000 Z" fill="#d9b48e" opacity="0.55"/>
  <path d="M 0 820 C 320 760 540 830 860 815 C 1160 802 1370 750 1600 790 L 1600 1000 L 0 1000 Z" fill="#cba176" opacity="0.55"/>
  <path d="M 0 905 C 360 860 620 930 940 900 C 1220 875 1420 900 1600 945 L 1600 1000 L 0 1000 Z" fill="#b98a5f" opacity="0.45"/>
  <path d="M -80 760 C 300 690 540 730 880 760" fill="none" stroke="#fff6e6" stroke-opacity="0.35" stroke-width="3"/>
  <path d="M 180 862 C 430 820 610 866 910 840" fill="none" stroke="#fff6e6" stroke-opacity="0.22" stroke-width="2"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
`)
}

function duneDark() {
  return doc(`
    <linearGradient id="base" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#16110e"/>
      <stop offset="0.48" stop-color="#231a14"/>
      <stop offset="1" stop-color="#0e191f"/>
    </linearGradient>
    <radialGradient id="amber" cx="0.2" cy="0.18" r="0.66">
      <stop offset="0" stop-color="#d58a44" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#d58a44" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="teal" cx="0.84" cy="0.78" r="0.6">
      <stop offset="0" stop-color="#2c6b68" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#2c6b68" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="plum" cx="0.55" cy="0.3" r="0.52">
      <stop offset="0" stop-color="#7a4055" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#7a4055" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.8">
      <stop offset="0.42" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070b" stop-opacity="0.74"/>
    </radialGradient>
    ${grain('0.05')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#amber)"/>
  <rect width="${W}" height="${H}" fill="url(#teal)"/>
  <rect width="${W}" height="${H}" fill="url(#plum)"/>
  ${starField(mulberry32(77), 34, '#ffd9a0', 0.5)}
  <path d="M 0 760 C 280 676 500 728 760 760 C 1010 792 1260 700 1600 660 L 1600 1000 L 0 1000 Z" fill="#0c0907" opacity="0.55"/>
  <path d="M 0 845 C 340 786 560 852 880 836 C 1170 822 1380 772 1600 806 L 1600 1000 L 0 1000 Z" fill="#0a1114" opacity="0.55"/>
  <path d="M 0 920 C 380 878 640 944 960 914 C 1240 888 1430 912 1600 954 L 1600 1000 L 0 1000 Z" fill="#07090d" opacity="0.6"/>
  <path d="M -80 780 C 300 712 560 748 900 776" fill="none" stroke="#e8a766" stroke-opacity="0.16" stroke-width="2"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.85"/>
`)
}

/* -------------------------------------------------------------------------- */
/* Tide                                                                       */
/* -------------------------------------------------------------------------- */

function tideLight() {
  return doc(`
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e9f7fb"/>
      <stop offset="0.5" stop-color="#d4ebf7"/>
      <stop offset="1" stop-color="#d8e2f7"/>
    </linearGradient>
    <radialGradient id="cyan" cx="0.18" cy="0.2" r="0.66">
      <stop offset="0" stop-color="#71d3e6" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#71d3e6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blue" cx="0.82" cy="0.74" r="0.62">
      <stop offset="0" stop-color="#86aef0" stop-opacity="0.62"/>
      <stop offset="1" stop-color="#86aef0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mint" cx="0.54" cy="0.48" r="0.5">
      <stop offset="0" stop-color="#9fe6cd" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#9fe6cd" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lilac" cx="0.9" cy="0.18" r="0.42">
      <stop offset="0" stop-color="#c9b7ef" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#c9b7ef" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wave" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    ${grain('0.045')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#cyan)"/>
  <rect width="${W}" height="${H}" fill="url(#blue)"/>
  <rect width="${W}" height="${H}" fill="url(#mint)"/>
  <rect width="${W}" height="${H}" fill="url(#lilac)"/>
  <g opacity="0.75">
    <path d="M -120 820 C 260 700 540 800 860 660 C 1120 548 1380 560 1720 420" fill="none" stroke="url(#wave)" stroke-width="120" stroke-linecap="round"/>
    <path d="M -80 930 C 360 840 660 900 980 780 C 1240 682 1460 690 1720 590" fill="none" stroke="url(#wave)" stroke-width="54" stroke-linecap="round" opacity="0.7"/>
  </g>
  <g fill="none" stroke="#7fcfe2" stroke-linecap="round">
    <path d="M 40 690 C 340 610 620 690 900 590" stroke-opacity="0.18" stroke-width="2"/>
    <path d="M 180 760 C 460 700 700 760 980 676" stroke-opacity="0.14" stroke-width="1.5"/>
  </g>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
`)
}

function tideDark() {
  return doc(`
    <linearGradient id="base" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#06131f"/>
      <stop offset="0.5" stop-color="#092536"/>
      <stop offset="1" stop-color="#071a2c"/>
    </linearGradient>
    <radialGradient id="cyan" cx="0.2" cy="0.2" r="0.64">
      <stop offset="0" stop-color="#1a8fa8" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#1a8fa8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blue" cx="0.82" cy="0.76" r="0.62">
      <stop offset="0" stop-color="#315fc0" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#315fc0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="violet" cx="0.65" cy="0.12" r="0.5">
      <stop offset="0" stop-color="#6a56c2" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#6a56c2" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.8">
      <stop offset="0.42" stop-color="#03070d" stop-opacity="0"/>
      <stop offset="1" stop-color="#03070d" stop-opacity="0.76"/>
    </radialGradient>
    ${grain('0.05')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#cyan)"/>
  <rect width="${W}" height="${H}" fill="url(#blue)"/>
  <rect width="${W}" height="${H}" fill="url(#violet)"/>
  ${starField(mulberry32(31415), 46, '#bfefff', 0.55)}
  <g fill="none" stroke-linecap="round">
    <path d="M -120 820 C 260 700 540 800 860 660 C 1120 548 1380 560 1720 420" stroke="#8fe3f2" stroke-opacity="0.08" stroke-width="100"/>
    <path d="M -80 930 C 360 840 660 900 980 780 C 1240 682 1460 690 1720 590" stroke="#b8f0fa" stroke-opacity="0.06" stroke-width="48"/>
    <path d="M 40 690 C 340 610 620 690 900 590" stroke="#b8f0fa" stroke-opacity="0.12" stroke-width="1.5"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.85"/>
`)
}

/* -------------------------------------------------------------------------- */
/* Bloom                                                                      */
/* -------------------------------------------------------------------------- */

function bloomLight() {
  const rand = mulberry32(424242)
  const colors = ['#ff8fb0', '#ffc08e', '#c3a1f2', '#ffffff']
  const bokeh = []
  for (let i = 0; i < 18; i += 1) {
    const x = Math.round(rand() * W)
    const y = Math.round(rand() * H)
    const r = Math.round(18 + rand() * 92)
    const color = colors[Math.floor(rand() * colors.length)]
    const o = (0.08 + rand() * 0.18).toFixed(2)
    bokeh.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${o}"/>`)
  }
  return doc(`
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff5f4"/>
      <stop offset="0.5" stop-color="#fbe2ec"/>
      <stop offset="1" stop-color="#f2e8fb"/>
    </linearGradient>
    <radialGradient id="rose" cx="0.18" cy="0.2" r="0.66">
      <stop offset="0" stop-color="#ff9eb8" stop-opacity="0.65"/>
      <stop offset="1" stop-color="#ff9eb8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="peach" cx="0.78" cy="0.24" r="0.58">
      <stop offset="0" stop-color="#ffc48c" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffc48c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lilac" cx="0.58" cy="0.8" r="0.6">
      <stop offset="0" stop-color="#b99bf0" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#b99bf0" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    ${grain('0.04')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#rose)"/>
  <rect width="${W}" height="${H}" fill="url(#peach)"/>
  <rect width="${W}" height="${H}" fill="url(#lilac)"/>
  <g filter="url(#soft)">${bokeh.join('')}</g>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
`)
}

function bloomDark() {
  const rand = mulberry32(98765)
  const colors = ['#f2a4c0', '#c8b4ff', '#ffcb9c']
  const bokeh = []
  for (let i = 0; i < 16; i += 1) {
    const x = Math.round(rand() * W)
    const y = Math.round(rand() * H)
    const r = Math.round(20 + rand() * 86)
    const color = colors[Math.floor(rand() * colors.length)]
    const o = (0.06 + rand() * 0.14).toFixed(2)
    bokeh.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${o}"/>`)
  }
  return doc(`
    <linearGradient id="base" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#1b1018"/>
      <stop offset="0.5" stop-color="#241428"/>
      <stop offset="1" stop-color="#141222"/>
    </linearGradient>
    <radialGradient id="rose" cx="0.22" cy="0.2" r="0.62">
      <stop offset="0" stop-color="#b84c78" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#b84c78" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="violet" cx="0.7" cy="0.22" r="0.58">
      <stop offset="0" stop-color="#6f4fb8" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#6f4fb8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="amber" cx="0.5" cy="0.82" r="0.5">
      <stop offset="0" stop-color="#a96a39" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#a96a39" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.8">
      <stop offset="0.42" stop-color="#05040a" stop-opacity="0"/>
      <stop offset="1" stop-color="#05040a" stop-opacity="0.72"/>
    </radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    ${grain('0.05')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#rose)"/>
  <rect width="${W}" height="${H}" fill="url(#violet)"/>
  <rect width="${W}" height="${H}" fill="url(#amber)"/>
  ${starField(mulberry32(5150), 30, '#ffd9e8', 0.4)}
  <g filter="url(#soft)">${bokeh.join('')}</g>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.85"/>
`)
}

/* -------------------------------------------------------------------------- */
/* Paper                                                                      */
/* -------------------------------------------------------------------------- */

function paperLight() {
  return doc(`
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f9f8f4"/>
      <stop offset="0.52" stop-color="#fcfbf7"/>
      <stop offset="1" stop-color="#f2f4f7"/>
    </linearGradient>
    <radialGradient id="warm" cx="0.12" cy="0.08" r="0.6">
      <stop offset="0" stop-color="#f3e6d4" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#f3e6d4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cool" cx="0.9" cy="0.5" r="0.6">
      <stop offset="0" stop-color="#dfe8f3" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#dfe8f3" stop-opacity="0"/>
    </radialGradient>
    <pattern id="lines" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
      <line x1="0" y1="0" x2="0" y2="26" stroke="#4b5563" stroke-opacity="0.045" stroke-width="1"/>
    </pattern>
    ${grain('0.055')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>
  <rect width="${W}" height="${H}" fill="url(#cool)"/>
  <rect width="${W}" height="${H}" fill="url(#lines)"/>
  <circle cx="1230" cy="260" r="210" fill="none" stroke="#8f98a6" stroke-opacity="0.09" stroke-width="1.5"/>
  <circle cx="1230" cy="260" r="150" fill="none" stroke="#8f98a6" stroke-opacity="0.06" stroke-width="1"/>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
`)
}

function paperDark() {
  return doc(`
    <linearGradient id="base" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#14161a"/>
      <stop offset="0.5" stop-color="#191d23"/>
      <stop offset="1" stop-color="#101216"/>
    </linearGradient>
    <radialGradient id="cool" cx="0.86" cy="0.18" r="0.6">
      <stop offset="0" stop-color="#35465c" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#35465c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="warm" cx="0.1" cy="0.86" r="0.55">
      <stop offset="0" stop-color="#5a4a36" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#5a4a36" stop-opacity="0"/>
    </radialGradient>
    <pattern id="lines" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
      <line x1="0" y1="0" x2="0" y2="26" stroke="#ffffff" stroke-opacity="0.032" stroke-width="1"/>
    </pattern>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.82">
      <stop offset="0.45" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070b" stop-opacity="0.6"/>
    </radialGradient>
    ${grain('0.055')}
  `, `
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#cool)"/>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>
  <rect width="${W}" height="${H}" fill="url(#lines)"/>
  ${starField(mulberry32(8080), 24, '#dbe8ff', 0.32)}
  <circle cx="1230" cy="260" r="210" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1.5"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.9"/>
`)
}

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

const dataUri = svg => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`

const WALLPAPERS = [
  {
    id: 'aurora',
    light: auroraLight(),
    dark: auroraDark(),
    surfaceLight: '#ffffff',
    surfaceDark: '#0f1319',
    fallbackLight: '#f7f9fc',
    fallbackDark: '#0b0e14',
  },
  {
    id: 'dune',
    light: duneLight(),
    dark: duneDark(),
    surfaceLight: '#fffaf3',
    surfaceDark: '#14100d',
    fallbackLight: '#f7efe4',
    fallbackDark: '#100c0a',
  },
  {
    id: 'tide',
    light: tideLight(),
    dark: tideDark(),
    surfaceLight: '#ffffff',
    surfaceDark: '#0c1620',
    fallbackLight: '#eef7fb',
    fallbackDark: '#081018',
  },
  {
    id: 'bloom',
    light: bloomLight(),
    dark: bloomDark(),
    surfaceLight: '#fffafc',
    surfaceDark: '#171017',
    fallbackLight: '#fbf0f5',
    fallbackDark: '#120b12',
  },
  {
    id: 'paper',
    light: paperLight(),
    dark: paperDark(),
    surfaceLight: '#fbfaf7',
    surfaceDark: '#15171b',
    fallbackLight: '#f4f3ef',
    fallbackDark: '#111318',
  },
]

const readSource = name => readFile(join(here, 'src', name), 'utf8')
const stripExports = source => source.replace(/^export\s+/gmu, '')

async function main() {
  await mkdir(join(here, 'art'), { recursive: true })
  for (const wallpaper of WALLPAPERS) {
    await writeFile(join(here, 'art', `${wallpaper.id}-light.svg`), wallpaper.light)
    await writeFile(join(here, 'art', `${wallpaper.id}-dark.svg`), wallpaper.dark)
  }

  const modelSource = await readSource('model.mjs')
  const declared = modelSource.match(/BUILTIN_IDS = Object\.freeze\(\[([\s\S]*?)\]\)/u)
  const declaredIds = declared === null
    ? []
    : [...declared[1].matchAll(/'([^']+)'/gu)].map(match => match[1])
  const builtIds = WALLPAPERS.map(wallpaper => wallpaper.id)
  if (declaredIds.join('|') !== builtIds.join('|')) {
    throw new Error(`BUILTIN_IDS (${declaredIds.join(', ')}) does not match build art (${builtIds.join(', ')})`)
  }

  const sources = {
    'model.mjs': stripExports(modelSource),
    'image.mjs': stripExports(await readSource('image.mjs')),
    'ui.js': await readSource('ui.js'),
    'entry.js': stripExports(await readSource('entry.js')),
  }
  for (const [name, source] of Object.entries(sources)) {
    if (/^\s*(?:import|export)\s/mu.test(source)) {
      throw new Error(`${name} still contains a top-level import/export`)
    }
  }

  const catalog = WALLPAPERS.map(wallpaper => ({
    id: wallpaper.id,
    light: dataUri(wallpaper.light),
    dark: dataUri(wallpaper.dark),
    surfaceLight: wallpaper.surfaceLight,
    surfaceDark: wallpaper.surfaceDark,
    fallbackLight: wallpaper.fallbackLight,
    fallbackDark: wallpaper.fallbackDark,
  }))

  const output = `/**
 * GENERATED by build.mjs. Edit src/*.js|mjs, then run \`node build.mjs\`.
 *
 * @hongxsen/dsh-wallpaper — browser half. Paints one of the built-in
 * wallpapers or a user image behind the DSH Web UI, frosts every app surface
 * so it shows through, and registers Settings → Wallpaper.
 */
window.__ModuleLoader__.load({
  id: '@hongxsen/dsh-wallpaper',
  factory(require) {
    const React = require('react')

    const WALLPAPER_ART = ${JSON.stringify(catalog)}

${sources['model.mjs']}

${sources['image.mjs']}

${sources['ui.js']}

${sources['entry.js']}

    return { inject, apply }
  },
})
`

  if (output.includes('@@')) throw new Error('client.js still contains an unreplaced placeholder')
  await writeFile(join(here, 'client.js'), output)

  const artBytes = WALLPAPERS.reduce((sum, wallpaper) => sum + wallpaper.light.length + wallpaper.dark.length, 0)
  console.log(`art: ${WALLPAPERS.length} wallpapers × 2 schemes (${artBytes.toLocaleString()} B SVG)`)
  console.log(`client.js written (${output.length.toLocaleString()} B)`)
}

await main()
