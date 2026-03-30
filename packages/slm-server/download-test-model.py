"""Download a small test model for the SLM server PoC.

Uses SmolLM2-135M (same base model as the exp-slm experiments).
Downloads to packages/slm-server/models/smollm2-135m-test/
"""

from pathlib import Path
from transformers import AutoTokenizer, AutoModelForCausalLM
import json

MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"
OUTPUT_DIR = Path(__file__).parent / "models" / "smollm2-135m-test"

print(f"Downloading {MODEL_ID}...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID)

print(f"Saving to {OUTPUT_DIR}...")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
tokenizer.save_pretrained(str(OUTPUT_DIR))
model.save_pretrained(str(OUTPUT_DIR))

# Write SLM metadata
meta = {
    "task": "monitor",
    "description": "SmolLM2-135M base model (test — not fine-tuned)",
    "parameters": "135M",
    "base_model": "HuggingFaceTB/SmolLM2-135M-Instruct",
}
(OUTPUT_DIR / "slm-meta.json").write_text(json.dumps(meta, indent=2))

print(f"Done. Model ready at: {OUTPUT_DIR}")
print(f"Start server with: python packages/slm-server/server.py")
