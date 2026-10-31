### 2026-10-31, chrome

- GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M6, Unspecified Version)`
- Browser: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`
- Page: 1920 x 1080 CSS px, devicePixelRatio 1; dynamic resolution timing: gpu
- Detection picked: **high** (the plan expects balanced)

Frame ms is wall / GPU timer, at the preset's fixed scale. Late = frames over 1.5x the target's budget. Live / clean GPU ms: what dynamic resolution's timer read in the live flyover against the clean GPU time; if live is far higher (at the same scale), dynamic resolution lowers the scale for nothing.

| Preset | AA | Target fps | Frame ms | Draw calls | Fly fps / p99 ms / % late | Fly end scale | Sail boost fps / p99 ms / % late | Sail end scale | Live / clean GPU ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high (picked by the page) | msaa | 30 | 2.8 / 2.07 at 1 | 28 | 144 / 7.9 / 0% | 1 | 144 / 7.8 / 0% | 1 | 3.5 / 2.07 |
| balanced | smaa | 60 | 2.06 / 1.59 at 0.85 | 27 | 144 / 7.9 / 0% | 0.85 | 144 / 8.6 / 0% | 0.85 | 3.3 / 1.59 |
| low | none | 60 | 1.62 / 1.01 at 0.67 | 22 | 144 / 8.7 / 0% | 0.67 | 144 / 8.7 / 0% | 0.67 | 3.7 / 1.01 |

Balanced, fixed scale (wall / GPU ms): 2.06 / 1.59 at 0.85; 1.63 / 1.04 at 0.6 (scale 0.6 saves 0.55 GPU ms); 1.96 / 1.47 without SMAA (SMAA costs 0.12 GPU ms).
