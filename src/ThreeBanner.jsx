import React, { useRef, useEffect } from 'react'
import * as THREE from 'three'

// Animierter 3D-Hintergrund für den Hero (schwebende, leuchtende Kugeln).
export default function ThreeBanner() {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let w = el.clientWidth || 1000, h = el.clientHeight || 240

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100)
    camera.position.z = 15

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    const colors = [0xffd27a, 0x7fd1c4, 0xf2a6c0, 0xc8a0d8, 0xffe6b0]
    const geo = new THREE.IcosahedronGeometry(0.14, 1)
    const group = new THREE.Group()
    const items = []
    for (let i = 0; i < 90; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.72 })
      const m = new THREE.Mesh(geo, mat)
      m.position.set((Math.random() - 0.5) * 34, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 18)
      const s = 0.5 + Math.random() * 2.2
      m.scale.setScalar(s)
      m.userData.ph = Math.random() * Math.PI * 2
      m.userData.amp = 0.2 + Math.random() * 0.6
      group.add(m); items.push(m)
    }
    scene.add(group)

    let raf, t = 0, alive = true
    const animate = () => {
      if (!alive) return
      t += 0.006
      group.rotation.y = t * 0.28
      group.rotation.x = Math.sin(t * 0.18) * 0.12
      for (let i = 0; i < items.length; i++) {
        const m = items[i]
        m.position.y += Math.sin(t * 1.2 + m.userData.ph) * 0.004 * m.userData.amp
        m.rotation.x += 0.003; m.rotation.y += 0.004
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()

    const onResize = () => {
      w = el.clientWidth || w; h = el.clientHeight || h
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      alive = false; cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      geo.dispose(); items.forEach(m => m.material.dispose())
      renderer.dispose()
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={ref} className="three-bg" />
}
