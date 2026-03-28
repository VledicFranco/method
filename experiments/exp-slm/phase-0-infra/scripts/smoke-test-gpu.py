#!/usr/bin/env python3
"""
Phase 0 — GPU smoke test.

Detects NVIDIA GPU via torch.cuda, reports hardware details,
and asserts at least 1 GPU with >= 10 GB free VRAM.

Results are written to phase-0-infra/results/infra-report.json.
Exit 0 on pass, 1 on fail.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
REPORT_PATH = RESULTS_DIR / "infra-report.json"

MIN_FREE_VRAM_GB = 10.0


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    # -----------------------------------------------------------
    # 1. Verify torch is importable
    # -----------------------------------------------------------
    try:
        import torch  # type: ignore[import-untyped]
    except ImportError:
        fail(
            "torch is not installed. "
            "Install the Python environment first: pip install -e '.[dev]' "
            "from experiments/exp-slm/"
        )

    # -----------------------------------------------------------
    # 2. Check CUDA availability
    # -----------------------------------------------------------
    if not torch.cuda.is_available():
        fail("torch.cuda.is_available() returned False — no GPU detected.")

    device_count = torch.cuda.device_count()
    if device_count == 0:
        fail("torch.cuda.device_count() returned 0.")

    # -----------------------------------------------------------
    # 3. Gather per-device info
    # -----------------------------------------------------------
    devices: list[dict] = []
    any_pass = False

    for idx in range(device_count):
        props = torch.cuda.get_device_properties(idx)
        mem_total = props.total_mem / (1024**3)  # GB
        mem_free = (props.total_mem - torch.cuda.memory_reserved(idx)) / (1024**3)

        device_info = {
            "index": idx,
            "name": props.name,
            "compute_capability": f"{props.major}.{props.minor}",
            "vram_total_gb": round(mem_total, 2),
            "vram_free_gb": round(mem_free, 2),
            "cuda_version": torch.version.cuda or "unknown",
        }
        devices.append(device_info)

        if mem_free >= MIN_FREE_VRAM_GB:
            any_pass = True

        print(
            f"  GPU {idx}: {props.name}  |  "
            f"VRAM {mem_total:.1f} GB total, ~{mem_free:.1f} GB free  |  "
            f"CC {props.major}.{props.minor}  |  "
            f"CUDA {torch.version.cuda}"
        )

    # -----------------------------------------------------------
    # 4. Build report
    # -----------------------------------------------------------
    report = {
        "gpu_smoke_test": {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "torch_version": torch.__version__,
            "cuda_version": torch.version.cuda or "unknown",
            "device_count": device_count,
            "devices": devices,
            "pass": any_pass,
        }
    }

    # -----------------------------------------------------------
    # 5. Write results
    # -----------------------------------------------------------
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nReport written to {REPORT_PATH}")

    # -----------------------------------------------------------
    # 6. Assert
    # -----------------------------------------------------------
    if not any_pass:
        fail(
            f"No GPU found with >= {MIN_FREE_VRAM_GB} GB free VRAM. "
            f"Detected {device_count} device(s) but none met the threshold."
        )

    print("\nPASS: GPU smoke test succeeded.")


if __name__ == "__main__":
    main()
