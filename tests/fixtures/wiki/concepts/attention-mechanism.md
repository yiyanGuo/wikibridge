---
type: concept
title: "注意力机制"
created: 2026-01-12
updated: 2026-01-12
sources: []
tags: ["self-attention", "qkv"]
related: ["transformer-architecture", "selective-attention", "attention-is-all-you-need"]
---

# 注意力机制

The attention mechanism is the core of [[transformer-architecture]], computing relevance between sequence elements via Query-Key-Value (QKV) matrices. Self-attention lets each position attend to all others. Multi-head attention parallelizes across subspaces. Inspired by human [[selective-attention]]—the cocktail party effect. See [[attention-is-all-you-need]]. Computational complexity is O(n²), limiting long-sequence processing.
