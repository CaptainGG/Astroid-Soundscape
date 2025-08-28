#!/usr/bin/env python3
"""
NEO Sonification — Near-Earth asteroid flybys → musical composition with stems & harmonic shifts.

Fixes:
- Key signature formatted for mido
- Non-negative MIDI delta times
- Works with NASA API 7-day limit per request
"""

from __future__ import annotations
import os, math, argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Tuple
import requests
from dateutil import parser as dtparser
from mido import Message, MidiFile, MidiTrack, MetaMessage, bpm2tempo, second2tick

SCALES = {
    "minor_pentatonic": [0,3,5,7,10],
    "major_pentatonic": [0,2,4,7,9],
    "natural_minor": [0,2,3,5,7,8,10],
    "major": [0,2,4,5,7,9,11],
    "dorian": [0,2,3,5,7,9,10],
    "lydian": [0,2,4,6,7,9,11],
    "phrygian": [0,1,3,5,7,8,10],
}

KEY_TO_MIDI = {'C':60,'C#':61,'Db':61,'D':62,'D#':63,'Eb':63,'E':64,
               'F':65,'F#':66,'Gb':66,'G':67,'G#':68,'Ab':68,'A':69,'A#':70,'Bb':70,'B':71}

@dataclass
class Settings:
    api_key: str
    start_date: datetime
    end_date: datetime
    bpm: int = 100
    minutes: float = 3.0
    key: str = 'A'
    mode: str = 'minor_pentatonic'
    modulation_every: float = 60.0
    base_octave: int = 3
    octaves_spread: int = 3
    ticks_per_beat: int = 480
    prog_small: int = 46
    prog_medium: int = 74
    prog_large: int = 61
    ch_small: int = 0
    ch_medium: int = 1
    ch_large: int = 2
    ch_drums: int = 9
    min_velocity: int = 28
    max_velocity: int = 112
    min_duration_sec: float = 0.15
    max_duration_sec: float = 1.8
    small_max_m: float = 50.0
    medium_max_m: float = 300.0
    hazard_drum_note: int = 39
    hazard_velocity: int = 96
    hazard_duration_sec: float = 0.1

# ----------------------------
# NASA API helpers
# ----------------------------
def fetch_neows_feed(start: datetime, end: datetime, api_key: str) -> Dict[str,Any]:
    if (end - start).days > 7:
        raise ValueError("NASA NEO feed allows max 7 days per request.")
    url = "https://api.nasa.gov/neo/rest/v1/feed"
    params = {"start_date": start.strftime("%Y-%m-%d"),
              "end_date": end.strftime("%Y-%m-%d"),
              "api_key": api_key}
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json()

def extract_events(data: Dict[str,Any]) -> List[Dict[str,Any]]:
    events=[]
    for day,v in data["near_earth_objects"].items():
        for obj in v:
            for ca in obj.get("close_approach_data", []):
                events.append({
                    "when": dtparser.parse(ca["close_approach_date_full"]).replace(tzinfo=timezone.utc),
                    "miss_km": float(ca["miss_distance"]["kilometers"]),
                    "rel_kps": float(ca["relative_velocity"]["kilometers_per_second"]),
                    "hazard": obj.get("is_potentially_hazardous_asteroid", False),
                    "diameter_m": (obj["estimated_diameter"]["meters"]["estimated_diameter_min"] +
                                   obj["estimated_diameter"]["meters"]["estimated_diameter_max"])/2.0,
                })
    events.sort(key=lambda e:e["when"])
    return events

# ----------------------------
# Music mapping helpers
# ----------------------------
ALL_KEYS = list(KEY_TO_MIDI.keys())
ALL_MODES = list(SCALES.keys())

def get_key_and_mode(time_sec: float, s: Settings) -> Tuple[str,List[int]]:
    step = int(time_sec // s.modulation_every)
    key_idx = (ALL_KEYS.index(s.key) + step) % len(ALL_KEYS)
    mode_idx = (ALL_MODES.index(s.mode) + step) % len(ALL_MODES)
    return ALL_KEYS[key_idx], SCALES[ALL_MODES[mode_idx]]

def map_events_to_music(events: List[Dict[str,Any]], s: Settings):
    if not events: return {"notes":[], "drums":[]}
    t0, t1 = events[0]["when"], events[-1]["when"]
    real_span = (t1-t0).total_seconds()
    target_span = s.minutes*60.0
    miss_vals=[e["miss_km"] for e in events]; vel_vals=[e["rel_kps"] for e in events]
    miss_min,miss_max=min(miss_vals),max(miss_vals)
    vel_min,vel_max=min(vel_vals),max(vel_vals)
    notes,drums=[],[]
    for e in events:
        t_comp=((e["when"]-t0).total_seconds()/real_span)*target_span if real_span>0 else 0
        near01=1-((e["miss_km"]-miss_min)/(miss_max-miss_min+1e-9))
        vel01=(e["rel_kps"]-vel_min)/(vel_max-vel_min+1e-9)
        velocity=int(s.min_velocity+near01*(s.max_velocity-s.min_velocity))
        dur=s.max_duration_sec-vel01*(s.max_duration_sec-s.min_duration_sec)
        cur_key,cur_scale=get_key_and_mode(t_comp,s)
        tonic=KEY_TO_MIDI[cur_key]-12+s.base_octave*12
        degrees=len(cur_scale)*s.octaves_spread
        idx=int(round(near01*(degrees-1)))
        note=tonic+cur_scale[idx%len(cur_scale)]+12*(idx//len(cur_scale))
        if e["diameter_m"]<=s.small_max_m: ch,prog=(s.ch_small,s.prog_small)
        elif e["diameter_m"]<=s.medium_max_m: ch,prog=(s.ch_medium,s.prog_medium)
        else: ch,prog=(s.ch_large,s.prog_large)
        notes.append({"time":t_comp,"duration":dur,"note":note,"velocity":velocity,"channel":ch,"program":prog})
        if e["hazard"]:
            drums.append({"time":t_comp,"duration":s.hazard_duration_sec,"note":s.hazard_drum_note,
                          "velocity":s.hazard_velocity,"channel": s.ch_drums})
    return {"notes":notes,"drums":drums}

# ----------------------------
# MIDI Writing
# ----------------------------
def write_midi(mapped: Dict[str, List[Dict[str, Any]]], s: Settings, outfile: str) -> None:
    mid = MidiFile(type=1, ticks_per_beat=s.ticks_per_beat)
    tempo_track = MidiTrack(); mid.tracks.append(tempo_track)
    tempo_track.append(MetaMessage('set_tempo', tempo=bpm2tempo(s.bpm), time=0))
    tempo_track.append(MetaMessage('time_signature', numerator=4, denominator=4, time=0))
    # Key signature formatted with major/minor
    if 'minor' in s.mode or 'pentatonic' in s.mode:
        key_sig = f"{s.key.upper()}m"
    else:
        key_sig = s.key.upper()
    tempo_track.append(MetaMessage('key_signature', key=key_sig))

    # Stems
    track_small = MidiTrack(); mid.tracks.append(track_small)
    track_medium = MidiTrack(); mid.tracks.append(track_medium)
    track_large = MidiTrack(); mid.tracks.append(track_large)
    track_drums = MidiTrack(); mid.tracks.append(track_drums)

    track_small.append(Message('program_change', channel=s.ch_small, program=s.prog_small, time=0))
    track_medium.append(Message('program_change', channel=s.ch_medium, program=s.prog_medium, time=0))
    track_large.append(Message('program_change', channel=s.ch_large, program=s.prog_large, time=0))

    tracks_map={s.ch_small:track_small,s.ch_medium:track_medium,s.ch_large:track_large,s.ch_drums:track_drums}
    last_time_by_ch={ch:0.0 for ch in tracks_map}

    events_all=[]
    for n in mapped.get("notes",[]): events_all.append({**n,"type":"note"})
    for d in mapped.get("drums",[]): events_all.append({**d,"type":"drum"})
    events_all.sort(key=lambda x:(x["time"],x["channel"]))

    for ev in events_all:
        ch=ev["channel"]; tr=tracks_map[ch]
        start_sec=float(ev["time"])
        delta_sec=start_sec - last_time_by_ch[ch]
        delta_ticks = max(0, int(round(second2tick(delta_sec, mid.ticks_per_beat, bpm2tempo(s.bpm)))))
        note=int(ev["note"]); vel=int(ev["velocity"])
        dur_ticks=int(round(second2tick(ev["duration"], mid.ticks_per_beat, bpm2tempo(s.bpm))))
        tr.append(Message('note_on', note=note, velocity=vel, channel=ch, time=delta_ticks))
        tr.append(Message('note_off', note=note, velocity=0, channel=ch, time=dur_ticks))
        last_time_by_ch[ch] = max(last_time_by_ch[ch], start_sec + ev["duration"])

    mid.save(outfile)

# ----------------------------
# CLI
# ----------------------------
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--start", required=True, help="Start date YYYY-MM-DD (max 7 days range)")
    ap.add_argument("--end", required=True, help="End date YYYY-MM-DD")
    ap.add_argument("--outfile", default="neo_piece.mid")
    ap.add_argument("--minutes", type=float, default=3.0)
    ap.add_argument("--bpm", type=int, default=100)
    ap.add_argument("--key", default="A")
    ap.add_argument("--mode", default="minor_pentatonic")
    ap.add_argument("--modulation-every", type=float, default=60.0)
    args=ap.parse_args()

    api_key=os.environ.get("NASA_API_KEY","DEMO_KEY")
    s=Settings(api_key=api_key,
               start_date=datetime.fromisoformat(args.start),
               end_date=datetime.fromisoformat(args.end),
               bpm=args.bpm,
               minutes=args.minutes,
               key=args.key,
               mode=args.mode,
               modulation_every=args.modulation_every)

    data=fetch_neows_feed(s.start_date,s.end_date,s.api_key)
    events=extract_events(data)
    mapped=map_events_to_music(events,s)
    write_midi(mapped,s,args.outfile)
    print(f"Saved {args.outfile} with {len(mapped['notes'])} notes and {len(mapped['drums'])} drum hits.")

if __name__=="__main__":
    main()
