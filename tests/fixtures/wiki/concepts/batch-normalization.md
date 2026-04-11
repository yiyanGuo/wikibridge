---
type: concept
title: "Batch Normalization"
created: 2026-01-13
updated: 2026-01-13
sources: []
tags: ["training", "optimization"]
related: ["convolutional-neural-network", "resnet-paper", "gradient-descent"]
---

# Batch Normalization

批量归一化是一种加速深度网络训练的技术，通过标准化每层的输入分布来缓解内部协变量偏移问题。由Ioffe和Szegedy在2015年提出。它使得更高的学习率成为可能，减少了对精心初始化的依赖。广泛应用于[[convolutional-neural-network]]和[[resnet-paper]]中的残差网络。与[[gradient-descent]]配合使用可以显著提升训练速度。
