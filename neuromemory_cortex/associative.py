"""Small transparent Hopfield associative-memory baseline for synthetic tests.

Recall is deterministic, asynchronous, sign-valued and energy-monotone.
The weights are not fitted synapses and this is not a model of a real person.
"""

from __future__ import annotations

from dataclasses import dataclass
import math


def _validate_pattern(pattern: tuple[int, ...], width: int) -> None:
    if len(pattern) != width or any(bit not in (-1, 1) for bit in pattern):
        raise ValueError("Patterns must be equal-length tuples of -1/+1.")


@dataclass(frozen=True)
class RecallResult:
    state: tuple[int, ...]
    sweeps: int
    converged: bool
    energies: tuple[float, ...]


class HopfieldMemory:
    """Hebbian weights with zero diagonal; suitable only for small experiments."""

    def __init__(self, patterns: list[tuple[int, ...]]):
        if not patterns:
            raise ValueError("At least one synthetic pattern is required.")
        width = len(patterns[0])
        if not 2 <= width <= 256:
            raise ValueError("Number of units must be between 2 and 256.")
        for pattern in patterns:
            _validate_pattern(pattern, width)
        self.width = width
        self.weights = tuple(tuple(
            0.0 if i == j else sum(p[i] * p[j] for p in patterns) / width
            for j in range(width)
        ) for i in range(width))

    def energy(self, state: tuple[int, ...]) -> float:
        _validate_pattern(state, self.width)
        return -0.5 * math.fsum(
            self.weights[i][j] * state[i] * state[j]
            for i in range(self.width) for j in range(self.width)
        )

    def recall(self, cue: tuple[int, ...], max_sweeps: int = 32) -> RecallResult:
        _validate_pattern(cue, self.width)
        if not 1 <= max_sweeps <= 1000:
            raise ValueError("Invalid sweep budget.")
        state = list(cue)
        energies = [self.energy(tuple(state))]
        for sweep in range(1, max_sweeps + 1):
            changed = False
            for i in range(self.width):
                field = math.fsum(self.weights[i][j] * state[j] for j in range(self.width))
                next_bit = 1 if field > 0 else -1 if field < 0 else state[i]
                if next_bit != state[i]:
                    state[i] = next_bit
                    changed = True
            energies.append(self.energy(tuple(state)))
            if not changed:
                return RecallResult(tuple(state), sweep, True, tuple(energies))
        return RecallResult(tuple(state), max_sweeps, False, tuple(energies))


def synthetic_neural_demo() -> dict:
    """Repeatable read-only demo; neither personal sources nor a model call."""
    from .neurodynamics import simulate_lif, stdp_delta

    original = (1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, -1,
                1, -1, -1, 1, 1, -1, 1, 1, -1, -1, 1, -1)
    cue = list(original)
    cue[3] *= -1
    cue[17] *= -1
    network = HopfieldMemory([original])
    result = network.recall(tuple(cue))
    trace = simulate_lif(2.2, duration_ms=160.0)
    return {
        "mode": "synthetic_only",
        "personal_data_used": False,
        "neuron_model": "LIF / forward Euler",
        "lif_spikes": trace["spike_count"],
        "lif_trace_sample_mv": [round(v, 2) for v in trace["voltage_mv"][::16]],
        "synaptic_model": "pair-based STDP",
        "stdp_potentiation": round(stdp_delta(10, 20), 6),
        "stdp_depression": round(stdp_delta(20, 10), 6),
        "associative_model": "Hebbian Hopfield network",
        "pattern_size": len(original),
        "corrupted_bits": 2,
        "recovered_bits": sum(a == b for a, b in zip(original, result.state)),
        "converged": result.converged,
        "energy_before": round(result.energies[0], 6),
        "energy_after": round(result.energies[-1], 6),
        "scientific_status": "toy computational models, not a human-brain simulation",
    }
