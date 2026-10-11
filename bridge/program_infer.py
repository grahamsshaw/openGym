"""Guess cardio programs from session shape (v1, deterministic).

Technogym never records the program name, so this works backwards from
what exists (see documentation/TECHNOGYM-PROGRAMS.md):

1. **Stated** (confidence 0.9): the exercise name itself contains a known
   program phrase ("Bike 700 Excite Live: Lose weight routine"). Live-API
   rows usually carry this; export rows never do.
2. **Heuristic** (0.6-0.8): level, elevation and heart-rate steadiness
   against the machine's known menu. Hills ramp (high level + climb),
   steady work is long with a flat heart rate. Intervals are NOT guessed
   here — without per-block shapes that would be astrology; they arrive
   with TCX laps or hand-logged modes.
3. Otherwise no guess (None) — a missing label beats a wrong one.

Phrases come from bridge/equipment_catalog.json (program_modes) plus
bridge/qr_mapping.json (console_routines), so the guesser only ever
proposes programs the machine actually has.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_menus() -> dict[str, list[str]]:
    """Map machine name (lowercased) to its known program phrases."""
    menus: dict[str, list[str]] = {}
    try:
        catalog = json.loads((ROOT / "bridge" / "equipment_catalog.json").read_text(encoding="utf-8"))
    except (ValueError, OSError):
        catalog = []
    for machine in catalog:
        name = str(machine.get("name", "")).lower()
        if name:
            menus.setdefault(name, []).extend(machine.get("program_modes", []) or [])
    try:
        mapping = json.loads((ROOT / "bridge" / "qr_mapping.json").read_text(encoding="utf-8"))
    except (ValueError, OSError):
        mapping = []
    for entry in mapping:
        name = str(entry.get("machine", "")).lower()
        if name:
            menus.setdefault(name, []).extend(entry.get("console_routines", []) or [])
    return menus


def _phrases_for(machine: str, menus: dict[str, list[str]]) -> list[str]:
    """Program phrases plausibly belonging to this machine.

    Matches the machine against catalog names loosely (the live API says
    "Run Excite Live", the catalog says "Run Excite Live" or "Treadmill").
    """
    machine = (machine or "").lower()
    phrases: list[str] = []
    for name, modes in menus.items():
        if name and (name in machine or machine in name or "treadmill" in machine and "run" in name):
            phrases.extend(modes)
    seen = set()
    return [p for p in phrases if p and not (p.lower() in seen or seen.add(p.lower()))]


def infer_program(exercise_name: str = "", machine: str = "",
                  level: float | None = None, elevation_m: float | None = None,
                  duration_s: float | None = None,
                  avg_hr: float | None = None, max_hr: float | None = None,
                  menus: dict[str, list[str]] | None = None) -> tuple[str, float, str] | None:
    """Guess a session's program.

    Returns:
        ``(label, confidence_0_to_1, basis)`` with basis ``"stated"`` or
        ``"shape"``, or None when there is nothing honest to say.
    """
    menus = menus if menus is not None else load_menus()
    phrases = _phrases_for(machine, menus)

    lowered = (exercise_name or "").lower()
    for phrase in phrases:
        if phrase.lower() in lowered:
            return phrase, 0.9, "stated"

    generic = ["hill", "weight loss", "lose weight", "hiit", "interval",
               "steady", "stamina", "endurance", "fat burn", "quick start"]
    for phrase in generic:
        if phrase in lowered:
            return phrase, 0.85, "stated"

    if level is not None and level >= 8 and (elevation_m or 0) > 0:
        return "Hills", 0.7, "shape"
    if level is not None and level >= 10:
        return "Hills", 0.65, "shape"
    if (duration_s or 0) >= 1200 and avg_hr and max_hr and (max_hr - avg_hr) <= 15:
        return "Steady", 0.6, "shape"
    return None


def format_guess(guess: tuple[str, float, str] | None) -> str:
    """Render a guess for a session note (``likely Hills (7/10)``)."""
    if guess is None:
        return ""
    label, confidence, _basis = guess
    return f"likely {label} ({round(confidence * 10)}/10)"
