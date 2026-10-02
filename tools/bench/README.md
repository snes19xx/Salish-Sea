# Pilot benchmarks

Scripts that open the pilot in a real Firefox window at 1920 x 1080 (the development monitor runs at
144 Hz, so a frame is 6.9 ms) and measure it. They need the local server running from the project
root and `?debug`, which they add themselves.

```bash
cd tools/bench && npm install          # once; puppeteer-core drives the installed Firefox
node interact.mjs                      # frame pacing: flying, sailing, steering, dragging
node breakdown.mjs 0.02                # GPU cost of each part at a point on the route
node flytour.mjs                       # GPU time + screenshots along the route, live pacing
node sailbench.mjs 10                  # Sail mode after 10 s of boost: GPU with and without the wake
node treelag.mjs 25                    # do the tree rings keep up during 25 s of boost?
node maptest.mjs                       # minimap zoom, chart (M), zoom/drag, click to sail there
node shot.mjs name "" "P.setFly(0.2); 9000"   # screenshots after running JS (P = window.pilot)
```

Pass a query string to test a variant, e.g. `node breakdown.mjs 0.02 stride=2` (for `sailbench`
and `treelag` the query string comes after the seconds).

**The web app.** Every script also runs against the Vite app in `web/` (start it with
`npm run dev` in `web/`): prefix it with `APP=web`, e.g. `APP=web node breakdown.mjs 0.02`. Add
`BASE=http://127.0.0.1:4173` to measure a production build served by `npm run preview`.

```bash
node compare.mjs && APP=web node compare.mjs              # the same 5 views drawn by both
mamba run -n geo_env python tools/bench/imgdiff.py        # per-view pixel difference + heat maps
```

`compare.mjs` holds the camera at five spots (three flyover points at 19:20 and noon, the Sail
start, a night view), stops the loop and draws one frame at a fixed time; the pilot run records
the camera poses and the web run reuses them. On 1 Oct 2026 the port matched the pilot to a mean
difference under 0.1 of 255 per pixel, with under 0.12% of pixels differing by more than 8 (thin
edges in the reflection, and the boat, whose bobbing follows the clock).

`sailbench` also draws the frame with the wake's chunk skipping turned off (`allChunks`, the cost
of walking all 96 track segments) and checks the two images match (`pixelsDiff` should be 0).
`treelag` reports, per tree ring, the largest camera distance from the ring's centre as a share of
its margin (`worstShare`); above 1, trees at the far edge go missing.

Reference numbers (6 Aug 2026, M6 Mac mini, Firefox 159, with the new trees, boat, wake and haze):
GPU 4.0-4.9 ms along the flyover route; Sail mode 5.5 ms at 45 kn, of which the wake is 0.5 ms
(2.6 ms before the chunk skipping); steady 144 fps everywhere, 0% of frames over 8 ms. At 45 kn
the tree rings stay within 52% of their margin (rebuilds: near 35 ms, far 97 ms). The web app
(three r187) costs the same: `breakdown 0.02` 5.17 ms against the pilot's 5.13 ms (201 draw calls
each), Sail at 45 kn 5.47 against 5.43 ms.

When the session is driven remotely with the monitor switched off, the display reports 60 Hz, so
pacing reads a steady 60 fps; the GPU times are unaffected.
