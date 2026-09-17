<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const canvas = ref<HTMLCanvasElement>()
let animId = 0
let particles: Particle[] = []
let mouseX = -9999
let mouseY = -9999
let tick = 0
let flashLine = { i: -1, j: -1, alpha: 0 }

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  tier: 'major' | 'minor'
  phase: number
}

const isMobile = window.innerWidth < 900
const MAJOR_COUNT = isMobile ? 3 : 8
const MINOR_COUNT = isMobile ? 12 : 37
const LINK_DIST = isMobile ? 100 : 140
const MOUSE_RADIUS = 120
const FLASH_INTERVAL = 180

function init(w: number, h: number) {
  particles = []
  for (let i = 0; i < MAJOR_COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      r: Math.random() * 1 + 3,
      tier: 'major',
      phase: Math.random() * Math.PI * 2,
    })
  }
  for (let i = 0; i < MINOR_COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 0.7 + 0.8,
      tier: 'minor',
      phase: 0,
    })
  }
}

function lineWidth(a: Particle, b: Particle) {
  if (a.tier === 'major' && b.tier === 'major') return 1.0
  if (a.tier === 'major' || b.tier === 'major') return 0.5
  return 0.3
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  tick++

  for (const p of particles) {
    if (!isMobile) {
      const dx = p.x - mouseX
      const dy = p.y - mouseY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = ((MOUSE_RADIUS - dist) / MOUSE_RADIUS) * 0.4
        p.vx += (dx / dist) * force
        p.vy += (dy / dist) * force
      }
    }
    p.x += p.vx
    p.y += p.vy
    p.vx *= 0.99
    p.vy *= 0.99
    if (p.x < 0) p.x = w
    if (p.x > w) p.x = 0
    if (p.y < 0) p.y = h
    if (p.y > h) p.y = 0
  }

  if (tick % FLASH_INTERVAL === 0) {
    const majors = particles.filter(p => p.tier === 'major')
    const minors = particles.filter(p => p.tier === 'minor')
    if (majors.length > 0 && minors.length > 0) {
      const mj = majors[Math.floor(Math.random() * majors.length)]
      const mn = minors[Math.floor(Math.random() * minors.length)]
      flashLine.i = particles.indexOf(mj)
      flashLine.j = particles.indexOf(mn)
      flashLine.alpha = 0.5
    }
  }
  if (flashLine.alpha > 0) flashLine.alpha *= 0.94

  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i]
      const b = particles[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < LINK_DIST) {
        let alpha = (1 - dist / LINK_DIST) * 0.15
        if (i === flashLine.i && j === flashLine.j) {
          alpha = Math.max(alpha, flashLine.alpha)
        }
        ctx.beginPath()
        ctx.strokeStyle = `rgba(45, 212, 191, ${alpha})`
        ctx.lineWidth = lineWidth(a, b)
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }
  }

  for (const p of particles) {
    ctx.beginPath()
    if (p.tier === 'major') {
      const pulse = 0.5 + 0.3 * Math.sin(tick * 0.02 + p.phase)
      ctx.globalAlpha = pulse
      ctx.shadowColor = 'rgba(94, 234, 212, 0.6)'
      ctx.shadowBlur = 8
      ctx.fillStyle = 'rgba(94, 234, 212, 0.7)'
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    } else {
      ctx.fillStyle = 'rgba(94, 234, 212, 0.35)'
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function loop() {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')!
  draw(ctx, c.offsetWidth, c.offsetHeight)
  animId = requestAnimationFrame(loop)
}

function onResize() {
  const c = canvas.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  c.width = c.offsetWidth * dpr
  c.height = c.offsetHeight * dpr
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  init(c.offsetWidth, c.offsetHeight)
}

function onMouse(e: MouseEvent) {
  const c = canvas.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  mouseX = e.clientX - rect.left
  mouseY = e.clientY - rect.top
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  onResize()
  window.addEventListener('resize', onResize)
  if (!isMobile) window.addEventListener('mousemove', onMouse)
  loop()
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', onMouse)
})
</script>

<template>
  <canvas ref="canvas" class="login-particles" />
</template>

<style scoped>
.login-particles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>