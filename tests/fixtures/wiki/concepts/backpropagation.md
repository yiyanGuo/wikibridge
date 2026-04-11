---
type: concept
title: "反向传播算法"
created: 2026-03-26
updated: 2026-03-26
sources: []
tags: ["training", "gradient"]
related: ["geoffrey-hinton", "gradient-descent", "convolutional-neural-network", "lstm-network", "transformer-architecture"]
---

# 反向传播算法

反向传播是训练神经网络的核心算法，由[[geoffrey-hinton]]等人在1986年推广。通过链式法则计算损失函数对每个参数的梯度，配合[[gradient-descent]]更新权重。该算法使得深度网络的训练成为可能，支撑了[[convolutional-neural-network]]、[[lstm-network]]和[[transformer-architecture]]的训练。[[batch-normalization]]等技术的出现解决了深层网络中梯度消失的问题。
