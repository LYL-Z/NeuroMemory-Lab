# Contributing to NeuroMemory Cortex

## Science and privacy are acceptance conditions

1. Open pull requests with a specific hypothesis or bug reproduction, not only an impressive visual claim.
2. Clearly label `biological_observation`, `computational_model`, and `engineering_hypothesis` when proposing scientific modules.
3. Never commit personal memories, chat exports, uploaded medical records, cloud API keys, secrets or private database artifacts.
4. Tests must use self-contained fictional/synthetic samples. No external calls in the default test suite.
5. Keep experiment outputs reproducible: algorithm version, parameters, seeds, units, thresholds, expected invariants, limits and failed cases.
6. Model-suggested personality traits or self-description may never be promoted to confirmed memory without user review.
7. If a change affects private data access, specify its threat model and test authorization failures.

Run:

```bash
python -B -m unittest discover -s tests -v
node --check neuromemory_cortex/ui/app.js
```

## Repository status

This is a public **research prototype**, not a clinical tool or a simulation of consciousness. The public repository contains source code and explicitly fictional fixtures only. Public visibility does not imply an open-source license; licensing must be decided by the repository owner.
