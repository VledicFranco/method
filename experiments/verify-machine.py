#!/usr/bin/env python3
"""
Verify the current machine matches the experiment reference specification.

Run before starting GPU-intensive experiments to confirm hardware and
software compatibility. See MACHINE.md for the reference spec.

Usage:
    python experiments/verify-machine.py
    CUDA_VISIBLE_DEVICES=1 python experiments/verify-machine.py

Exit 0 if all checks pass. Exit 1 with details if any check fails.
"""

import json
import platform
import sys
from pathlib import Path

RESULTS_PATH = Path(__file__).resolve().parent / "machine-check.json"

# ── Reference spec (from MACHINE.md) ─────────────────────────────

REFERENCE = {
    "min_ram_gb": 32,
    "min_gpu_vram_gb": 10,
    "min_gpu_count": 1,
    "required_cuda": True,
    "bf16_supported": False,       # SM 7.5 does NOT support BF16
    "min_compute_capability": 7.0,
    "required_python_min": (3, 11),
}


def check_python():
    """Check Python version."""
    v = sys.version_info
    ok = (v.major, v.minor) >= REFERENCE["required_python_min"]
    return {
        "check": "python_version",
        "value": f"{v.major}.{v.minor}.{v.micro}",
        "required": f">= {REFERENCE['required_python_min'][0]}.{REFERENCE['required_python_min'][1]}",
        "pass": ok,
    }


def check_platform():
    """Check OS."""
    return {
        "check": "platform",
        "value": f"{platform.system()} {platform.release()}",
        "pass": True,  # informational
    }


def check_ram():
    """Check RAM."""
    try:
        import psutil
        ram_gb = round(psutil.virtual_memory().total / (1024**3), 1)
        ok = ram_gb >= REFERENCE["min_ram_gb"]
        return {
            "check": "ram_gb",
            "value": ram_gb,
            "required": f">= {REFERENCE['min_ram_gb']}",
            "pass": ok,
        }
    except ImportError:
        return {"check": "ram_gb", "value": "psutil not installed", "pass": None}


def check_torch():
    """Check PyTorch and CUDA."""
    try:
        import torch
    except ImportError:
        return {"check": "torch", "value": "not installed", "pass": False}

    results = []

    # CUDA available?
    cuda_ok = torch.cuda.is_available()
    results.append({
        "check": "cuda_available",
        "value": cuda_ok,
        "required": True,
        "pass": cuda_ok,
    })

    if not cuda_ok:
        results.append({
            "check": "torch_build",
            "value": torch.__version__,
            "note": "CPU-only build? Install: pip install torch --index-url https://download.pytorch.org/whl/cu126",
            "pass": False,
        })
        return results

    # GPU count
    gpu_count = torch.cuda.device_count()
    results.append({
        "check": "gpu_count",
        "value": gpu_count,
        "required": f">= {REFERENCE['min_gpu_count']}",
        "pass": gpu_count >= REFERENCE["min_gpu_count"],
    })

    # Per-GPU info
    for i in range(gpu_count):
        props = torch.cuda.get_device_properties(i)
        vram_gb = round(props.total_memory / (1024**3), 1)
        cc = f"{props.major}.{props.minor}"
        cc_float = props.major + props.minor / 10

        results.append({
            "check": f"gpu_{i}_name",
            "value": props.name,
            "pass": True,
        })
        results.append({
            "check": f"gpu_{i}_vram_gb",
            "value": vram_gb,
            "required": f">= {REFERENCE['min_gpu_vram_gb']}",
            "pass": vram_gb >= REFERENCE["min_gpu_vram_gb"],
        })
        results.append({
            "check": f"gpu_{i}_compute_capability",
            "value": cc,
            "required": f">= {REFERENCE['min_compute_capability']}",
            "pass": cc_float >= REFERENCE["min_compute_capability"],
        })
        results.append({
            "check": f"gpu_{i}_bf16",
            "value": props.major >= 8,  # Ampere+ supports BF16
            "note": "SM 7.5 (Turing) does NOT support BF16 — use FP16",
            "pass": True,  # informational, not a failure
        })

    # CUDA version
    results.append({
        "check": "cuda_version",
        "value": torch.version.cuda or "unknown",
        "pass": True,
    })

    # Torch version
    results.append({
        "check": "torch_version",
        "value": torch.__version__,
        "pass": True,
    })

    return results


def check_transformers():
    """Check transformers + trl."""
    results = []
    for pkg_name in ["transformers", "trl", "peft", "accelerate"]:
        try:
            pkg = __import__(pkg_name)
            results.append({
                "check": f"{pkg_name}_version",
                "value": getattr(pkg, "__version__", "?"),
                "pass": True,
            })
        except ImportError:
            results.append({
                "check": f"{pkg_name}_version",
                "value": "not installed",
                "pass": False,
            })
    return results


def check_api_key():
    """Check Anthropic API key is available (not globally set)."""
    import os

    # Warn if set globally
    global_key = os.environ.get("ANTHROPIC_API_KEY")
    if global_key:
        return {
            "check": "anthropic_api_key",
            "value": "SET IN ENVIRONMENT",
            "note": "WARNING: Global ANTHROPIC_API_KEY may conflict with Claude Code subscription. Remove from env vars and keep only in .env file.",
            "pass": False,
        }

    # Check .env file
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        content = env_file.read_text()
        if "ANTHROPIC_API_KEY" in content:
            return {
                "check": "anthropic_api_key",
                "value": "in .env file (correct)",
                "pass": True,
            }

    return {
        "check": "anthropic_api_key",
        "value": "not found",
        "note": "Add ANTHROPIC_API_KEY to .env for experiment scripts",
        "pass": None,  # not required for all experiments
    }


def main():
    print("=" * 60)
    print("Machine Verification — pv-method Experiments")
    print("=" * 60)
    print()

    all_results = []
    failures = []

    # Collect all checks
    all_results.append(check_python())
    all_results.append(check_platform())
    all_results.append(check_ram())

    torch_results = check_torch()
    if isinstance(torch_results, list):
        all_results.extend(torch_results)
    else:
        all_results.append(torch_results)

    all_results.extend(check_transformers())
    all_results.append(check_api_key())

    # Print results
    for r in all_results:
        status = "OK" if r["pass"] else ("FAIL" if r["pass"] is False else "SKIP")
        icon = "+" if r["pass"] else ("-" if r["pass"] is False else "?")
        print(f"  [{icon}] {r['check']}: {r['value']}", end="")
        if "required" in r:
            print(f"  (required: {r['required']})", end="")
        if "note" in r:
            print(f"  -- {r['note']}", end="")
        print()

        if r["pass"] is False:
            failures.append(r)

    print()

    # Save results
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_PATH, "w") as f:
        json.dump({"checks": all_results, "failures": len(failures)}, f, indent=2)

    if failures:
        print(f"FAIL: {len(failures)} check(s) failed. See details above.")
        print(f"Results saved to {RESULTS_PATH}")
        sys.exit(1)
    else:
        print("PASS: All checks passed. Machine matches reference spec.")
        print(f"Results saved to {RESULTS_PATH}")
        sys.exit(0)


if __name__ == "__main__":
    main()
