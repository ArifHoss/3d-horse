# Horse

A 100% procedural horse in the browser. No models, no textures, no animation
clips, no third-party assets — the body is meshed from a signed distance field
when the page loads, rigged from a joint table, and animated by procedural
gaits. Every vertex you see is generated at runtime.

Inspired by the procedural horse demo on typescript.dev.

```bash
npm install
npm run dev      # http://localhost:5178
npm run build    # static bundle in dist/
npm run preview  # serve the built bundle
```

## What it does

- **Stand · walk · trot · canter · gallop** — four real footfall patterns and a
  rear, cross-faded over a quarter second.
- **Orbit** the horse in 360°, scroll to zoom, or hit **360°** for a turntable.
- **X-ray** the skeleton, down to the bones driving the skin.
- **Five coats** — bay, chestnut, black, dapple grey, buckskin — with socks,
  a blaze and a star baked into the vertex colours.
- **Synthesised sound**: hoofbeats and wind, generated with WebAudio.

### Controls

| key | |
| --- | --- |
| `1`–`5` | stand · walk · trot · canter · gallop |
| `Space` / double-click | rear up |
| `X` | x-ray the skeleton |
| `C` | change coat |
| `R` | turntable |
| `S` | sound |
| `H` | hide the interface |
| drag · scroll | orbit · zoom |

URL parameters for stills: `?gait=gallop`, `?cam=x,y,z`, `?look=x,y,z`,
`?xray=1`, `?coat=2`, `?rear=1`, `?pause=1`, `?lite=1`, `?nohud=1`.

## How it is made

| stage | file |
| --- | --- |
| Anatomy — the horse as ~40 ellipsoids, cones and capsules | `src/horse/anatomy.ts` |
| Meshing — surface nets + Taubin smoothing + SDF normals and AO | `src/core/isosurface.ts` |
| Rigging — bones from the same joint table, automatic skin weights | `src/horse/rig.ts` |
| Gaits — footfall patterns, body motion, two-bone IK legs | `src/horse/gaits.ts` |
| The horse — mesh, hair, eyes, coat, animation controller | `src/horse/horse.ts` |
| Coat colour and markings | `src/horse/coat.ts` |
| Mane, forelock and tail | `src/horse/hair.ts` |
| Meadow — GPU grass that scrolls under the horse | `src/world/grass.ts` |
| Sky, light, palette | `src/world/sky.ts` |
| HUD | `src/ui/hud.ts` |
| Synthesised audio | `src/audio/sound.ts` |
| Skeleton overlay | `src/fx/skeleton.ts` |

**Anatomy.** The trunk and neck are chains of elliptical sections lofted into
overlapping ellipsoids, so the topline, barrel and flank are controlled
separately. Limbs are tapered round cones; the head is a chain of sections
along a 52° face axis. Everything is smooth-min blended with per-primitive
radii, so masses flow into each other instead of intersecting.

**Meshing.** The field is sampled on a ~0.02 m grid (~24k surface vertices),
extracted with naive surface nets, Taubin-smoothed to kill grid staircase,
projected back onto the isosurface with Newton steps, and given exact
SDF-gradient normals plus SDF ambient occlusion. That last part is what makes
the clay-shaded body read as muscle.

**Rigging.** A bone hierarchy is derived from the same joint table that placed
the anatomy: pelvis → spine → chest → neck → head, four legs of four bones,
three tail bones, two ears. Skin weights come from inverse-distance to the bone
segments, then six Laplacian smoothing passes over the mesh, keeping four
influences per vertex.

**Gaits.** A gait is a cadence, a duty factor, a stance travel per hoof and
four phase offsets. The horse runs on a treadmill: the field scrolls backwards
at exactly the speed the planted hooves move, so the feet never slide. The
kinematic chain is solved with two-bone IK from the shoulder (or hip) to the
fetlock, with the carpus folding backwards and the hock pointing back, a
scapula that rocks with the limb (a horse's reach comes from its shoulder
blade), and a pastern that keeps the hoof flat on the ground while it is
planted and lets it hang in swing. Body bob, pitch, sway, neck and head nod
are all driven off the same phase.

**Hair, coat.** Mane and tail are tapered ribbons skinned to the neck and tail
bones; their roots are anchored to the real skin by marching the distance field
outward. Coat colour is a function of the rest position: base colour, dark
points, dappled greys, noisy socks, a blaze along the face axis and a star on
the forehead, all multiplied by the baked ambient occlusion.

**The field.** ~235k grass blades in one buffer, one draw call. Each blade is
described by its root, bend, height and level; the vertex shader does the wind,
the wrap modulo the tile (so the meadow is endless) and the fade at the edge of
the field.

## Tuning

- Shape: `BODY`, `NECK` and `headPrims()` in `anatomy.ts` — they are plain
  tables of topline/bottom/half-width sections, and the joint table
  (`joints()`) is what the rig follows.
- Gait feel: the `GAITS` record in `gaits.ts` — cadence, duty, stance, lift,
  bob and nod amplitudes.
- Look: `DAY` in `sky.ts` (the whole palette follows from it), `COATS` in
  `coat.ts`.
- Cost: `?lite=1`, or `createGrass({ count })` in `main.ts`.

## Known limits

- The treadmill means the horse never actually travels through the world; the
  meadow scrolls under it. Steering is therefore not modelled.
- The front leg is almost straight at rest (as a real horse's is), so the
  longest strides are clamped by the shoulder shift rather than by a full
  scapula simulation.
- Sound is synthesised from noise and oscillators, not recorded.
- No shadows cast by the grass, and no contact dust yet.

## Layout

```
index.html            page shell
src/main.ts           app: renderer, scene, HUD wiring, loop
src/lab.ts            dev page: horse + orbit + skeleton overlay
src/debug.ts          dev page: four-view mesh inspection
```
