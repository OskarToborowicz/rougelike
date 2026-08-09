# Mobile layout

The ECUMENE pass implements a design doc that is a fixed **1600×900 desktop
frame** and says nothing about touch. This file records what changed to make it
work on a phone, and what is still open.

The visual language is unchanged across every size — same palette, type,
materials and components. Only the **blocking** differs.

## What the phone layout does

**Both bottom corners belong to the thumbs.** The design puts the local shade
bottom-left and the allies bottom-right; the touch controls put the movement
stick and the four action buttons in exactly those two places. On a phone the
local plate docks to the **top-left** as a 56×72 thumbnail and the allies sit
**top-right** under the obol counter, at 44×56. Health still reads as shadow
rising up the plate at that size.

**The build readout survives.** An earlier pass hid `.e-shade-meta` wholesale,
which took the cast pips and the boon roundels with it — both are information
the player needs, not decoration. The name, the sworn line and the lore are the
parts that go; the pips and roundels stay, shrunk, beside the thumbnail.

**Ally plates carry a short label.** `P3 · MARKSMAN` does not fit a 44px column,
and truncating it to `P3 · M…` is worse than dropping the class, which the
plate's tint and portrait already carry. `addSeat` writes both forms and CSS
picks one.

**Portrait stacks the offer, landscape does not.** A landscape phone has width
to spare and almost no height, so stacking there would push the terms into a
150px slot and throw away the one dimension the frame has. Portrait gets the
sheet: god block as a header with top-aligned content, terms scrolling beneath.
Landscape keeps two columns and shrinks everything inside them.

**The terms always scroll** below 780px of height. Centring fixed-height content
in a fixed-height column is what used to push the third card — the rival, the
whole point of the round — off the bottom with no way to reach it.

Breakpoints, all in `ecumene.css`:

| Query | What it governs |
| --- | --- |
| `max-width: 1100px` | Desktop, but not roomy: smaller plates, shorter banner |
| `max-width: 900px` and `orientation: portrait` | Offer stacks into a sheet; title art fades behind the type |
| `max-width: 820px`, `max-height: 520px` | Phone HUD: plates move to the top, meta strip shrinks |
| `orientation: landscape` and `max-height: 560px` | Short frame: two-column offer, compressed title |
| `max-height: 780px` | Terms scroll |
| `body.touching` | Drops instructions a phone cannot follow (card numerals, "press 1 · 2 · 3") |

## Touch aiming

On touch the aim used to come from the **mouse position**, which on a phone is
wherever the cursor happened to land — so a shade driven with one thumb walked
sideways staring at a corner of the screen. Two changes:

- **Aim follows movement** when the right thumb is not down (`core/input.ts`).
  The right stick still overrides it, and still fires.
- **Aim assist** bends that aim onto whatever is already roughly in front
  (`core/aim.ts`), because a thumb points at about a third of the screen and for
  the ranged classes "a little wrong" is a clean miss. It is a cone, not a lock:
  point somewhere empty and nothing happens. Melee gets a 60% nudge inside 6.5m;
  ranged snaps inside 20m and a 49° cone. Never runs for mouse or gamepad.

## Still open

- **Portrait was built and verified, then deprioritised** in favour of landscape.
  It works, but it has had less exercise — the ally row in particular has only
  been checked with three seats, not four.
- The **concord prompt** sits at 42% height on phones to clear both thumbs. It
  has not been tested with a real second player on a touch device.
- No **safe-area insets**. A notched phone in landscape will put the local plate
  and the ally row under the notch; `viewport-fit=cover` is already set in
  `index.html`, so this wants `env(safe-area-inset-*)` on `.e-shades`,
  `.e-allies` and `#e-purse`.
