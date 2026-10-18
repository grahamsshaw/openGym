"""Weigh-in conflict resolution (run: py bridge/test_conflicts.py).

The gym's scale reports the same fault reading repeatedly; a day can hold both
that and the real weight, and openGym keeps the last row for a day, so position
alone used to decide. These pin the cases that matter: a clear majority is
resolved, and anything without evidence is left alone.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from technogym_export_to_opengym import resolve_conflicts

failures = []


def check(label, got, want):
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}")
    if not ok:
        failures.append((label, got, want))


def rows(*pairs):
    return [{"date": d, "weight": w} for d, w in pairs]


def weights(kept):
    return sorted((r["date"], r["weight"]) for r in kept)


print("resolve_conflicts")

# The real case: 26 September, two good readings and one fault reading last.
kept, dropped, unresolved = resolve_conflicts(
    rows(("2026-09-26", "105.0"), ("2026-09-26", "105.0"), ("2026-09-26", "70.0")))
check("stray dropped, real weight kept",
      weights(kept), [("2026-09-26", "105.0"), ("2026-09-26", "105.0")])
check("dropped reported", dropped, [("2026-09-26", [70.0])])
check("nothing left unresolved", unresolved, [])

# The fault reading lands first this time - position must not matter.
kept, dropped, _ = resolve_conflicts(
    rows(("2026-05-12", "70.0"), ("2026-05-12", "105.0"), ("2026-05-12", "105.0")))
check("position does not matter", weights(kept),
      [("2026-05-12", "105.0"), ("2026-05-12", "105.0")])

# Two strays against four good readings.
kept, dropped, _ = resolve_conflicts(rows(
    ("2026-04-11", "105.0"), ("2026-04-11", "70.0"), ("2026-04-11", "105.0"),
    ("2026-04-11", "105.0"), ("2026-04-11", "70.0"), ("2026-04-11", "105.0")))
check("two strays dropped", sorted(r["weight"] for r in kept), ["105.0"] * 4)

# A lone reading is never touched, however odd it looks.
kept, dropped, unresolved = resolve_conflicts(rows(("2026-07-01", "70.0")))
check("a lone reading is left alone", weights(kept), [("2026-07-01", "70.0")])
check("a lone reading reports nothing", (dropped, unresolved), ([], []))

# Readings that all agree within tolerance: nothing to do.
kept, dropped, _ = resolve_conflicts(
    rows(("2026-04-14", "105.0"), ("2026-04-14", "105.0"), ("2026-04-14", "105.0")))
check("all agreeing, untouched", len(kept), 3)
check("all agreeing, nothing dropped", dropped, [])

# Real weight does not drift by more than the tolerance in one weigh-in.
kept, dropped, _ = resolve_conflicts(
    rows(("2026-04-24", "105.0"), ("2026-04-24", "104.5")))
check("1.5 kg apart still counts as agreeing", (len(kept), dropped), (2, []))

# An even split: no evidence either way, so nothing is decided.
kept, dropped, unresolved = resolve_conflicts(
    rows(("2026-08-08", "70.0"), ("2026-08-08", "105.0")))
check("even split keeps everything", len(kept), 2)
check("even split drops nothing", dropped, [])
check("even split is reported", unresolved, [("2026-08-08", [70.0, 105.0])])

# Several days at once, independent of each other. The bad day has a clear
# majority (three against two); the good day is a single reading.
kept, dropped, _ = resolve_conflicts(rows(
    ("2026-04-09", "70.0"), ("2026-04-09", "105.0"), ("2026-04-09", "105.0"),
    ("2026-04-09", "105.0"), ("2026-04-09", "70.0"),
    ("2026-03-01", "104.0")))
check("other days untouched", len(kept), 4)
check("bad day resolved", weights([r for r in kept if r["date"] == "2026-04-09"]),
      [("2026-04-09", "105.0"), ("2026-04-09", "105.0"), ("2026-04-09", "105.0")])

# A day split two-and-two has no majority, so nothing is decided.
kept, dropped, unresolved = resolve_conflicts(rows(
    ("2026-04-09", "70.0"), ("2026-04-09", "105.0"),
    ("2026-04-09", "105.0"), ("2026-04-09", "70.0")))
check("two-two split keeps all four", len(kept), 4)
check("two-two split drops nothing", dropped, [])
check("two-two split is reported", len(unresolved), 1)

# A value openGym would reject is passed through untouched, not mangled.
kept, _, _ = resolve_conflicts(rows(("2026-04-09", "105.0"), ("2026-04-09", "105.0"),
                                  ("2026-04-09", "")))
check("unparseable row left as found", len(kept), 3)

print()
print("FAILURES:", [f[0] for f in failures] or "none")
sys.exit(1 if failures else 0)