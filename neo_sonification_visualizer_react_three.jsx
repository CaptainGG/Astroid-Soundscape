import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars, Text } from "@react-three/drei";
import * as THREE from "three";
import { Midi } from "@tonejs/midi";

/* ========= App wrapper (index.jsx imports { App }) ========= */
function App() {
  return <NEOVisualizer />;
}
export { App };

/* ================= NASA NeoWs helper ================= */
async function fetchNeosFromNasa(a, b, c) {
  let startDate, endDate, apiKey;
  if (typeof a === "object" && a !== null) {
    ({ startDate, endDate, apiKey } = a);
  } else {
    startDate = a; endDate = b; apiKey = c;
  }

  const today = new Date();
  const defaultStart = today.toISOString().split("T")[0];
  const defaultEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0];

  const fmt = (d) => (typeof d === "string" ? d : d instanceof Date ? d.toISOString().split("T")[0] : null);
  const start = fmt(startDate) || defaultStart;
  const end   = fmt(endDate)   || defaultEnd;
  const key   = (apiKey && String(apiKey).trim()) || "DEMO_KEY";

  const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${start}&end_date=${end}&api_key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NASA API error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!data?.near_earth_objects) return [];
    return Object.values(data.near_earth_objects).flat();
  } catch (err) {
    console.error("Error fetching NASA data:", err);
    return [];
  }
}

/* ================= Hardened Audio Analyser ================= */
function useAudioAnalyser(audioElRef) {
  const [ready, setReady] = useState(false);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);

  const ensureAudioGraph = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return false;

    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;

    if (!analyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      analyserRef.current = analyser;
    }

    if (!sourceRef.current) {
      sourceRef.current = ctx.createMediaElementSource(el);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(ctx.destination);
    }

    setReady(true);
    return true;
  }, [audioElRef]);

  const getLevel = useCallback(() => {
    if (!analyserRef.current || !dataArrayRef.current) return 0;
    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    let sum = 0;
    for (let i = 0; i < dataArrayRef.current.length; i++) sum += dataArrayRef.current[i];
    return sum / dataArrayRef.current.length / 255; // 0..1
  }, []);

  const getSpectrum = useCallback((bands = 32) => {
    if (!analyserRef.current || !dataArrayRef.current) return new Float32Array(bands);
    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    const src = dataArrayRef.current;
    const L = src.length;
    const out = new Float32Array(bands);
    const bin = Math.max(1, Math.floor(L / bands));
    for (let b = 0; b < bands; b++) {
      let sum = 0, cnt = 0;
      const s = b * bin, e = Math.min(L, s + bin);
      for (let i = s; i < e; i++) { sum += src[i]; cnt++; }
      out[b] = cnt ? (sum / cnt) / 255 : 0;
    }
    return out;
  }, []);

  useEffect(() => {
    return () => {
      try {
        sourceRef.current && sourceRef.current.disconnect();
        analyserRef.current && analyserRef.current.disconnect();
        audioCtxRef.current && audioCtxRef.current.close();
      } catch {}
    };
  }, []);

  return { ready, getLevel, getSpectrum, audioCtxRef, ensureAudioGraph };
}

/* ================= Utilities ================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function mapNEO(raw) {
  const name = raw?.name || raw?.id || "NEO";
  const hazard = !!raw?.is_potentially_hazardous_asteroid;
  const cad0 = raw?.close_approach_data?.[0] ?? {};
  const vel =
    Number(cad0?.relative_velocity?.kilometers_per_second ??
      cad0?.relative_velocity?.kilometers_per_hour) || 10000;
  const miss =
    Number(cad0?.miss_distance?.kilometers ?? cad0?.miss_distance?.lunar) || 500000;
  const mag = Number(raw?.absolute_magnitude_h ?? 21.0);
  const date = cad0?.close_approach_date || "";
  return { name, hazard, vel, miss, mag, date };
}

function useMIDIEvents(midiArrayBuffer) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    if (!midiArrayBuffer) return setEvents([]);
    try {
      const midi = new Midi(midiArrayBuffer);
      const evts = [];
      midi.tracks.forEach((t) => (t.notes || []).forEach((n) => {
        evts.push({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity });
      }));
      evts.sort((a, b) => a.time - b.time);
      setEvents(evts);
    } catch (e) {
      console.error("MIDI parse error", e);
      setEvents([]);
    }
  }, [midiArrayBuffer]);
  return events;
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ================= Built-in demo audio (no files needed) ================= */
function createDemoStream(ctx) {
  const out = ctx.createMediaStreamDestination();
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(out);

  const bpm = 95;
  const beat = 60 / bpm;
  const start = ctx.currentTime + 0.05;

  function scheduleKick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
  }

  function scheduleHat(t) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource();
    s.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.15;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    s.connect(hp).connect(g).connect(master);
    s.start(t);
    s.stop(t + 0.15);
  }

  const bass = ctx.createOscillator();
  bass.type = "sawtooth";
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0.08;
  const bassLP = ctx.createBiquadFilter();
  bassLP.type = "lowpass";
  bassLP.frequency.value = 500;
  bass.connect(bassLP).connect(bassGain).connect(master);
  bass.start();

  const lead = ctx.createOscillator();
  lead.type = "square";
  const leadGain = ctx.createGain();
  leadGain.gain.value = 0.06;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 5;
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain).connect(lead.frequency);
  lead.connect(leadGain).connect(master);
  lfo.start();
  lead.start();

  let stopped = false;
  function scheduler() {
    if (stopped) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const t = start + Math.floor((now - start) / (4 * beat)) * 4 * beat + i * beat;
      if (i % 2 === 0) scheduleKick(t);
      scheduleHat(t);
      scheduleHat(t + beat * 0.5);
    }
    const notes = [55, 55, 43, 48, 55, 62, 60, 55];
    const idx = Math.floor((now - start) / (beat)) % notes.length;
    bass.frequency.setValueAtTime(440 * Math.pow(2, (notes[idx] - 69) / 12), now);
    lead.frequency.setValueAtTime(440 * Math.pow(2, (notes[(idx + 3) % notes.length] + 12 - 69) / 12), now);
    setTimeout(scheduler, 100);
  }
  scheduler();

  function stop() {
    stopped = true;
    try { bass.stop(); lead.stop(); } catch {}
  }
  return { stream: out.stream, stop };
}

/* ================= Procedural Earth ================= */
function makeEarthTexture() {
  const w = 1024, h = 512;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#0b3d91"; // ocean
  ctx.fillRect(0, 0, w, h);

  const drawBlob = (points, color = "#2aa84a") => {
    ctx.fillStyle = color;
    ctx.beginPath();
    const [x0, y0] = points[0];
    ctx.moveTo(x0 * w, y0 * h);
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i];
      ctx.lineTo(x * w, y * h);
    }
    ctx.closePath();
    ctx.fill();
  };

  // Stylized continents (very rough)
  drawBlob([[0.12,0.25],[0.18,0.18],[0.22,0.22],[0.2,0.32],[0.17,0.38],[0.13,0.45],[0.14,0.52],[0.19,0.58],[0.22,0.66],[0.19,0.73],[0.14,0.71],[0.1,0.63],[0.09,0.55],[0.1,0.48],[0.11,0.40]]);
  drawBlob([[0.26,0.62],[0.3,0.65],[0.33,0.7],[0.31,0.76],[0.27,0.78],[0.23,0.75],[0.24,0.68]]);
  drawBlob([[0.47,0.32],[0.51,0.28],[0.56,0.26],[0.60,0.27],[0.64,0.31],[0.67,0.36],[0.69,0.44],[0.67,0.50],[0.62,0.55],[0.56,0.56],[0.52,0.52],[0.49,0.46],[0.47,0.39]]);
  drawBlob([[0.55,0.56],[0.58,0.60],[0.60,0.65],[0.59,0.70],[0.55,0.72],[0.51,0.68],[0.51,0.61]]);
  drawBlob([[0.70,0.45],[0.76,0.42],[0.80,0.44],[0.82,0.49],[0.80,0.53],[0.75,0.55],[0.71,0.53]]);
  drawBlob([[0.80,0.50],[0.86,0.51],[0.90,0.55],[0.88,0.60],[0.84,0.60],[0.80,0.57]]);
  drawBlob([[0.84,0.60],[0.92,0.63],[0.96,0.67],[0.94,0.71],[0.88,0.70],[0.83,0.66]]);
  drawBlob([[0.73,0.33],[0.78,0.30],[0.83,0.32],[0.84,0.36],[0.80,0.39],[0.75,0.38]]);
  drawBlob([[0.88,0.74],[0.92,0.74],[0.95,0.76],[0.94,0.80],[0.90,0.82],[0.87,0.80],[0.86,0.76]]);

  const gradTop = ctx.createLinearGradient(0, 0, 0, h*0.15);
  gradTop.addColorStop(0, "rgba(255,255,255,0.5)");
  gradTop.addColorStop(1, "rgba(255,255,255,0.0)");
  ctx.fillStyle = gradTop;
  ctx.fillRect(0, 0, w, h*0.15);

  const gradBot = ctx.createLinearGradient(0, h*0.85, 0, h);
  gradBot.addColorStop(0, "rgba(255,255,255,0.0)");
  gradBot.addColorStop(1, "rgba(255,255,255,0.5)");
  ctx.fillStyle = gradBot;
  ctx.fillRect(0, h*0.85, w, h*0.15);

  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 10;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x+50, y-20, x+120, y+20, x+200, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

function Earth() {
  const texture = useMemo(() => makeEarthTexture(), []);
  const earthMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.9,
      metalness: 0.0,
      emissive: new THREE.Color("#001122"),
      emissiveIntensity: 0.25
    }),
    [texture]
  );

  const earthRef = useRef();
  const atmoRef  = useRef();

  useFrame((_, dt) => {
    if (earthRef.current) earthRef.current.rotation.y += dt * 0.05;
    if (atmoRef.current)  atmoRef.current.rotation.y  += dt * 0.03;
  });

  return (
    <group>
      <mesh ref={earthRef}>
        <sphereGeometry args={[1.2, 64, 64]} />
        <primitive object={earthMat} attach="material" />
      </mesh>
      <mesh ref={atmoRef} scale={1.04}>
        <sphereGeometry args={[1.2, 32, 32]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.15}
          color={"#4aa3ff"}
          roughness={1}
          metalness={0}
          transmission={0}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* ================= Asteroid (audio-ray placement + color) ================= */
function Asteroid({
  data, baseRadius = 3,
  analyserLevelRef, pulseRef, index,
  showLabels, spectrumRef, band, slot, numBands
}) {
  const { hazard, miss, mag, date, name } = data;
  const groupRef = useRef();
  const labelRef = useRef();

  const baseR = useMemo(() => {
    const byMiss = THREE.MathUtils.clamp((miss || 0) / 750_000, 0, 8);
    return baseRadius + 1.5 + byMiss;
  }, [miss, baseRadius]);

  const theta = useMemo(() => (band / Math.max(1, numBands)) * Math.PI * 2, [band, numBands]);
  const jitter = useMemo(() => (slot || 0) * 0.035, [slot]);
  const tilt   = useMemo(() => ((index % 7) - 3) * 0.06, [index]);

  const size = THREE.MathUtils.clamp(1.2 - (mag - 17) * 0.1, 0.2, 1.2);

  const baseColor = useMemo(
    () => (hazard ? new THREE.Color(1.0, 0.25, 0.2) : new THREE.Color(0.5, 0.8, 1.0)),
    [hazard]
  );
  const hotColor = useMemo(() => new THREE.Color(1.0, 0.9, 0.3), []);

  const geom = useMemo(() => new THREE.IcosahedronGeometry(size, 1), [size]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: baseColor.clone(),
    emissive: baseColor.clone().multiplyScalar(0.2),
    roughness: 0.4,
    metalness: 0.1
  }), [baseColor]);

  const labelOpacityRef = useRef(0);

  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const bandEnergy = spectrumRef?.current ? spectrumRef.current[band] || 0 : 0;
    const lvl = analyserLevelRef.current || 0;

    const r = baseR + bandEnergy * 5.0;
    const ang = theta + jitter + t * 0.05;

    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = Math.sin(theta * 0.5 + jitter) * (0.5 + bandEnergy * 1.0) + tilt;

    if (groupRef.current) {
      groupRef.current.position.set(x, y, z);

      const spin = 0.2 + lvl * 1.0;
      groupRef.current.rotation.x += dt * spin;
      groupRef.current.rotation.y += dt * (spin * 0.8);

      const s = 1 + Math.max(bandEnergy * 0.8, lvl * 0.4);
      groupRef.current.scale.setScalar(s);

      const mesh = groupRef.current.children?.[0];
      if (mesh?.material) {
        const mix = Math.min(1, Math.max(bandEnergy * 1.8, lvl * 0.9));
        mesh.material.color.lerpColors(baseColor, hotColor, mix);

        const baseEm = baseColor.clone().multiplyScalar(0.08);
        const hotEm  = hotColor.clone().multiplyScalar(0.9);
        mesh.material.emissive.lerpColors(baseEm, hotEm, mix);
        mesh.material.emissiveIntensity = 0.2 + mix * 2.8;

        mesh.material.needsUpdate = true;
      }
    }

    if (pulseRef?.current) {
      const p = pulseRef.current[index] || 0;
      labelOpacityRef.current += (p - labelOpacityRef.current) * clamp(dt * 8, 0, 1);
    }
    if (labelRef.current?.material) {
      labelRef.current.material.transparent = true;
      labelRef.current.material.opacity = labelOpacityRef.current;
      labelRef.current.visible = labelOpacityRef.current > 0.01;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geom} material={mat} />
      {showLabels && (
        <Text
          ref={labelRef}
          position={[0, size * 1.6, 0]}
          fontSize={0.18}
          anchorX="center"
          anchorY="bottom"
          maxWidth={3}
          color="#ffffff"
          outlineWidth={0.01}
          outlineColor="#000"
          renderOrder={999}
        >
          {`${name} (${date || "—"})`}
        </Text>
      )}
    </group>
  );
}

/* ================= Scene ================= */
function Scene({ neos, analyserLevelRef, pulseRef, showLabels, spectrumRef, numBands }) {
  const banded = useMemo(() => {
    const groups = new Map();
    neos.forEach((n, i) => {
      const band = numBands ? (hashStr(n.name || String(i)) % numBands) : 0;
      const list = groups.get(band) || [];
      list.push({ n, idx: i, band });
      groups.set(band, list);
    });
    const flat = [];
    groups.forEach((list, band) => list.forEach((item, slot) => flat.push({ ...item, slot })));
    return flat;
  }, [neos, numBands]);

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 3, 0]} intensity={2.5} />
      <Stars radius={80} depth={40} count={2500} factor={2} fade speed={1} />

      {/* Earth in the center */}
      <Earth />

      {banded.map(({ n, idx, band, slot }) => (
        <Asteroid
          key={`${n.name}-${idx}`}
          index={idx}
          data={n}
          baseRadius={3 + (idx % 3)}
          analyserLevelRef={analyserLevelRef}
          pulseRef={pulseRef}
          showLabels={showLabels}
          spectrumRef={spectrumRef}
          band={band}
          slot={slot}
          numBands={numBands}
        />
      ))}

      <OrbitControls enablePan enableZoom enableRotate minDistance={4} maxDistance={30} />
    </>
  );
}

/* ================= Main Visualizer ================= */
function NEOVisualizer() {
  const audioRef = useRef(null);
  const [audioURL, setAudioURL] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [neos, setNeos] = useState([]);
  const [midiBuf, setMidiBuf] = useState(null);
  const [midiOffsetSec, setMidiOffsetSec] = useState(0);
  const [showLabels, setShowLabels] = useState(false);
  const [usingDemo, setUsingDemo] = useState(false);

  const NUM_BANDS = 32;
  const spectrumRef = useRef(new Float32Array(NUM_BANDS).fill(0));
  const demoStopRef = useRef(null);

  const { ready, getLevel, getSpectrum, audioCtxRef, ensureAudioGraph } = useAudioAnalyser(audioRef);
  const analyserLevelRef = useRef(0);

  const pulseRef = useRef([]);
  const midiEvents = useMIDIEvents(midiBuf);
  const midiEventsRef = useRef([]);
  const midiPlayheadRef = useRef(0);
  const midiIndexRef = useRef(0);

  useEffect(() => { pulseRef.current = new Array(neos.length).fill(0); }, [neos.length]);
  useEffect(() => { midiEventsRef.current = midiEvents.map((e) => ({ ...e })); }, [midiEvents]);
  useEffect(() => () => { if (audioURL) URL.revokeObjectURL(audioURL); }, [audioURL]);

  const getLevelRef = useRef(getLevel);
  useEffect(() => { getLevelRef.current = getLevel; }, [getLevel]);

  // analyser loop (mount once)
  useEffect(() => {
    let rafId;
    const tick = () => {
      analyserLevelRef.current = getLevelRef.current();

      const spec = getSpectrum(NUM_BANDS);
      for (let i = 0; i < NUM_BANDS; i++) {
        spectrumRef.current[i] = spectrumRef.current[i] * 0.85 + spec[i] * 0.15;
      }

      if (analyserLevelRef.current > 0.75 && neos.length > 0) {
        for (let i = 0; i < pulseRef.current.length; i++) pulseRef.current[i] = 1;
      }
      for (let i = 0; i < pulseRef.current.length; i++) {
        pulseRef.current[i] = Math.max(0, pulseRef.current[i] - 0.02);
      }

      if (audioRef.current && !usingDemo) midiPlayheadRef.current = audioRef.current.currentTime || 0;

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [neos.length, getSpectrum, usingDemo]);

  // MIDI pulses
  useEffect(() => {
    let rafId;
    const tick = () => {
      const evts = midiEventsRef.current || [];
      const t = (midiPlayheadRef.current || 0) + (midiOffsetSec || 0);
      while (evts.length && evts[0].time <= t) {
        const evt = evts.shift();
        if (neos.length > 0) {
          const idx = midiIndexRef.current % neos.length;
          pulseRef.current[idx] = Math.max(pulseRef.current[idx] || 0, evt.velocity || 0.8);
          midiIndexRef.current = (midiIndexRef.current + 1) % Math.max(1, neos.length);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [neos.length, midiOffsetSec]);

  const onMP3 = (file) => {
    if (!file) return;
    if (demoStopRef.current) { demoStopRef.current(); demoStopRef.current = null; setUsingDemo(false); }
    const url = URL.createObjectURL(file);
    setAudioURL(url);
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.src = url;
    }
  };
  const onMIDI = async (file) => { if (!file) return; setMidiBuf(await file.arrayBuffer()); };

  const onNASA = async () => {
    const key = document.getElementById("nasa_key").value.trim() || "DEMO_KEY";
    const s = document.getElementById("nasa_start").value || "2025-01-01";
    const e = document.getElementById("nasa_end").value || "2025-01-07";
    const arr = await fetchNeosFromNasa({ startDate: s, endDate: e, apiKey: key });
    setNeos(arr.map(mapNEO));
    alert(`Loaded ${arr.length} NEOs from NASA.`);
  };

  const useDemo = async () => {
    if (!ensureAudioGraph()) return;
    const ctx = audioCtxRef.current;
    if (demoStopRef.current) { demoStopRef.current(); demoStopRef.current = null; }
    const { stream, stop } = createDemoStream(ctx);
    demoStopRef.current = stop;
    setUsingDemo(true);
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch {}
      audioRef.current.src = "";
      audioRef.current.srcObject = stream;
      await audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const clearAudio = () => {
    if (demoStopRef.current) { demoStopRef.current(); demoStopRef.current = null; }
    setUsingDemo(false);
    setIsPlaying(false);
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch {}
      audioRef.current.srcObject = null;
      audioRef.current.src = "";
    }
  };

  const toggle = async () => {
    if (!audioRef.current) return;
    if (!ensureAudioGraph()) return;
    const ctx = audioCtxRef.current;
    try { if (ctx && ctx.state === "suspended") await ctx.resume(); } catch {}
    if (audioRef.current.paused) { try { await audioRef.current.play(); } catch (e) {} setIsPlaying(true); }
    else { audioRef.current.pause(); setIsPlaying(false); }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "#000", color: "#fff",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      }}
    >
      {/* HUD */}
      <div
        style={{
          position: "absolute", left: 8, right: 8, top: 8, zIndex: 10,
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
          background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16, padding: 12
        }}
      >
        <button onClick={toggle} style={btnStyle}>{isPlaying ? "Pause" : "Play"}</button>
        <button onClick={useDemo} style={btnStyle}>Demo Track</button>
        <button onClick={clearAudio} style={btnStyle}>Clear Audio</button>

        <label style={fileStyle}>
          Load MP3
          <input type="file" accept="audio/mpeg,audio/mp3" style={{ display: "none" }}
                 onChange={(e) => onMP3(e.target.files?.[0])} />
        </label>

        <label style={fileStyle}>
          Load MIDI
          <input type="file" accept="audio/midi,.mid,.midi" style={{ display: "none" }}
                 onChange={(e) => onMIDI(e.target.files?.[0])} />
        </label>

        <label style={fieldStyle}>API Key <input id="nasa_key" defaultValue="DEMO_KEY" style={inputStyle} /></label>
        <label style={fieldStyle}>Start <input id="nasa_start" type="date" defaultValue="2025-01-01" style={inputStyle} /></label>
        <label style={fieldStyle}>End <input id="nasa_end" type="date" defaultValue="2025-01-07" style={inputStyle} /></label>
        <button onClick={onNASA} style={btnStyle}>Load from NASA</button>

        <button onClick={() => setShowLabels(v => !v)} style={btnStyle}>
          {showLabels ? "Hide labels" : "Show labels"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>MIDI Offset</span>
          <input type="range" min={-5} max={5} step={0.1} value={midiOffsetSec}
                 onChange={(e) => setMidiOffsetSec(parseFloat(e.target.value))} />
          <span style={{ fontSize: 12, opacity: 0.8, width: 48, textAlign: "right" }}>
            {midiOffsetSec.toFixed(1)}s
          </span>
        </div>

        <div style={{ marginLeft: "auto", fontSize: 14, opacity: 0.85 }}>
          {ready ? (usingDemo ? "Demo track running" : "Audio analyser ready") : "Click Demo Track or load MP3"}
        </div>
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} crossOrigin="anonymous" controls={false}
             style={{ position: "absolute", left: -99999, width: 0, height: 0 }} />

      <Canvas
        camera={{ position: [0, 5, 12], fov: 60 }}
        style={{ position: "absolute", inset: 0, background: "#000" }}
        onCreated={({ gl }) => gl.setClearColor("#000000")}
      >
        <Suspense fallback={null}>
          <Scene
            neos={neos}
            analyserLevelRef={analyserLevelRef}
            pulseRef={pulseRef}
            showLabels={showLabels}
            spectrumRef={spectrumRef}
            numBands={32}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

/* --- small inline HUD styles --- */
const btnStyle = {
  padding: "8px 12px", borderRadius: 14, background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer"
};
const fileStyle = {
  padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer"
};
const fieldStyle = { padding: "6px 10px", borderRadius: 12, background: "rgba(255,255,255,0.05)" };
const inputStyle = { marginLeft: 8, padding: "2px 6px", borderRadius: 6, border: 0, color: "#000" };
