# 🌌 Asteroid Soundscape

A data-art experiment that transforms **NASA Near-Earth Object (NEO)** flyby data into **sound and real-time 3D visuals**.

🔗 **Live Demo:** https://2519384.playcode.io/

---

## 🚀 Overview

This project explores the intersection of **astronomy**, **sonification**, and **generative art** through two connected tools:

- **Interactive Web Visualizer** (React + Three.js)
- **Python Sonification Tool** (MIDI generator)

Together, they create a synchronized **sonic + visual soundscape** of asteroid flybys.

---

## 🖥️ Interactive Web Visualizer (React + Three.js)

- Pulls real asteroid close-approach data from **NASA’s NEO API**
- Renders asteroids orbiting around Earth in **3D**
- Reacts in real time to **audio input** (MP3) or **MIDI**
- Visual encoding:
  - **Hazardous asteroids** glow **red**
  - **Non-hazardous asteroids** appear **blue-white**
- Audio-driven effects:
  - Pulses and color shifts sync to **amplitude** or **MIDI note events**

---

## 🎼 Sonification Tool (Python → MIDI)

- Converts asteroid flyby data into a **multitrack MIDI composition**
- Maps asteroid parameters into musical features, for example:
  - **Miss distance → note velocity**
  - **Velocity → note duration**
- **Hazardous asteroids** trigger **percussive/drum hits**
- Exports MIDI files that can be loaded into any DAW:
  - Ableton, Logic, FL Studio, etc.

---

## ✨ Output

A unified **audio-visual dataset performance**, where asteroid flybys become:
- **Motion + color** in 3D space
- **Rhythm + melody** in MIDI-driven sound

---
