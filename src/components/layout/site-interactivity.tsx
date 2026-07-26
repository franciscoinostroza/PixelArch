"use client"

import { useEffect } from "react"

export default function SiteInteractivity() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const fine = window.matchMedia("(pointer: fine)").matches

    /* scroll progress bar */
    const scrollProgress = document.getElementById("scrollProgress")
    function updateScrollProgress() {
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      const pct = max > 0 ? (doc.scrollTop / max) * 100 : 0
      if (scrollProgress) scrollProgress.style.width = pct + "%"
    }
    updateScrollProgress()
    window.addEventListener("scroll", updateScrollProgress, { passive: true })
    window.addEventListener("resize", updateScrollProgress)

    /* scroll reveal */
    const revealEls = document.querySelectorAll(".reveal:not(.is-visible)")
    if ("IntersectionObserver" in window) {
      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible")
              revealObserver.unobserve(entry.target)
            }
          })
        },
        { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
      )
      revealEls.forEach((el) => revealObserver.observe(el))
    } else {
      revealEls.forEach((el) => el.classList.add("is-visible"))
    }

    /* process step reveal */
    const steps = document.querySelectorAll("[data-step]")
    if ("IntersectionObserver" in window) {
      const stepObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-active")
              stepObserver.unobserve(entry.target)
            }
          })
        },
        { threshold: 0.4, rootMargin: "0px 0px -10% 0px" }
      )
      steps.forEach((s) => stepObserver.observe(s))
    } else {
      steps.forEach((s) => s.classList.add("is-active"))
    }

    /* process timeline fill */
    const timeline = document.getElementById("timeline")
    const trackFill = document.getElementById("trackFill")
    const trackDot = document.getElementById("trackDot")
    let ticking = false
    function updateTrack() {
      ticking = false
      if (!timeline) return
      const rect = timeline.getBoundingClientRect()
      const triggerLine = window.innerHeight * 0.55
      const progress = Math.max(0, Math.min(1, (triggerLine - rect.top) / rect.height))
      const pct = (progress * 100).toFixed(2) + "%"
      if (trackFill) trackFill.style.height = pct
      if (trackDot) trackDot.style.top = pct
    }
    function requestTrackUpdate() {
      if (!ticking) { ticking = true; requestAnimationFrame(updateTrack) }
    }
    setTimeout(updateTrack, 100)
    window.addEventListener("scroll", requestTrackUpdate, { passive: true })
    window.addEventListener("resize", requestTrackUpdate)

    /* custom cursor */
    if (fine && !reduceMotion) {
      const glow = document.getElementById("cursorGlow")
      if (glow) {
        let tx = 0, ty = 0, cx = 0, cy = 0, cursorActive = false
        document.addEventListener("mousemove", (e) => {
          tx = e.clientX; ty = e.clientY
          if (!cursorActive) { cx = tx; cy = ty; cursorActive = true; document.body.classList.add("cursor-hidden") }
          glow.classList.add("is-active")
        })
        document.addEventListener("mouseleave", () => glow.classList.remove("is-active"))
        ;(function cursorLoop() {
          cx += (tx - cx) * 0.18; cy += (ty - cy) * 0.18
          glow.style.left = cx + "px"
          glow.style.top = cy + "px"
          requestAnimationFrame(cursorLoop)
        })()
        document.querySelectorAll("a, button, .product-card, .review-card").forEach((el) => {
          el.addEventListener("mouseenter", () => glow.classList.add("is-hover"))
          el.addEventListener("mouseleave", () => glow.classList.remove("is-hover"))
        })
      }
    }

    /* magnetic pull on primary buttons */
    if (fine && !reduceMotion) {
      document.querySelectorAll(".btn-primary").forEach((btn) => {
        const el = btn as HTMLElement
        el.addEventListener("mousemove", (e) => {
          const r = el.getBoundingClientRect()
          const mx = e.clientX - (r.left + r.width / 2)
          const my = e.clientY - (r.top + r.height / 2)
          el.style.transition = "transform .1s ease-out"
          el.style.transform = `translate(${mx * 0.16}px,${my * 0.35 - 2}px)`
        })
        el.addEventListener("mouseleave", () => {
          el.style.transition = "transform .5s cubic-bezier(.19,1,.22,1)"
          el.style.transform = ""
        })
      })
    }

    /* 3D tilt on product cards */
    if (fine && !reduceMotion) {
      document.querySelectorAll(".product-card").forEach((card) => {
        const el = card as HTMLElement
        el.addEventListener("mousemove", (e) => {
          const r = el.getBoundingClientRect()
          const px = (e.clientX - r.left) / r.width - 0.5
          const py = (e.clientY - r.top) / r.height - 0.5
          el.style.transition = "transform .08s linear"
          el.style.transform = `perspective(700px) rotateX(${-py * 6}deg) rotateY(${px * 6}deg) translateY(-6px)`
        })
        el.addEventListener("mouseleave", () => {
          el.style.transition = "transform .5s cubic-bezier(.19,1,.22,1)"
          el.style.transform = ""
        })
      })
    }

    /* 3D tilt on review cards */
    if (fine && !reduceMotion) {
      document.querySelectorAll(".review-card").forEach((card) => {
        const el = card as HTMLElement
        el.addEventListener("mousemove", (e) => {
          const r = el.getBoundingClientRect()
          const px = (e.clientX - r.left) / r.width - 0.5
          const py = (e.clientY - r.top) / r.height - 0.5
          el.style.transition = "transform .08s linear"
          el.style.transform = `perspective(700px) rotateX(${-py * 5}deg) rotateY(${px * 5}deg) translateY(-4px)`
        })
        el.addEventListener("mouseleave", () => {
          el.style.transition = "transform .5s cubic-bezier(.19,1,.22,1)"
          el.style.transform = ""
        })
      })
    }

    return () => {
      window.removeEventListener("scroll", updateScrollProgress)
      window.removeEventListener("resize", updateScrollProgress)
      window.removeEventListener("scroll", requestTrackUpdate)
      window.removeEventListener("resize", requestTrackUpdate)
    }
  }, [])

  return null
}
