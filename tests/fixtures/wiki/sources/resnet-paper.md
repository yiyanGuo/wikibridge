---
type: source
title: "Deep Residual Learning (He et al. 2015)"
created: 2026-02-22
updated: 2026-02-22
sources: []
tags: ["resnet", "skip-connection"]
related: ["convolutional-neural-network", "backpropagation", "batch-normalization", "transformer-architecture"]
---

# Deep Residual Learning (He et al. 2015)

ResNet论文提出了残差学习框架和跳跃连接，解决了深层[[convolutional-neural-network]]的退化问题。152层的ResNet在ImageNet上取得最优结果。跳跃连接使得[[backpropagation]]中的梯度可以直接流过多层网络。与[[batch-normalization]]结合使用效果更佳。ResNet的设计理念影响了后续[[transformer-architecture]]中的残差连接。
