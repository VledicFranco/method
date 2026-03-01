# H2 Decision — Confirmed

`experiments/hN-{slug}/` is the right layout. Self-validated by E2 using it.

Canonical structure going forward:
```
epochs/eN-{slug}/
  hypothesis.md
  experiments/
    h1-{slug}/
      spec.md
      i1.md, i2.md ...
      decision.md
  decision.md
```

E1's `iterations/` was a transitional structure (single-thread epoch). Not
worth retrofitting — E1 is closed. E2+ use the new layout.
