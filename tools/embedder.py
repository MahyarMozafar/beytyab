"""Turn text into meaning vectors with an ONNX sentence model.

This does in Python exactly what the browser does later:
tokenize -> run the model -> average the word vectors -> make length 1.
Using the same model file on both sides keeps the numbers comparable.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MAX_TOKENS = 128


class Embedder:
    def __init__(self, model_file: Path, tokenizer_file: Path):
        self.tokenizer = Tokenizer.from_file(str(tokenizer_file))
        self.tokenizer.enable_truncation(max_length=MAX_TOKENS)
        self.session = ort.InferenceSession(
            str(model_file), providers=["CPUExecutionProvider"]
        )
        self.input_names = {i.name for i in self.session.get_inputs()}

    def embed(self, texts: list[str], batch_size: int = 64) -> np.ndarray:
        """Return one unit-length float32 vector per text, in the same order."""
        encoded = self.tokenizer.encode_batch(texts)
        # Sort by length so each batch needs little padding (much faster).
        order = sorted(range(len(texts)), key=lambda i: len(encoded[i].ids))
        out: np.ndarray | None = None
        for start in range(0, len(order), batch_size):
            rows = order[start : start + batch_size]
            width = max(len(encoded[i].ids) for i in rows)
            ids = np.zeros((len(rows), width), dtype=np.int64)
            mask = np.zeros((len(rows), width), dtype=np.int64)
            for r, i in enumerate(rows):
                n = len(encoded[i].ids)
                ids[r, :n] = encoded[i].ids
                mask[r, :n] = 1
            feeds = {"input_ids": ids, "attention_mask": mask}
            if "token_type_ids" in self.input_names:
                feeds["token_type_ids"] = np.zeros_like(ids)
            hidden = self.session.run(None, feeds)[0]  # (rows, width, dim)
            weights = mask[:, :, None].astype(np.float32)
            pooled = (hidden * weights).sum(axis=1) / weights.sum(axis=1)
            pooled /= np.linalg.norm(pooled, axis=1, keepdims=True)
            if out is None:
                out = np.zeros((len(texts), pooled.shape[1]), dtype=np.float32)
            out[rows] = pooled
        assert out is not None
        return out
