"""Source-level UI guardrails (not a substitute for real browser QA)."""

from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1] / "neuromemory_cortex" / "ui"


class ElementInventory(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.scripts = []
        self.stylesheets = []

    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if props.get("id"):
            self.ids.add(props["id"])
        if tag == "script":
            self.scripts.append(props.get("src"))
        if tag == "link" and props.get("rel") == "stylesheet":
            self.stylesheets.append(props.get("href"))


class UiStaticTest(unittest.TestCase):
    def test_neural_visualization_and_controls_exist(self):
        parser = ElementInventory()
        parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))
        self.assertTrue({"neural-canvas", "field-pause", "run-neural-demo", "field-readout",
                         "morph-provenance", "morph-integrity", "morph-engine"}
                        .issubset(parser.ids))

    def test_assets_are_local_and_no_automatic_external_scripts(self):
        parser = ElementInventory()
        parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))
        self.assertEqual(parser.scripts, ["/morphology.js", "/morphology3d.js", "/app.js"])
        self.assertEqual(parser.stylesheets, ["/styles.css"])

    def test_visualization_declares_synthetic_boundary_and_reduced_motion(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "styles.css").read_text(encoding="utf-8")
        js = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("合成神经网络可视化", html)
        self.assertIn("prefers-reduced-motion", js)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn('request("/api/neural-demo")', js)

    def test_swc_file_viewer_is_local_and_geometry_is_separate(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        js = (ROOT / "morphology.js").read_text(encoding="utf-8")
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="swc-picker"', html)
        self.assertIn("function parseSWC(source)", js)
        self.assertIn("makeSynthetic", js)
        self.assertIn("prefers-reduced-motion", app)
        self.assertIn("await file.text()", app)
        self.assertNotIn("fetch(", js)

    @unittest.skipUnless(shutil.which("node"), "Node.js not installed on test runner")
    def test_morphology_parser_and_deterministic_synthetic_geometry(self):
        test = r"""
const assert = require('node:assert/strict');
const m = require('./morphology.js');
const parsed = m.parseSWC('# synthetic test-only fixture\n1 1 0 0 0 6 -1\n2 4 0 10 0 1 1\n3 3 10 0 0 1 1\n');
assert.equal(parsed.count, 3);
assert.equal(parsed.segments.length, 2);
assert.equal(parsed.somas.length, 1);
assert.equal(parsed.verified, false);
assert.equal(parsed.segments[0].type, 4);
assert.equal(parsed.originalNodes.length, 3);
assert.equal(parsed.roots, 1);
assert.equal(parsed.originalNodes[1].parent, 1);
assert.ok(parsed.normalization.factor > 0);
assert.throws(() => m.parseSWC('1 1 0 0 0 1 -1\n2 3 0 0 0 1 3\n3 3 0 0 0 1 2'), /循环/);
assert.throws(() => m.parseSWC('1 1 0 0 0 1 -1\n1 2 2 0 0 1 -1'), /重复/);
assert.throws(() => m.parseSWC('1 1 0 0 0 1 -1\n2 3 0 1 0 1 9'), /不存在/);
assert.throws(() => m.parseSWC('1 1 0 0 0 0 -1'), /不合法/);
const a = m.makeSynthetic(4321);
const b = m.makeSynthetic(4321);
assert.ok(a.segments.length > 1000);
assert.deepEqual(a.segments.slice(0, 6), b.segments.slice(0, 6));
assert.equal(a.verified, false);
"""
        result = subprocess.run(["node", "-e", test], cwd=ROOT,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(shutil.which("node"), "Node.js not installed on test runner")
    def test_webgl_mesh_is_deterministic_and_geometry_is_finite(self):
        test = r"""
const assert = require('node:assert/strict');
const m = require('./morphology.js');
const gpu = require('./morphology3d.js');
const geometry = m.makeSynthetic(413);
const a = gpu.buildInstances(geometry);
const b = gpu.buildInstances(m.makeSynthetic(413));
assert.equal(a.segmentCount, geometry.segments.length);
assert.equal(a.somaCount, geometry.somas.length);
assert.deepEqual(a.segments, b.segments);
assert.equal(gpu.makeTubeMesh(8).length, 8*6*6);
assert.equal(gpu.makeSphereMesh().length, 10*16*6*6);
assert.ok(a.segments.every(Number.isFinite));
assert.throws(() => gpu.makeTubeMesh(2), /Invalid/);
assert.throws(() => gpu.buildInstances({segments:[{a:[0,0,0],b:[1,0,0],r0:-1,r1:1}],somas:[]}), /Invalid/);
"""
        result = subprocess.run(["node", "-e", test], cwd=ROOT,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(shutil.which("node"), "Node.js not installed on test runner")
    def test_lif_activity_is_interpolated_without_claiming_swc_fitting(self):
        test = r"""
const assert = require('node:assert/strict');
const gpu = require('./morphology3d.js');
const trace = {times_ms:[0,10,20],voltage_mv:[-65,-45,-65],morphology_fitted:false};
assert.equal(gpu.sampleTrace(trace,5),-55);
assert.equal(gpu.sampleTrace(trace,15),-55);
assert.equal(gpu.sampleTrace(trace,25),-55);
assert.equal(gpu.sampleTrace(null,10),null);
assert.equal(gpu.sampleTrace({times_ms:[1],voltage_mv:[]},10),null);
"""
        result = subprocess.run(["node", "-e", test], cwd=ROOT,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
