"""Exercise HTTP security and import with synthetic bytes on loopback only."""

import base64
from http.server import ThreadingHTTPServer
from pathlib import Path
import json
import tempfile
from threading import Thread
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from neuromemory_cortex.server import make_handler
from neuromemory_cortex.vault import MemoryVault


class HttpTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="neuro-http-test-")
        self.vault = MemoryVault(Path(self.temp.name) / "vault")
        self.token = "test-token-is-not-production"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.vault, self.token))
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.vault.close()
        self.temp.cleanup()

    def _post(self, path, data, *, token=True, origin=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-NeuroMemory-Token"] = self.token
        if origin:
            headers["Origin"] = origin
        request = Request(self.base + path, data=json.dumps(data).encode(), headers=headers, method="POST")
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_no_token_no_mutation(self):
        status, _ = self._post("/api/import", {"name": "synthetic.txt"}, token=False)
        self.assertEqual(status, 403)
        self.assertEqual(self.vault.stats()["active_sources"], 0)

    def test_cross_origin_mutation_refused(self):
        status, _ = self._post("/api/import", {"name": "synthetic.txt"},
                               origin="https://untrusted.invalid")
        self.assertEqual(status, 403)

    def test_missing_consent_refused(self):
        status, _ = self._post("/api/import", {"name": "synthetic.txt",
                              "content_base64": base64.b64encode(b"synthetic text").decode(),
                              "consent": False})
        self.assertEqual(status, 400)

    def test_valid_synthetic_import_and_search(self):
        synthetic = "虚构的天空有三颗星星。".encode("utf-8")
        status, obj = self._post("/api/import", {"name": "synthetic.txt",
                              "content_base64": base64.b64encode(synthetic).decode(),
                              "consent": True})
        self.assertEqual(status, 200)
        self.assertFalse(obj["duplicate"])
        lookup = Request(self.base + "/api/search?q=%E5%A4%A9%E7%A9%BA%E6%9C%89",
                         headers={"X-NeuroMemory-Token": self.token})
        with urlopen(lookup, timeout=3) as response:
            result = json.load(response)
        self.assertEqual(len(result["items"]), 1)

    def test_private_get_endpoint_requires_token(self):
        with self.assertRaises(HTTPError) as context:
            urlopen(self.base + "/api/sources", timeout=3)
        self.assertEqual(context.exception.code, 403)

    def test_neural_demo_is_synthetic_and_read_only(self):
        request = Request(self.base + "/api/neural-demo",
                          headers={"X-NeuroMemory-Token": self.token})
        with urlopen(request, timeout=3) as response:
            data = json.load(response)
        self.assertFalse(data["personal_data_used"])
        self.assertGreater(data["lif_spikes"], 0)
        self.assertEqual(data["recovered_bits"], data["pattern_size"])
        self.assertEqual(self.vault.stats()["active_sources"], 0)

    def test_invalid_host_rejected(self):
        request = Request(self.base + "/api/health", headers={"Host": "untrusted.invalid"})
        with self.assertRaises(HTTPError) as context:
            urlopen(request, timeout=3)
        self.assertEqual(context.exception.code, 403)

    def test_ui_has_session_token_and_no_remote_assets(self):
        with urlopen(self.base + "/", timeout=3) as response:
            html = response.read().decode("utf-8")
        self.assertIn(self.token, html)
        self.assertIn('href="/styles.css"', html)
        self.assertIn('src="/app.js"', html)
        self.assertNotIn('src="https://', html)


if __name__ == "__main__":
    unittest.main()
