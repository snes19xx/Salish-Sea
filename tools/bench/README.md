# Pilot benchmarks

Scripts that open the pilot in a real Firefox window at 1920 x 1080 (the development monitor runs at
144 Hz, so a frame is 6.9 ms) and measure it. They need the local server running from the project
root and `?debug`, which they add themselves.

```bash
cd tools/bench && npm install          # once; puppeteer-core drives the installed Firefox
node interact.mjs                      # frame pacing: flying, sailing, steering, dragging
node breakdown.mjs 0.02                # GPU cost of each part at a point on the route
node flytour.mjs                       # GPU time + screenshots along the route, live pacing
```

Pass a query string to test a variant, e.g. `node breakdown.mjs 0.02 stride=2`.

Reference numbers (5 May 2026, M6 Mac mini, Firefox 159): GPU 4.1-4.9 ms along the route,
steady 144 fps everywhere, 0% of frames over 8 ms.
