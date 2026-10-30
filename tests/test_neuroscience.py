"""Independent synthetic-only computational-neuroscience verification."""

import math
import contextlib
from io import StringIO
import json
import sys
import unittest
from unittest.mock import patch

from neuromemory_cortex.associative import HopfieldMemory, synthetic_neural_demo
from neuromemory_cortex.neurodynamics import (
    LIFParameters, simulate_lif, stdp_delta, update_synaptic_weight,
)


class NeuralCliIndependenceTest(unittest.TestCase):
    def test_demo_never_initializes_a_memory_vault(self):
        from neuromemory_cortex.cli import main

        output = StringIO()
        with patch.object(sys, "argv", ["neuromemory_cortex", "neural-demo"]), \
             patch("neuromemory_cortex.cli.MemoryVault", side_effect=AssertionError("vault touched")), \
             contextlib.redirect_stdout(output):
            main()
        self.assertFalse(json.loads(output.getvalue())["personal_data_used"])


class NeuralDynamicsTest(unittest.TestCase):
    def test_lif_without_input_stays_at_rest(self):
        result = simulate_lif(0.0, 30.0)
        self.assertEqual(result["spike_count"], 0)
        self.assertTrue(all(v == -65.0 for v in result["voltage_mv"]))

    def test_lif_subthreshold_steady_state(self):
        result = simulate_lif(1.0, 1000.0)
        self.assertEqual(result["spike_count"], 0)
        self.assertAlmostEqual(result["voltage_mv"][-1], -55.0, places=2)

    def test_lif_spikes_and_refractory(self):
        result = simulate_lif(2.2, 160.0)
        self.assertGreater(result["spike_count"], 0)
        self.assertTrue(all(b - a >= 2 for a, b in zip(result["spikes_ms"], result["spikes_ms"][1:])))

    def test_lif_rejects_invalid_numerics_and_steps(self):
        with self.assertRaises(ValueError):
            simulate_lif(float("nan"))
        with self.assertRaises(ValueError):
            simulate_lif(1.0, params=LIFParameters(dt_ms=15.0))
        with self.assertRaises(ValueError):
            simulate_lif(1.0, duration_ms=1.03)

    def test_stdp_sign_and_time_window(self):
        self.assertGreater(stdp_delta(10, 20), 0)
        self.assertLess(stdp_delta(20, 10), 0)
        self.assertAlmostEqual(stdp_delta(10, 10), 0.0)
        self.assertGreater(stdp_delta(10, 20), stdp_delta(10, 90))

    def test_stdp_weights_are_clipped(self):
        self.assertLessEqual(update_synaptic_weight(0.999, 10, 20), 1)
        self.assertGreaterEqual(update_synaptic_weight(0.001, 20, 10), 0)


class AssociativeMemoryTest(unittest.TestCase):
    def test_hopfield_recovers_partial_cue(self):
        stored = (1, 1, 1, 1, -1, -1, -1, -1, 1, 1, -1, -1)
        network = HopfieldMemory([stored])
        damaged = list(stored)
        damaged[0] *= -1
        result = network.recall(tuple(damaged))
        self.assertEqual(result.state, stored)
        self.assertTrue(result.converged)

    def test_hopfield_energy_nonincreasing(self):
        stored = (1, 1, 1, -1, -1, -1, 1, -1, 1, -1, 1, -1)
        result = HopfieldMemory([stored]).recall(tuple(-v if i == 2 else v for i, v in enumerate(stored)))
        for before, after in zip(result.energies, result.energies[1:]):
            self.assertLessEqual(after, before + 1e-8)

    def test_invalid_patterns_rejected(self):
        with self.assertRaises(ValueError):
            HopfieldMemory([(1, 0, 1)])
        with self.assertRaises(ValueError):
            HopfieldMemory([(1, 1), (1,)])

    def test_demo_contains_only_synthetic_fields(self):
        demo = synthetic_neural_demo()
        self.assertFalse(demo["personal_data_used"])
        self.assertTrue(demo["converged"])
        self.assertEqual(demo["recovered_bits"], demo["pattern_size"])
        self.assertGreater(demo["lif_spikes"], 0)


if __name__ == "__main__":
    unittest.main()
