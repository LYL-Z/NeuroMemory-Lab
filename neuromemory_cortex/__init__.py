"""NeuroMemory Cortex: local-first, provenance-centered personal memory research."""

__version__ = "0.4.0"

from .vault import MemoryVault, VaultError

__all__ = ["MemoryVault", "VaultError"]
