### 2026-10-15, chrome

- GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M6, Unspecified Version)`
- Browser: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`
- Page: 1920 x 1080 CSS px, devicePixelRatio 1; dynamic resolution timing: gpu
- Detection picked: **high** (the plan expects balanced)

Frame ms is wall / GPU timer, at the preset's fixed scale. Late = frames over 1.5x the target's budget. Live / clean GPU ms: what dynamic resolution's timer read in the live flyover against the clean GPU time; if live is far higher (at the same scale), dynamic resolution lowers the scale for nothing.

| Preset | AA | Target fps | Frame ms | Fly fps / p99 ms / % late | Fly end scale | Sail boost fps / p99 ms / % late | Sail end scale | Live / clean GPU ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high (picked by the page) | msaa | 30 | 3.94 / 2.2 at 1 | 60 / 18.6 / 0% | 1 | 60 / 18.6 / 0% | 1 | 4 / 2.2 |
| balanced | smaa | 60 | 3.78 / 1.83 at 0.85 | 60 / 18.5 / 0% | 0.85 | 60 / 18.6 / 0% | 0.85 | 5.3 / 1.83 |
| low | none | 60 | 2.98 / 1.13 at 0.67 | 60 / 18.4 / 0% | 0.67 | 60 / 18.5 / 0% | 0.67 | 3.2 / 1.13 |

Balanced, fixed scale (wall / GPU ms): 3.78 / 1.83 at 0.85; 2.92 / 1.17 at 0.6 (scale 0.6 saves 0.66 GPU ms); 3.46 / 1.71 without SMAA (SMAA costs 0.12 GPU ms).
