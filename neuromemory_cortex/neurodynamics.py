"""Deterministic, dimensioned computational-neuroscience *experiments*.

This module is intentionally isolated from the user's memory vault. Its LIF
units are milliseconds, millivolts, nanoamperes and megaohms: 1 MOhm * 1 nA
equals 1 mV. It does not claim to reproduce a human neuron or consciousness.
"""

from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class LIFParameters:
    tau_ms: float = 20.0
    resistance_mohm: float = 10.0
    rest_mv: float = -65.0
    threshold_mv: float = -50.0
    reset_mv: float = -65.0
    refractory_ms: float = 2.0
    dt_ms: float = 0.25

    def validate(self) -> None:
        values = tuple(vars(self).values())
        if not all(math.isfinite(value) for value in values):
            raise ValueError("LIF parameters must be finite.")
        if self.tau_ms <= 0 or self.resistance_mohm <= 0 or self.dt_ms <= 0:
            raise ValueError("Positive time constant, resistance and step required.")
        if self.dt_ms > self.tau_ms / 2:
            raise ValueError("Euler step must not exceed half the time constant.")
        if self.threshold_mv <= self.rest_mv or self.reset_mv >= self.threshold_mv:
            raise ValueError("Rest/reset must be below firing threshold.")
        if self.refractory_ms < 0:
            raise ValueError("Refractory period cannot be negative.")


def simulate_lif(current_na: float, duration_ms: float = 160.0,
                 params: LIFParameters | None = None) -> dict:
    """Forward-Euler integrate tau*dV/dt=Vrest-V+R*I.

    At each step, the state is advanced once; threshold crossing records the
    end-of-step spike time. Absolute refractory is modelled with V=Vreset.
    """
    p = params or LIFParameters()
    p.validate()
    if not math.isfinite(current_na) or not math.isfinite(duration_ms):
        raise ValueError("Stimulus and duration must be finite.")
    if duration_ms <= 0 or duration_ms > 60_000:
        raise ValueError("Duration must be between 0 and 60000 ms.")
    steps = round(duration_ms / p.dt_ms)
    if steps <= 0 or steps > 1_000_000 or not math.isclose(
        steps * p.dt_ms, duration_ms, rel_tol=0, abs_tol=1e-7
    ):
        raise ValueError("Duration must be a multiple of dt and under 1M steps.")
    v = p.rest_mv
    refractory_until = -math.inf
    trace = [v]
    spikes: list[float] = []
    for index in range(int(steps)):
        time_ms = (index + 1) * p.dt_ms
        if time_ms <= refractory_until + 1e-10:
            v = p.reset_mv
        else:
            dv = (p.rest_mv - v + p.resistance_mohm * current_na) * p.dt_ms / p.tau_ms
            v += dv
            if v >= p.threshold_mv:
                spikes.append(round(time_ms, 9))
                v = p.reset_mv
                refractory_until = time_ms + p.refractory_ms
        trace.append(v)
    return {
        "times_ms": [index * p.dt_ms for index in range(int(steps) + 1)],
        "voltage_mv": trace,
        "spikes_ms": spikes,
        "spike_count": len(spikes),
        "parameters": vars(p),
        "current_na": current_na,
    }


def stdp_delta(pre_ms: float, post_ms: float, *, a_plus: float = 0.015,
               a_minus: float = 0.018, tau_plus_ms: float = 20.0,
               tau_minus_ms: float = 20.0) -> float:
    """Simplified pair-based STDP update; not a fitted biological synapse.

    Positive post-pre timing potentiates, negative timing depresses.
    """
    values = (pre_ms, post_ms, a_plus, a_minus, tau_plus_ms, tau_minus_ms)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("STDP parameters must be finite.")
    if min(a_plus, a_minus) < 0 or min(tau_plus_ms, tau_minus_ms) <= 0:
        raise ValueError("Amplitudes must be nonnegative and windows positive.")
    delta_ms = post_ms - pre_ms
    if delta_ms > 0:
        return a_plus * math.exp(-delta_ms / tau_plus_ms)
    if delta_ms < 0:
        return -a_minus * math.exp(delta_ms / tau_minus_ms)
    return 0.0


def update_synaptic_weight(weight: float, pre_ms: float, post_ms: float) -> float:
    if not math.isfinite(weight) or not 0 <= weight <= 1:
        raise ValueError("Normalized synaptic weight must be in [0,1].")
    return min(1.0, max(0.0, weight + stdp_delta(pre_ms, post_ms)))
