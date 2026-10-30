"""Source-level UI guardrails (not a substitute for real browser QA)."""

from html.parser import HTMLParser
from pathlib import Path
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
        self.assertTrue({"neural-canvas", "field-pause", "run-neural-demo", "field-readout"}
                        .issubset(parser.ids))

    def test_assets_are_local_and_no_automatic_external_scripts(self):
        parser = ElementInventory()
        parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))
        self.assertEqual(parser.scripts, ["/app.js"])
        self.assertEqual(parser.stylesheets, ["/styles.css"])

    def test_visualization_declares_synthetic_boundary_and_reduced_motion(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "styles.css").read_text(encoding="utf-8")
        js = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("合成神经网络可视化", html)
        self.assertIn("prefers-reduced-motion", js)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn('request("/api/neural-demo")', js)


if __name__ == "__main__":
    unittest.main()
