---
type: concept
title: "梯度下降"
created: 2026-03-06
updated: 2026-03-06
sources: []
tags: ["optimization", "sgd"]
related: ["transformer-architecture", "backpropagation"]
---

# 梯度下降

梯度下降是优化神经网络权重的基础算法，通过沿损失函数梯度的反方向更新参数来最小化损失。变体包括随机梯度下降(SGD)、带动量的SGD、Adam优化器等。Adam结合了动量和自适应学习率，是[[transformer-architecture]]训练中最常用的优化器。学习率调度策略（如余弦退火、warmup）对大模型训练至关重要。与[[backpropagation]]配合使用。
