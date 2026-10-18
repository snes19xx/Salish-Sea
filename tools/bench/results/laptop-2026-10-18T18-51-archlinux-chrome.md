### 2026-10-18, chrome

- GPU: `ANGLE (Intel, Mesa Intel(R) Graphics (LNL), OpenGL ES 3.2)`
- Browser: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`
- Page: 1920 x 1080 CSS px, devicePixelRatio 1; dynamic resolution timing: gpu
- Detection picked: **balanced** (the plan expects balanced)

Frame ms is wall / GPU timer, at the preset's fixed scale. Late = frames over 1.5x the target's budget. Live / clean GPU ms: what dynamic resolution's timer read in the live flyover against the clean GPU time; if live is far higher (at the same scale), dynamic resolution lowers the scale for nothing.

| Preset | AA | Target fps | Frame ms | Fly fps / p99 ms / % late | Fly end scale | Sail boost fps / p99 ms / % late | Sail end scale | Live / clean GPU ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| balanced (picked by the page) | smaa | 60 | 6.81 / 5.03 at 0.85 | 120 / 8.4 / 0% | 0.85 | 120 / 8.7 / 0% | 0.85 | 6 / 5.03 |
| high | msaa | 30 | 11.1 / 8.06 at 1 | 100 / 19.4 / 0% | 1 | 80 / 21.2 / 0% | 1 | 9.8 / 8.06 |
| low | none | 60 | 6.95 / 3.21 at 0.67 | 120 / 8.5 / 0% | 0.67 | 120 / 8.4 / 0% | 0.67 | 4.6 / 3.21 |

Balanced, fixed scale (wall / GPU ms): 6.81 / 5.03 at 0.85; 6.32 / 3.43 at 0.6 (scale 0.6 saves 1.60 GPU ms); 8.94 / 4.83 without SMAA (SMAA costs 0.20 GPU ms).
