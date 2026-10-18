# Adding .tcx detail to a gym session

The gym console exports a session as one row with averages: duration, distance,
average heart rate, average power. The `.tcx` it can also download has every
few seconds instead, which is where three things live that the averages throw
away:

- **Heart rate the console never recorded.** A treadmill that does not see a
  heart-rate strap reports nothing at all. Its `.tcx` still holds the reading,
  taken from whatever the machine did see.
- **The shape of the effort.** Was it steady, or blocks? Averaging says only
  that the average was 7.2 km/h; the per-second speed says whether that was
  twenty minutes at 7.2, or four blocks alternating 5.6 and 10.8.
- **The peak.** Average 79 W says nothing about the 569 W you hit once.

## Using it

**Settings → Data → Add gym machine files (.tcx)**, pick the file(s). For each
one the app works out which recorded session it belongs to and shows exactly
what it would add, before anything is written:

```
treadmill data.tcx
Sat 17 Oct · 20 min · 2.47 km · HR 143/145 · 19 speed levels
  Run Excite Live — 2.47 km vs 2.40 km, 20 min vs 20 min recorded
  Adds: TCX: HR 140/188; 19 speed levels 5.1-10.3 km/h, longest 120s; hi-lo blocks
```

Confirm and the note on that session grows. Nothing else is touched.

## What it deliberately does not do

**It never creates a session.** The gym's own export already made one; a `.tcx`
carries no identity of its own (no serial, no session id, no name), so matching
it is inference. A file that fits nothing is reported and left alone.

**It never overwrites.** Only facts the stored note is missing are appended.
The bike entry that already reads `HR 153/180; avg 79 W` gains nothing from a
file saying the same thing.

**It does not guess.** Matching uses two signals — how long it ran, and how far
— and certainty needs both. A file that can only be matched on duration is
labelled *possible*, not *matched*: on a day with a 20-minute treadmill and a
20-minute bike, a file with no distance of its own fits both exactly. Nothing
confident is pre-selected, and where two entries fit equally well the app says
so and asks.

**Re-importing is a no-op.** A note that already carries `TCX:` is left alone,
so picking the same file twice changes nothing.

## How the matching works

`lib/tcx.js` parses the file; `lib/tcx-match.js` decides where it goes.

- **Duration** is the strong signal — two machines rarely run for the same
  number of minutes on the same day by accident. Compared with a floor, so two
  20-minute sessions are close but two 20- and 35-minute ones are not.
- **Distance** breaks the tie where the stored entry has one. Distance is
  *derived* from the entry's recorded speed (`speed × minutes`), so an entry
  whose console left the speed at 0 has no distance to compare and is matched
  on duration alone — capped below certainty for exactly that reason.
- **Only the same calendar day** is considered. A 20-minute run on another date
  is a different session however well the numbers fit.
- The day is read in the phone's own timezone, matching how the console stamps
  its own rows, so a late-evening session does not land on the wrong day.

## The shape

Speed samples are grouped into effort blocks, then tidied twice:

- **De-spiked.** A brief reading between two holds of the same pace is noise.
  Counting it would split one steady effort into two, or — repeated — invent an
  interval session out of a steady one. A block under 30s is dropped and its
  time given back to the run it interrupted.
- **Gaps are not work.** A gap over 60s is the machine pausing; it neither
  counts as duration nor merges two efforts across it. That matters for indoor
  bikes, which record nothing while you are on the saddle reading a book.

A session is only called *hi-lo blocks* when the blocks alternate — up, down,
up — at least twice. A hill climb or a fade goes one way and stays there, and
is reported as its speed levels rather than given a name it might not deserve.

## Where this was needed

`documentation/TECHNOGYM-PROGRAMS.md` records the open question: the console
never stores the program name, so the guesser had nothing but level and heart
rate and refused to name intervals. A `.tcx` is the block shape that was
missing. It does not make the name certain — the console's own label, when it
gives one, still wins — but it is evidence that was not there before.