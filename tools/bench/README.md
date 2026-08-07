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
```

Pass a query string to test a variant, e.g. `node breakdown.mjs 0.02 stride=2` (for `sailbench`
and `treelag` the query string comes after the seconds).

`sailbench` also draws the frame with the wake's chunk skipping turned off (`allChunks`, the cost
of walking all 96 track segments) and checks the two images match (`pixelsDiff` should be 0).
`treelag` reports, per tree ring, the largest camera distance from the ring's centre as a share of
its margin (`worstShare`); above 1, trees at the far edge go missing.

Reference numbers (6 Aug 2026, M6 Mac mini, Firefox 159, with the new trees, boat, wake and haze):
GPU 4.0-4.9 ms along the flyover route; Sail mode 5.5 ms at 45 kn, of which the wake is 0.5 ms
(2.6 ms before the chunk skipping); steady 144 fps everywhere, 0% of frames over 8 ms. At 45 kn
the tree rings stay within 52% of their margin (rebuilds: near 35 ms, far 97 ms).
