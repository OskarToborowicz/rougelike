# Art surfaces

Drop image files in this folder and the game picks them up on the next reload.
Nothing here is required — every surface has a finished-looking empty state
(tinted ground, hairline frame, a sigil where the face would be), so the game
runs and looks deliberate with this folder completely empty. Files are probed
once per session; a missing one is not an error and is not retried.

Format: **JPEG** for anything photographic or painted, **PNG** only if you need
transparency. Keep each file under ~600 KB — they are loaded over the network at
boot and a slow title screen is the first impression.

## The title painting

| File | Size | Notes |
| --- | --- | --- |
| `descent.jpg` | 1720 × 1080 | Fills the right 54% of the title screen, `object-fit: cover`, focal point around 50% × 42%. The left third is covered by a scrim and then by the wordmark, so keep the subject right of centre. |

## Shade portraits

One per class, shared by every seat that picks it. Health renders as shadow
rising up these from the bottom, so **compose head-and-shoulders in the top
two-thirds** — a face in the lower third disappears at half health, which is
exactly when the player is looking at it.

| File | Size | Notes |
| --- | --- | --- |
| `shade-warrior.jpg` | 372 × 472 | Portrait, 1:1.27. Shown at 186×236 on the local plate and 118×150 for allies. |
| `shade-archer.jpg` | 372 × 472 | |
| `shade-mage.jpg` | 372 × 472 | |

## God plates

Fill the left 47.5% of the offer screen, full height. The god's name, epithet and
quote sit over the bottom third under a scrim — **keep the face in the upper
half**. Thirteen gods, two per throne except the aesir (three) and the choir and
rodnova (one each); any you skip fall back to the empty state with the god's
initial.

| Throne | Files |
| --- | --- |
| I · hellenic | `god-zeus.jpg`, `god-athena.jpg` |
| II · aesir | `god-odin.jpg`, `god-skadi.jpg`, `god-loki.jpg` |
| III · netjer | `god-anubis.jpg`, `god-sekhmet.jpg` |
| IV · anunna | `god-inanna.jpg`, `god-nergal.jpg` |
| V · the choir | `god-michael.jpg` (the choir speaks with one voice) |
| VI · the legion | `god-belial.jpg`, `god-lilith.jpg` |
| VII · rodnova | `god-morana.jpg` |

Size: **760 × 900** or larger at the same 0.84:1 ratio.

## Ascendancy plates

Same slot as the god plates, same composition rules — they fill the left half of
the offer screen when a class forks, and again when its capstone is granted. Two
per class; any you skip fall back to the empty state.

| Class | Files |
| --- | --- |
| Warrior | `asc-samurai.jpg`, `asc-barbarian.jpg` |
| Marksman | `asc-elven.jpg`, `asc-sharpshooter.jpg` |
| Mage | `asc-decay.jpg`, `asc-elemental.jpg` |

Size: **760 × 900** or larger at the same 0.84:1 ratio.

## Throne backdrops (optional)

`throne-<id>.jpg`, ids as above (`throne-choir.jpg` and so on). Wired up in
`src/ui/art.ts` but not used by any of the three screens yet — they are here for
whenever the reliquary or the door-choice screen wants one.
