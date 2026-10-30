# NeuroMemory Cortex v0.3 · Design QA

**final result: blocked**

- **Source visual truth:** user-provided screenshot in this conversation, depicting airy off-white canvas, a dense central neural-looking constellation, four smaller satellite groups and very little UI chrome. No personal screenshots are copied into the public repository.
- **Implementation:** `neuromemory_cortex/ui/index.html`, `styles.css`, `morphology.js`, `app.js`.
- **Intended viewport:** desktop 1440–2048 CSS px wide, and mobile 375–760 CSS px.
- **Source pixels/density:** original uploaded image was shown in chat; its capture metadata was not independently inspected in this pass.
- **Implementation screenshot, pixels and density:** unavailable. Browser capture could not start because the Playwright Chromium executable is absent and a browser download failed with a corrupted ZIP.
- **Compared state:** expected default synthetic scene, no user data. This state has not been rendered in a browser during the present QA pass.
- **Full-view comparison evidence:** not available; therefore no fidelity pass has been awarded.
- **Focused comparison evidence:** not available for same reason.

## Findings

- **[P1, verification blocker] Real browser visual comparison missing.** We cannot yet verify actual neurite shape, canvas rendering frame time, responsive rail, input focus or scroll behavior. **Fix:** on Windows run the local app, capture identical desktop view and a narrower view, and test drag/zoom/SWC input.
- **[P2, research limitation] Synthetic branch statistics have no dataset fit.** Structural analogy is useful, but cannot support claims about real dendritic morphometrics. **Fix:** add attributed, licensed SWC samples and compare arbor geometry to source reference viewers.
- **[P2, rendering limitation] Canvas 2D perspective stroke widths are not actual 3D cylinders.** **Fix:** WebGL tapered tubes/meshes and a verified LOD benchmark in subsequent stages.

## Required fidelity surfaces (pending screenshot verification)

| Surface | Code inspection | Visual verdict |
|---|---|---|
| Typography | System sans, Georgia label; original large headings reduced | Pending |
| Layout rhythm | 82 px desktop rail; more hero-space for morphology; flat sections | Pending |
| Color tokens | Neutral graphite/off-white with one restrained pulse accent | Pending |
| Image/geometry quality | New deterministic 3D morphology sampler, local SWC import, radius-aware strokes | Pending |
| Copy/content | Explicit synthetic-vs-recorded disclaimer, no claims of consciousness | Pending |

## Implementation checklist

1. Render actual Windows Chrome screenshot at the reference viewport, compare side-by-side to the supplied image.
2. Confirm no console errors, 30 FPS cap, touch/keyboard/zoom/reduced-motion and source file loading states.
3. Repeat at mobile width and high Windows display scaling; fix clipping/contrast if found.
4. Upgrade this report to `passed` only when browser evidence is recorded and P0/P1/P2 visual deviations are resolved.

This is **not** a release approval, and unit tests do not substitute for visual QA.
