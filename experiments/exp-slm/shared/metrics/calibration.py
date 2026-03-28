"""
Calibration metrics for SLM confidence scoring.

Provides:
  - compute_ece: Expected Calibration Error
  - compute_confidence: length-normalized sequence log-probability
  - temperature_scale: apply temperature scaling to logits
"""

from __future__ import annotations

import numpy as np


def compute_ece(
    confidences: np.ndarray,
    accuracies: np.ndarray,
    n_bins: int = 10,
) -> float:
    """
    Compute Expected Calibration Error.

    Bins confidence scores into `n_bins` equal-width bins [0, 0.1), [0.1, 0.2), ...,
    [0.9, 1.0]. For each bin, computes |accuracy - mean_confidence| weighted by bin size.
    ECE is the weighted average across all bins.

    Args:
        confidences: Array of confidence scores in [0, 1], shape (N,).
        accuracies: Array of binary accuracy indicators (0 or 1), shape (N,).
        n_bins: Number of equal-width bins (default 10).

    Returns:
        ECE as a float in [0, 1].
    """
    confidences = np.asarray(confidences, dtype=np.float64)
    accuracies = np.asarray(accuracies, dtype=np.float64)

    if len(confidences) == 0:
        return 0.0

    bin_boundaries = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    total = len(confidences)

    for i in range(n_bins):
        lo, hi = bin_boundaries[i], bin_boundaries[i + 1]
        # Last bin is inclusive on both ends: [0.9, 1.0]
        if i == n_bins - 1:
            mask = (confidences >= lo) & (confidences <= hi)
        else:
            mask = (confidences >= lo) & (confidences < hi)

        bin_size = mask.sum()
        if bin_size == 0:
            continue

        bin_accuracy = accuracies[mask].mean()
        bin_confidence = confidences[mask].mean()
        ece += (bin_size / total) * abs(bin_accuracy - bin_confidence)

    return float(ece)


def compute_confidence(
    log_probs: list[np.ndarray] | list[list[float]],
    lengths: list[int] | np.ndarray,
) -> np.ndarray:
    """
    Compute length-normalized sequence log-probabilities as confidence scores.

    confidence = exp(sum(log_probs) / num_tokens)

    Args:
        log_probs: List of arrays, each containing per-token log probabilities
                   for one sequence.
        lengths: List of sequence lengths (number of generated tokens per sequence).

    Returns:
        Array of confidence scores in [0, 1], shape (N,).
    """
    scores = []
    for lp, length in zip(log_probs, lengths):
        lp_arr = np.asarray(lp, dtype=np.float64)
        if length == 0:
            scores.append(0.0)
        else:
            avg_log_prob = lp_arr.sum() / length
            scores.append(float(np.exp(avg_log_prob)))
    return np.array(scores, dtype=np.float64)


def temperature_scale(logits: np.ndarray, T: float) -> np.ndarray:
    """
    Apply temperature scaling to logits.

    Divides logits by T before softmax. Higher T -> softer distribution,
    lower T -> sharper distribution.

    Args:
        logits: Raw logits array, shape (..., vocab_size).
        T: Temperature parameter (must be > 0).

    Returns:
        Scaled logits array with the same shape.

    Raises:
        ValueError: If T <= 0.
    """
    if T <= 0:
        raise ValueError(f"Temperature must be positive, got {T}")
    return np.asarray(logits, dtype=np.float64) / T
