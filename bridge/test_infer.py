"""Tests for program_infer (run: py bridge/test_infer.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from program_infer import infer_program, format_guess

MENUS = {
    "run excite live": ["Quick Start", "Hills", "Lose weight routine", "HIIT"],
    "bike excite live": ["Quick Start", "Hills", "Lose weight routine"],
}

failures = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}")
    if not ok:
        failures.append(label)


# Stated in the name wins, with the catalog phrase.
check("stated program", infer_program("Bike 700 Excite Live: Lose weight routine", "Bike Excite Live", menus=MENUS),
      ("Lose weight routine", 0.9, "stated"))
# Hill shape: high level + climb.
check("hill shape", infer_program("Treadmill (Technogym)", "Run Excite Live",
                                  level=12.0, elevation_m=54.0, duration_s=900,
                                  avg_hr=150, max_hr=178, menus=MENUS),
      ("Hills", 0.7, "shape"))
# Steady shape: long + flat heart rate.
check("steady shape", infer_program("Bike (Technogym)", "Bike Excite Live",
                                    level=6.0, duration_s=1200,
                                    avg_hr=119, max_hr=130, menus=MENUS),
      ("Steady", 0.6, "shape"))
# Thin data: silence over fiction.
check("no guess", infer_program("Cardio (Technogym)", "Bike Excite Live",
                                duration_s=300, menus=MENUS), None)
check("format", format_guess(("Hills", 0.7, "shape")), "likely Hills (7/10)")
check("format none", format_guess(None), "")

print("FAILURES:", failures if failures else "none")
sys.exit(1 if failures else 0)
