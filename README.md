🌌 Asteroid Soundscape

A data-art experiment: transforming NASA Near-Earth Object (NEO) data into sound and visuals.


🚀 Project Overview

This project explores the intersection of astronomy, sound, and generative art.
It consists of two parts:

**Interactive Web Visualizer (React + Three.js)**

  Fetches real asteroid flyby data from NASA’s NEO API.

  Displays asteroids orbiting around Earth in 3D.

  Responds in real time to audio (MP3, MIDI).

  Hazardous asteroids glow red, while safe ones appear blue-white.

  Pulses and color shifts sync with audio amplitude or MIDI note events.

**Python Sonification Tool (MIDI Generator)**

  Converts raw asteroid data into a MIDI composition.

  Maps parameters like miss distance → note velocity and velocity → note duration.
  
  Hazardous asteroids trigger drum hits.

  Outputs multitrack MIDI that can be loaded into a DAW (Ableton, Logic, FL, etc.) for mixing/exporting.

**Together, these create a sonic & visual soundscape of asteroid flybys.**

LIVE DEMO: https://2519384.playcode.io/
