# Mobile layout — known gaps

The ECUMENE pass (`ecumene.css`, `hud.ts`, `menu.ts`) implements the design doc,
which is a fixed **1600×900 desktop frame**. It says nothing about touch, and the
game does ship a touch build (`core/touch.ts`, `body.touching`).

Verified at **375×812** with the touch pad forced on. The visual language itself
carries over fine — amber on smoke, Marcellus/Garamond/Karla, the struck-metal
roundels and the shadow-rising-up-a-portrait health all read at phone size. What
does not carry over is the **blocking**. Three real problems, in priority order.

## 1. The portrait plate sits under the left thumb

The design puts the local shade bottom-left and allies bottom-right. The touch
controls put the movement stick bottom-left and the DASH/SPEC/CAST/CALL cluster
bottom-right. At 375px the plate (132×168 below the 1100px breakpoint) covers
roughly a fifth of the screen exactly where the moving thumb goes.

Input still works — `#ui` is `pointer-events: none`, so touches pass straight
through — but you steer with your thumb on top of your own portrait. In co-op the
ally plates land directly on the four action buttons.

**Proposed:** shrink the local plate to a ~64px thumbnail docked under the top
banner, keeping the shadow-health idea at small scale; allies become a row of
small plates along the top edge. Both bottom corners go back to being thumbs.

## 2. The build readout disappears entirely

`ecumene.css` `@media (max-width: 700px)` hides `.e-shade-meta`, which takes the
name, the sworn line, **the cast pips and the boon roundels** with it. The pips
are load-bearing — they are the only display of remaining Cast ammo — and the
roundels are the only display of what boons are held. Dropping them bought space
at the cost of information the player needs.

**Proposed:** bring both back as a compact strip beside the docked thumbnail. The
name and sworn line can stay hidden on a phone; the pips and roundels cannot.

## 3. The offer screen clips at both ends

Below the 900px breakpoint `.e-offer` stacks vertically: `.e-offer-god` at 34%
height, `.e-offer-terms` beneath. Two failures:

- `.e-god-body` is anchored `bottom: 56px` inside a short box, so it overflows
  *upward* — the throne line above the god's name is cut off above the fold.
- `.e-offer-terms` is `justify-content: center` at a fixed height with no
  `overflow`, so content taller than the column bleeds past both edges instead of
  scrolling. Measured: three cards at 155 / 200 / 158px in a 671px column, and
  the third card still ran off the bottom.

On a rival round the clipped card is the third one — which is the rival, the
whole point of the mechanic.

**Proposed:** make it a sheet. God block as a fixed header at ~28vh with its own
content top-aligned, terms scrolling under it (`overflow-y: auto`, no centring),
cards full-width, `.e-card-kicker` forced to one line.

## Also worth clearing while in there

`hud.css` still carries `@media (max-width: 760px)` and `@media (max-height:
460px)` blocks written for the old bar-based HUD. Most of what they target
(`.seat`, `.bar`, `.pips`, `.callbar`, `.boons`) is either gone or now hidden by
`ecumene.css`. They are dead weight and will mislead whoever touches this next.

## Not a second design

Everything above is re-blocking, not re-styling. Tokens, type, materials and
component looks stay exactly as they are — the work lands almost entirely in
`ecumene.css` media queries plus a couple of markup hooks in `hud.ts` so the
plate and the meta strip can be reparented for small screens.
