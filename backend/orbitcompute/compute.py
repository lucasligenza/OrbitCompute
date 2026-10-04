"""Accelerator compute power model (MODEL). See docs/SCIENCE.md §6.

P_compute = overhead * [N * P_idle + sum_alloc k * (P_max - P_idle) * s]
Throughput and dynamic power both scale linearly with the clock factor s.
"""

from __future__ import annotations

from .schema import ComputeConfig


def idle_kw(c: ComputeConfig) -> float:
    return c.accelerator_count * c.idle_w * c.host_overhead / 1000.0


def dynamic_kw_per_accel(c: ComputeConfig, s: float = 1.0) -> float:
    return (c.max_w - c.idle_w) * c.host_overhead * s / 1000.0


def max_kw(c: ComputeConfig) -> float:
    return c.accelerator_count * c.max_w * c.host_overhead / 1000.0


def capacity_ref(c: ComputeConfig) -> float:
    """Nominal capacity in reference accelerators (throughput-weighted count)."""
    return c.accelerator_count * c.relative_throughput
