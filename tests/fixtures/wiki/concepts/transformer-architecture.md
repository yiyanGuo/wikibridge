---
type: concept
title: "Transformer Architecture"
created: 2026-03-04
updated: 2026-03-04
sources: []
tags: ["attention", "nlp"]
related: ["attention-is-all-you-need", "attention-mechanism", "lstm-network", "openai", "bert-paper"]
---

# Transformer Architecture

Transformer架构由Google Brain在2017年提出（[[attention-is-all-you-need]]），彻底改变了自然语言处理领域。核心创新是[[attention-mechanism]]中的自注意力机制，取代了[[lstm-network]]和RNN的序列处理方式。Transformer由编码器和解码器组成，使用多头注意力、位置编码和前馈网络。[[openai]]的GPT系列、Google的BERT（[[bert-paper]]）、以及[[anthropic]]的Claude都基于此架构。在计算机视觉领域也逐渐替代[[convolutional-neural-network]]（见[[cnn-vs-transformer]]）。依赖[[nvidia]]的GPU进行大规模训练。
