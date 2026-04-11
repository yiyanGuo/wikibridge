#!/usr/bin/env python3
"""Generate test wiki dataset: 300 pages across 8 domains + 500 test queries."""

import json
import os
import random
from pathlib import Path

random.seed(42)

BASE = Path(__file__).parent / "fixtures" / "wiki"
QUERIES_FILE = Path(__file__).parent / "fixtures" / "queries.json"

# ── Page registry ──────────────────────────────────────────────────────────

PAGES = []  # filled by domain sections below

def P(path, title, typ, domain, tags, content_zh, content_en, links=None, sources=None, isolated=False):
    """Register a page."""
    PAGES.append({
        "path": path,
        "title": title,
        "type": typ,
        "domain": domain,
        "tags": tags,
        "content_zh": content_zh,
        "content_en": content_en,
        "links": links or [],
        "sources_field": sources or [],
        "isolated": isolated,
    })

# ══════════════════════════════════════════════════════════════════════════
# DOMAIN 1: Machine Learning & Deep Learning (40 pages)
# ══════════════════════════════════════════════════════════════════════════

P("entities/geoffrey-hinton", "Geoffrey Hinton", "entity", "ml", ["deep-learning", "pioneer"],
  "Geoffrey Hinton被誉为深度学习之父，他在[[backpropagation]]和[[convolutional-neural-network]]领域做出了开创性贡献。他在多伦多大学的研究直接推动了现代[[transformer-architecture]]的发展。Hinton曾在[[google-brain]]工作多年，并获得图灵奖。他的学生包括Yann LeCun等著名研究者。近年来他对AI安全问题表达了深切关注，与[[anthropic]]等机构的理念不谋而合。他的反向传播论文彻底改变了神经网络训练的方式，使得[[gradient-descent]]成为标准优化方法。",
  "Geoffrey Hinton is widely regarded as the godfather of deep learning. His pioneering work on [[backpropagation]] and [[convolutional-neural-network]] laid the foundation for modern AI. He spent years at [[google-brain]] and received the Turing Award. His research directly influenced the development of [[transformer-architecture]] and [[attention-mechanism]]. Recently he has raised concerns about AI safety, aligning with organizations like [[anthropic]]. His backpropagation paper made [[gradient-descent]] the standard training method for neural networks.",
  links=["backpropagation", "convolutional-neural-network", "google-brain", "transformer-architecture", "anthropic", "gradient-descent", "attention-mechanism"])

P("entities/yann-lecun", "Yann LeCun", "entity", "ml", ["cnn", "meta"],
  "Yann LeCun是[[convolutional-neural-network]]的发明者，目前担任Meta AI首席科学家。他的LeNet架构是图像识别的先驱，直接影响了后来的[[imagenet-paper]]中AlexNet的设计。LeCun与[[geoffrey-hinton]]同为深度学习三巨头。他积极推动[[pytorch]]的发展，使其成为研究社区的首选框架。他在自监督学习和[[transfer-learning]]方面的观点影响深远。",
  "Yann LeCun invented the [[convolutional-neural-network]] and serves as Chief AI Scientist at Meta. His LeNet architecture pioneered image recognition, directly influencing AlexNet in the [[imagenet-paper]]. Along with [[geoffrey-hinton]], he is one of the three pioneers of deep learning. He championed [[pytorch]] as the primary research framework and has influential views on self-supervised learning and [[transfer-learning]].",
  links=["convolutional-neural-network", "imagenet-paper", "geoffrey-hinton", "pytorch", "transfer-learning"])

P("entities/openai", "OpenAI", "entity", "ml", ["gpt", "ai-lab"],
  "OpenAI是全球领先的AI研究实验室，开发了GPT系列大语言模型。其[[gpt4-technical-report]]展示了多模态能力的突破。OpenAI在[[transformer-architecture]]的基础上构建了整个产品线，并推动了[[reinforcement-learning]]中RLHF技术的实际应用。与[[anthropic]]和[[deepmind]]形成竞争关系。",
  "OpenAI is a leading AI research lab that developed the GPT series of large language models. Their [[gpt4-technical-report]] demonstrated breakthrough multimodal capabilities. Built on [[transformer-architecture]], OpenAI advanced [[reinforcement-learning]] through RLHF. Competes with [[anthropic]] and [[deepmind]].",
  links=["gpt4-technical-report", "transformer-architecture", "reinforcement-learning", "anthropic", "deepmind"])

P("entities/deepmind", "DeepMind", "entity", "ml", ["alphago", "alphafold"],
  "DeepMind是Alphabet旗下的AI研究实验室，以AlphaGo和AlphaFold闻名。AlphaFold通过深度学习解决了[[protein-folding]]问题，参见[[alphafold-nature-paper]]。其创始人Demis Hassabis结合了[[reinforcement-learning]]和神经科学的洞见。2023年与[[google-brain]]合并，技术实力进一步增强。",
  "DeepMind, an Alphabet AI lab, is known for AlphaGo and AlphaFold. AlphaFold solved the [[protein-folding]] problem using deep learning (see [[alphafold-nature-paper]]). Founder Demis Hassabis combined [[reinforcement-learning]] with neuroscience insights. Merged with [[google-brain]] in 2023.",
  links=["protein-folding", "alphafold-nature-paper", "reinforcement-learning", "google-brain"])

P("entities/nvidia", "NVIDIA", "entity", "ml", ["gpu", "cuda"],
  "NVIDIA是全球领先的GPU计算平台公司，其CUDA架构成为深度学习训练的基础设施。几乎所有主流框架如[[pytorch]]和[[tensorflow]]都依赖NVIDIA GPU进行加速训练。A100和H100芯片驱动了[[transformer-architecture]]大模型的训练。",
  "NVIDIA is the leading GPU computing platform. Its CUDA architecture underpins deep learning training infrastructure. Major frameworks like [[pytorch]] and [[tensorflow]] rely on NVIDIA GPUs. A100 and H100 chips power the training of large [[transformer-architecture]] models.",
  links=["pytorch", "tensorflow", "transformer-architecture"])

P("entities/pytorch", "PyTorch", "entity", "ml", ["framework", "meta"],
  "PyTorch是由Meta开发的开源深度学习框架，以动态计算图和Pythonic API著称。[[yann-lecun]]推动了其在学术界的普及。支持[[convolutional-neural-network]]、[[lstm-network]]、[[transformer-architecture]]等各类模型的实现。与[[tensorflow]]是主要竞争者，详见[[pytorch-vs-tensorflow]]。通过[[hugging-face]]生态系统广泛使用。",
  "PyTorch is an open-source deep learning framework by Meta, known for dynamic computation graphs. [[yann-lecun]] championed its adoption in academia. Supports [[convolutional-neural-network]], [[lstm-network]], [[transformer-architecture]] implementations. Competes with [[tensorflow]] (see [[pytorch-vs-tensorflow]]). Widely used through [[hugging-face]] ecosystem.",
  links=["yann-lecun", "convolutional-neural-network", "lstm-network", "transformer-architecture", "tensorflow", "pytorch-vs-tensorflow", "hugging-face"])

P("entities/tensorflow", "TensorFlow", "entity", "ml", ["framework", "google"],
  "TensorFlow是Google开发的机器学习框架，最初由[[google-brain]]团队创建。支持从研究到生产部署的完整工作流，包括TensorFlow Serving和TFLite。在[[convolutional-neural-network]]和[[transformer-architecture]]模型方面有广泛支持。与[[pytorch]]的对比详见[[pytorch-vs-tensorflow]]。",
  "TensorFlow is Google's ML framework, originally created by [[google-brain]]. Supports the full workflow from research to deployment with TF Serving and TFLite. Has broad support for [[convolutional-neural-network]] and [[transformer-architecture]] models. See [[pytorch-vs-tensorflow]] for comparison with [[pytorch]].",
  links=["google-brain", "convolutional-neural-network", "transformer-architecture", "pytorch", "pytorch-vs-tensorflow"])

P("entities/hugging-face", "Hugging Face", "entity", "ml", ["transformers", "model-hub"],
  "Hugging Face是最大的AI模型社区和开源平台，其Transformers库提供了数千个预训练模型。基于[[transformer-architecture]]的模型可以通过简单API调用实现[[transfer-learning]]。平台支持[[pytorch]]和[[tensorflow]]两大框架。与[[openai]]和[[anthropic]]的模型也可通过其平台访问。",
  "Hugging Face is the largest AI model community. Its Transformers library provides thousands of pretrained models based on [[transformer-architecture]], enabling easy [[transfer-learning]]. Supports both [[pytorch]] and [[tensorflow]]. Models from [[openai]] and [[anthropic]] are accessible through the platform.",
  links=["transformer-architecture", "transfer-learning", "pytorch", "tensorflow", "openai", "anthropic"])

P("entities/anthropic", "Anthropic", "entity", "ml", ["ai-safety", "claude"],
  "Anthropic是一家AI安全公司，由前OpenAI研究人员创立。开发了Claude系列大语言模型，强调constitutional AI方法。与[[openai]]和[[deepmind]]在大模型领域竞争，但更侧重安全性研究。使用[[reinforcement-learning]]中的RLHF和constitutional AI方法进行模型对齐。",
  "Anthropic is an AI safety company founded by former OpenAI researchers. Developed the Claude LLM series, emphasizing constitutional AI. Competes with [[openai]] and [[deepmind]] while focusing on safety research. Uses [[reinforcement-learning]] methods like RLHF and constitutional AI for model alignment.",
  links=["openai", "deepmind", "reinforcement-learning"])

P("entities/google-brain", "Google Brain", "entity", "ml", ["google", "research"],
  "Google Brain是Google的AI研究团队，创建了[[tensorflow]]框架和[[transformer-architecture]]（通过[[attention-is-all-you-need]]论文）。2023年与[[deepmind]]合并为Google DeepMind。在[[batch-normalization]]和大规模分布式训练方面有重要贡献。",
  "Google Brain was Google's AI research team that created [[tensorflow]] and the [[transformer-architecture]] (via the [[attention-is-all-you-need]] paper). Merged with [[deepmind]] in 2023. Made significant contributions in [[batch-normalization]] and large-scale distributed training.",
  links=["tensorflow", "transformer-architecture", "attention-is-all-you-need", "deepmind", "batch-normalization"])

# ML Concepts
P("concepts/transformer-architecture", "Transformer Architecture", "concept", "ml", ["attention", "nlp"],
  "Transformer架构由Google Brain在2017年提出（[[attention-is-all-you-need]]），彻底改变了自然语言处理领域。核心创新是[[attention-mechanism]]中的自注意力机制，取代了[[lstm-network]]和RNN的序列处理方式。Transformer由编码器和解码器组成，使用多头注意力、位置编码和前馈网络。[[openai]]的GPT系列、Google的BERT（[[bert-paper]]）、以及[[anthropic]]的Claude都基于此架构。在计算机视觉领域也逐渐替代[[convolutional-neural-network]]（见[[cnn-vs-transformer]]）。依赖[[nvidia]]的GPU进行大规模训练。",
  "The Transformer architecture was proposed by Google Brain in 2017 ([[attention-is-all-you-need]]), revolutionizing NLP. Its core innovation is the self-[[attention-mechanism]], replacing sequential processing in [[lstm-network]] and RNNs. Composed of encoder-decoder with multi-head attention, positional encoding, and feed-forward networks. GPT ([[openai]]), BERT ([[bert-paper]]), and Claude ([[anthropic]]) are all built on it. Also replacing [[convolutional-neural-network]] in vision (see [[cnn-vs-transformer]]). Requires [[nvidia]] GPUs for large-scale training.",
  links=["attention-is-all-you-need", "attention-mechanism", "lstm-network", "openai", "bert-paper", "anthropic", "convolutional-neural-network", "cnn-vs-transformer", "nvidia"])

P("concepts/attention-mechanism", "注意力机制", "concept", "ml", ["self-attention", "qkv"],
  "注意力机制是[[transformer-architecture]]的核心组件，通过Query-Key-Value (QKV)矩阵计算输入序列中元素间的相关性。自注意力(Self-Attention)允许每个位置关注序列中的所有其他位置。多头注意力将注意力空间分为多个子空间并行计算。该机制受到人类[[selective-attention]]的启发，特别是鸡尾酒会效应——在嘈杂环境中关注特定信息的能力。详见[[attention-is-all-you-need]]原始论文。注意力机制的计算复杂度为O(n²)，这限制了处理长序列的能力。",
  "The attention mechanism is the core of [[transformer-architecture]], computing relevance between sequence elements via Query-Key-Value (QKV) matrices. Self-attention lets each position attend to all others. Multi-head attention parallelizes across subspaces. Inspired by human [[selective-attention]]—the cocktail party effect. See [[attention-is-all-you-need]]. Computational complexity is O(n²), limiting long-sequence processing.",
  links=["transformer-architecture", "selective-attention", "attention-is-all-you-need"])

P("concepts/backpropagation", "反向传播算法", "concept", "ml", ["training", "gradient"],
  "反向传播是训练神经网络的核心算法，由[[geoffrey-hinton]]等人在1986年推广。通过链式法则计算损失函数对每个参数的梯度，配合[[gradient-descent]]更新权重。该算法使得深度网络的训练成为可能，支撑了[[convolutional-neural-network]]、[[lstm-network]]和[[transformer-architecture]]的训练。[[batch-normalization]]等技术的出现解决了深层网络中梯度消失的问题。",
  "Backpropagation is the core algorithm for training neural networks, popularized by [[geoffrey-hinton]] in 1986. It computes gradients via the chain rule, combined with [[gradient-descent]] for weight updates. Enables training of deep architectures including [[convolutional-neural-network]], [[lstm-network]], and [[transformer-architecture]]. Techniques like [[batch-normalization]] address vanishing gradients in deep networks.",
  links=["geoffrey-hinton", "gradient-descent", "convolutional-neural-network", "lstm-network", "transformer-architecture", "batch-normalization"])

P("concepts/convolutional-neural-network", "Convolutional Neural Network", "concept", "ml", ["cnn", "vision"],
  "卷积神经网络(CNN)是由[[yann-lecun]]发明的深度学习架构，专为图像处理设计。通过卷积核提取局部特征，利用池化层降低空间维度。[[imagenet-paper]]中的AlexNet证明了深层CNN在大规模图像分类中的威力。残差连接（[[resnet-paper]]）解决了深层CNN的退化问题。近年来[[transformer-architecture]]在视觉任务中逐渐挑战CNN的地位（见[[cnn-vs-transformer]]）。CNN仍广泛用于医学影像（如[[ai-drug-discovery]]中的分子图像分析）。",
  "Convolutional Neural Networks (CNNs), invented by [[yann-lecun]], are designed for image processing. They extract local features via convolutional kernels and reduce spatial dimensions with pooling. AlexNet ([[imagenet-paper]]) proved deep CNNs' power in image classification. Residual connections ([[resnet-paper]]) solved degradation in deep CNNs. [[transformer-architecture]] is challenging CNNs in vision (see [[cnn-vs-transformer]]). CNNs remain widely used in medical imaging ([[ai-drug-discovery]]).",
  links=["yann-lecun", "imagenet-paper", "resnet-paper", "transformer-architecture", "cnn-vs-transformer", "ai-drug-discovery"])

P("concepts/reinforcement-learning", "强化学习", "concept", "ml", ["reward", "policy"],
  "强化学习是机器学习的一个分支，智能体通过与环境交互获得奖励来学习最优策略。核心概念包括状态、动作、奖励和策略。Q-Learning和PPO是常用算法。[[deepmind]]的AlphaGo是强化学习的里程碑应用。[[openai]]和[[anthropic]]使用RLHF（人类反馈的强化学习）对齐大语言模型。强化学习在[[quantitative-trading]]和[[smart-grid]]优化中也有应用。其理论基础与[[behavioral-economics]]中的奖励机制有有趣的平行关系。",
  "Reinforcement learning (RL) trains agents through environmental interaction and rewards. Core concepts: state, action, reward, policy. Q-Learning and PPO are common algorithms. [[deepmind]]'s AlphaGo is a landmark RL application. [[openai]] and [[anthropic]] use RLHF for LLM alignment. RL applies to [[quantitative-trading]] and [[smart-grid]] optimization. Has parallels with reward mechanisms in [[behavioral-economics]].",
  links=["deepmind", "openai", "anthropic", "quantitative-trading", "smart-grid", "behavioral-economics"])

P("concepts/generative-adversarial-network", "Generative Adversarial Network", "concept", "ml", ["gan", "generative"],
  "生成对抗网络(GAN)由Ian Goodfellow于2014年提出，包含生成器和判别器两个网络的博弈训练。GAN可以生成逼真的图像、视频和音频内容。其训练过程使用[[backpropagation]]和[[gradient-descent]]。GAN在药物分子生成（[[ai-drug-discovery]]）和艺术创作中有广泛应用。后来的扩散模型在图像生成质量上超越了GAN，但GAN在实时生成方面仍有优势。",
  "Generative Adversarial Networks (GANs), proposed by Ian Goodfellow in 2014, train a generator and discriminator adversarially. GANs generate realistic images, video, and audio. Training uses [[backpropagation]] and [[gradient-descent]]. Applied in drug molecule generation ([[ai-drug-discovery]]) and art. Diffusion models surpassed GANs in quality, but GANs retain advantages in real-time generation.",
  links=["backpropagation", "gradient-descent", "ai-drug-discovery"])

P("concepts/transfer-learning", "迁移学习", "concept", "ml", ["fine-tuning", "pretrained"],
  "迁移学习是将在一个任务上训练好的模型知识迁移到另一个任务的方法。预训练-微调范式是[[transformer-architecture]]成功的关键，如[[bert-paper]]中的BERT模型。[[hugging-face]]平台使迁移学习变得简单易用。在数据稀缺的领域如医疗影像（[[ai-drug-discovery]]）和小语种NLP中尤为重要。与[[feynman-technique]]中知识迁移的理念有异曲同工之处。",
  "Transfer learning transfers knowledge from one task to another. The pretrain-finetune paradigm is key to [[transformer-architecture]] success, as in BERT ([[bert-paper]]). [[hugging-face]] makes transfer learning accessible. Especially valuable in data-scarce domains like medical imaging ([[ai-drug-discovery]]) and low-resource NLP. Conceptually parallels knowledge transfer in [[feynman-technique]].",
  links=["transformer-architecture", "bert-paper", "hugging-face", "ai-drug-discovery", "feynman-technique"])

P("concepts/lstm-network", "LSTM Network", "concept", "ml", ["rnn", "sequence"],
  "长短期记忆网络(LSTM)是一种特殊的循环神经网络，通过遗忘门、输入门和输出门解决了长序列中的梯度消失问题。核心公式涉及细胞状态的更新机制。LSTM在时间序列预测中广泛应用，包括[[smart-grid]]负荷预测和[[quantitative-trading]]价格预测。GRU是其简化变体（见[[lstm-vs-gru]]）。虽然在NLP中逐渐被[[transformer-architecture]]取代，LSTM在时序数据领域仍有独特优势。训练依赖[[backpropagation]]通过时间展开。",
  "Long Short-Term Memory (LSTM) networks solve vanishing gradients in sequences via forget, input, and output gates. Core formulas govern cell state updates. Widely used in time series: [[smart-grid]] load prediction, [[quantitative-trading]] price forecasting. GRU is a simplified variant (see [[lstm-vs-gru]]). While [[transformer-architecture]] replaced LSTM in NLP, LSTM retains advantages for temporal data. Training uses [[backpropagation]] through time.",
  links=["smart-grid", "quantitative-trading", "lstm-vs-gru", "transformer-architecture", "backpropagation"])

P("concepts/batch-normalization", "Batch Normalization", "concept", "ml", ["training", "optimization"],
  "批量归一化是一种加速深度网络训练的技术，通过标准化每层的输入分布来缓解内部协变量偏移问题。由Ioffe和Szegedy在2015年提出。它使得更高的学习率成为可能，减少了对精心初始化的依赖。广泛应用于[[convolutional-neural-network]]和[[resnet-paper]]中的残差网络。与[[gradient-descent]]配合使用可以显著提升训练速度。",
  "Batch Normalization accelerates deep network training by normalizing layer inputs to reduce internal covariate shift. Proposed by Ioffe and Szegedy in 2015. Enables higher learning rates and reduces initialization sensitivity. Widely used in [[convolutional-neural-network]] and residual networks ([[resnet-paper]]). Combined with [[gradient-descent]], significantly speeds up training.",
  links=["convolutional-neural-network", "resnet-paper", "gradient-descent"])

P("concepts/gradient-descent", "梯度下降", "concept", "ml", ["optimization", "sgd"],
  "梯度下降是优化神经网络权重的基础算法，通过沿损失函数梯度的反方向更新参数来最小化损失。变体包括随机梯度下降(SGD)、带动量的SGD、Adam优化器等。Adam结合了动量和自适应学习率，是[[transformer-architecture]]训练中最常用的优化器。学习率调度策略（如余弦退火、warmup）对大模型训练至关重要。与[[backpropagation]]配合使用。",
  "Gradient descent is the foundational optimization algorithm, updating parameters in the direction of steepest loss decrease. Variants include SGD, momentum SGD, and Adam optimizer. Adam combines momentum with adaptive learning rates, widely used in [[transformer-architecture]] training. Learning rate scheduling (cosine annealing, warmup) is crucial for large models. Works with [[backpropagation]].",
  links=["transformer-architecture", "backpropagation"])

# ML Sources
P("sources/attention-is-all-you-need", "Attention Is All You Need (Vaswani et al. 2017)", "source", "ml", ["transformer", "paper"],
  "这篇由Google研究人员Vaswani等人发表的论文提出了[[transformer-architecture]]，彻底改变了NLP领域。论文引入了自[[attention-mechanism]]和多头注意力，证明纯注意力模型可以超越基于[[lstm-network]]的序列到序列模型。在WMT翻译任务上取得了最优结果。该架构后来被[[openai]]（GPT系列）、Google（[[bert-paper]]）和[[anthropic]]（Claude）广泛采用。",
  "This paper by Vaswani et al. at Google proposed the [[transformer-architecture]], revolutionizing NLP. Introduced self-[[attention-mechanism]] and multi-head attention, showing pure attention models surpass [[lstm-network]]-based seq2seq. Achieved SOTA on WMT translation. Later adopted by [[openai]] (GPT), Google ([[bert-paper]]), and [[anthropic]] (Claude).",
  links=["transformer-architecture", "attention-mechanism", "lstm-network", "openai", "bert-paper", "anthropic"])

P("sources/imagenet-paper", "ImageNet Classification with Deep CNNs (Krizhevsky 2012)", "source", "ml", ["alexnet", "vision"],
  "这篇论文介绍了AlexNet，在ImageNet大规模视觉识别挑战赛中取得突破性成绩，将[[convolutional-neural-network]]推向深度学习的主流。利用[[nvidia]]GPU实现高效训练，使用ReLU激活函数和Dropout正则化。[[yann-lecun]]的LeNet是其前身。这一成果推动了整个深度学习领域的爆发式增长。后续[[resnet-paper]]在此基础上提出了更深的网络结构。",
  "This paper introduced AlexNet, achieving breakthrough results in the ImageNet challenge and bringing [[convolutional-neural-network]] into mainstream deep learning. Used [[nvidia]] GPUs for efficient training with ReLU and Dropout. [[yann-lecun]]'s LeNet was its predecessor. Sparked the deep learning revolution. [[resnet-paper]] later proposed deeper architectures building on this work.",
  links=["convolutional-neural-network", "nvidia", "yann-lecun", "resnet-paper"])

P("sources/gpt4-technical-report", "GPT-4 Technical Report (OpenAI 2023)", "source", "ml", ["gpt", "multimodal"],
  "[[openai]]发布的GPT-4技术报告展示了多模态大语言模型的能力，可以处理文本和图像输入。基于[[transformer-architecture]]构建，使用[[reinforcement-learning]]中的RLHF进行对齐训练。在多个基准测试中达到人类水平。报告未披露具体模型架构和训练数据细节，引发了关于AI研究开放性的讨论。",
  "[[openai]]'s GPT-4 technical report demonstrated multimodal LLM capabilities, processing text and image inputs. Built on [[transformer-architecture]], aligned using RLHF from [[reinforcement-learning]]. Achieved human-level performance on multiple benchmarks. Withheld architecture and training data details, sparking debate about AI research openness.",
  links=["openai", "transformer-architecture", "reinforcement-learning"])

P("sources/bert-paper", "BERT: Pre-training of Deep Bidirectional Transformers (Devlin 2018)", "source", "ml", ["bert", "nlp"],
  "BERT论文由Google发表，提出了双向[[transformer-architecture]]预训练方法。通过掩码语言模型(MLM)和下一句预测(NSP)任务进行[[transfer-learning]]预训练。在11个NLP基准任务上取得最优成绩。BERT的预训练-微调范式通过[[hugging-face]]平台广泛传播，成为NLP的标准方法。",
  "The BERT paper from Google proposed bidirectional [[transformer-architecture]] pre-training via Masked Language Model (MLM) and Next Sentence Prediction (NSP) for [[transfer-learning]]. Achieved SOTA on 11 NLP benchmarks. BERT's pretrain-finetune paradigm spread through [[hugging-face]], becoming the NLP standard.",
  links=["transformer-architecture", "transfer-learning", "hugging-face"])

P("sources/resnet-paper", "Deep Residual Learning (He et al. 2015)", "source", "ml", ["resnet", "skip-connection"],
  "ResNet论文提出了残差学习框架和跳跃连接，解决了深层[[convolutional-neural-network]]的退化问题。152层的ResNet在ImageNet上取得最优结果。跳跃连接使得[[backpropagation]]中的梯度可以直接流过多层网络。与[[batch-normalization]]结合使用效果更佳。ResNet的设计理念影响了后续[[transformer-architecture]]中的残差连接。",
  "The ResNet paper proposed residual learning with skip connections, solving degradation in deep [[convolutional-neural-network]]. 152-layer ResNet achieved SOTA on ImageNet. Skip connections allow [[backpropagation]] gradients to flow directly. Works well with [[batch-normalization]]. ResNet's residual design influenced [[transformer-architecture]] connections.",
  links=["convolutional-neural-network", "backpropagation", "batch-normalization", "transformer-architecture"])

# Additional ML pages
for name, title, content_zh, content_en, lnk in [
    ("entities/stable-diffusion", "Stable Diffusion", "Stable Diffusion是一种文本到图像的扩散模型，由Stability AI开源。与[[generative-adversarial-network]]不同，扩散模型通过逐步去噪过程生成图像。使用[[transformer-architecture]]中的交叉注意力机制引导生成过程。", "Stable Diffusion is an open-source text-to-image diffusion model. Unlike [[generative-adversarial-network]], diffusion models generate images through iterative denoising. Uses cross-[[attention-mechanism]] from [[transformer-architecture]] to guide generation.", ["generative-adversarial-network", "transformer-architecture", "attention-mechanism"]),
    ("entities/midjourney", "Midjourney", "Midjourney是一个AI图像生成服务，利用扩散模型技术创建高质量艺术图像。与[[stable-diffusion]]竞争，但采用闭源模式。", "Midjourney is an AI image generation service using diffusion model technology. Competes with [[stable-diffusion]] but uses a closed-source approach.", ["stable-diffusion"]),
    ("concepts/self-supervised-learning", "自监督学习", "自监督学习是一种无需人工标注的学习范式，通过从数据本身构造监督信号来学习表示。[[bert-paper]]中的掩码语言模型是典型的自监督方法。对比学习(Contrastive Learning)是另一种重要形式。与[[transfer-learning]]结合，可以在大量无标注数据上预训练模型。[[yann-lecun]]认为自监督学习是AI的未来。", "Self-supervised learning learns representations without manual labels by constructing supervision from data itself. Masked language modeling in [[bert-paper]] is a typical approach. Contrastive learning is another key form. Combined with [[transfer-learning]], enables pretraining on massive unlabeled data. [[yann-lecun]] considers it the future of AI.", ["bert-paper", "transfer-learning", "yann-lecun"]),
    ("concepts/model-compression", "模型压缩", "模型压缩技术旨在减小深度学习模型的大小和计算需求，包括知识蒸馏、剪枝和量化。使得大型[[transformer-architecture]]模型可以在边缘设备上运行。与[[transfer-learning]]结合，小模型可以从大模型学习。", "Model compression reduces DL model size via knowledge distillation, pruning, and quantization. Enables large [[transformer-architecture]] models to run on edge devices. Combined with [[transfer-learning]], small models learn from large ones.", ["transformer-architecture", "transfer-learning"]),
    ("concepts/federated-learning", "联邦学习", "联邦学习允许多个参与方在不共享原始数据的情况下协作训练模型。在医疗数据（[[genomics]]）和金融数据（[[risk-management]]）等隐私敏感领域尤为重要。使用[[gradient-descent]]的变体在本地训练并聚合更新。", "Federated learning enables collaborative training without sharing raw data. Crucial in privacy-sensitive domains like healthcare ([[genomics]]) and finance ([[risk-management]]). Uses [[gradient-descent]] variants for local training with aggregated updates.", ["genomics", "risk-management", "gradient-descent"]),
    ("concepts/neural-architecture-search", "神经架构搜索(NAS)", "神经架构搜索使用自动化方法寻找最优网络结构，结合[[reinforcement-learning]]或进化算法来探索架构空间。Google的NASNet和EfficientNet是成功案例。减少了手动设计[[convolutional-neural-network]]结构的工作量。", "Neural Architecture Search (NAS) automates optimal network design using [[reinforcement-learning]] or evolutionary algorithms. Google's NASNet and EfficientNet are successes. Reduces manual [[convolutional-neural-network]] design effort.", ["reinforcement-learning", "convolutional-neural-network"]),
    ("concepts/explainable-ai", "可解释人工智能(XAI)", "可解释AI旨在让机器学习模型的决策过程透明可理解。LIME和SHAP是常用方法。在医疗诊断（[[drug-discovery-pipeline]]）和金融风控（[[risk-management]]）中，模型可解释性是法规要求。与[[ai-ethics]]中的公平性和透明度讨论密切相关。", "Explainable AI (XAI) makes ML model decisions transparent. LIME and SHAP are common methods. In medical diagnosis ([[drug-discovery-pipeline]]) and financial risk ([[risk-management]]), interpretability is regulatory. Closely related to fairness in [[ai-ethics]].", ["drug-discovery-pipeline", "risk-management", "ai-ethics"]),
    ("concepts/few-shot-learning", "小样本学习", "小样本学习让模型仅从少量样本就能学习新任务。GPT系列（[[openai]]）展示了强大的上下文学习能力。元学习(Meta-Learning)是实现少样本学习的关键方法。与[[transfer-learning]]密切相关。", "Few-shot learning enables models to learn new tasks from minimal examples. GPT series ([[openai]]) demonstrated powerful in-context learning. Meta-learning is key to few-shot capability. Closely related to [[transfer-learning]].", ["openai", "transfer-learning"]),
    ("concepts/diffusion-model", "扩散模型", "扩散模型通过学习逐步去噪过程生成数据，在图像生成质量上超越了[[generative-adversarial-network]]。[[stable-diffusion]]和DALL-E是代表应用。数学基础涉及随机微分方程和分数匹配。训练使用标准[[gradient-descent]]优化。", "Diffusion models generate data by learning iterative denoising, surpassing [[generative-adversarial-network]] in image quality. [[stable-diffusion]] and DALL-E are key applications. Mathematical foundations involve SDEs and score matching. Trained with standard [[gradient-descent]].", ["generative-adversarial-network", "stable-diffusion", "gradient-descent"]),
    ("sources/dropout-paper", "Dropout: A Simple Way to Prevent Overfitting (Srivastava 2014)", "Dropout正则化技术由[[geoffrey-hinton]]组提出，通过随机丢弃神经元防止过拟合。被广泛应用于[[convolutional-neural-network]]和其他深度网络。", "Dropout regularization, proposed by [[geoffrey-hinton]]'s group, prevents overfitting by randomly dropping neurons. Widely used in [[convolutional-neural-network]] and other deep networks.", ["geoffrey-hinton", "convolutional-neural-network"]),
    ("sources/adam-optimizer-paper", "Adam: A Method for Stochastic Optimization (Kingma 2014)", "Adam优化器结合了动量和自适应学习率，是[[gradient-descent]]最流行的变体。几乎所有[[transformer-architecture]]模型的训练都使用Adam。", "Adam optimizer combines momentum with adaptive learning rates, the most popular [[gradient-descent]] variant. Used in virtually all [[transformer-architecture]] training.", ["gradient-descent", "transformer-architecture"]),
    ("concepts/knowledge-distillation", "知识蒸馏", "知识蒸馏是[[model-compression]]的核心技术，通过让小模型（学生）学习大模型（教师）的输出分布来传递知识。与[[transfer-learning]]理念相似但方法不同。Hinton（[[geoffrey-hinton]]）最早提出这一概念。", "Knowledge distillation is a core [[model-compression]] technique where a small student model learns from a large teacher model's output distribution. Related to [[transfer-learning]] but methodologically different. First proposed by [[geoffrey-hinton]].", ["model-compression", "transfer-learning", "geoffrey-hinton"]),
    ("concepts/contrastive-learning", "对比学习", "对比学习是[[self-supervised-learning]]的重要方法，通过拉近正样本对、推远负样本对来学习表示。SimCLR和MoCo是经典方法。在视觉（[[convolutional-neural-network]]）和语言（[[transformer-architecture]]）领域都有广泛应用。", "Contrastive learning is a key [[self-supervised-learning]] method that learns representations by pulling positive pairs closer and pushing negative pairs apart. SimCLR and MoCo are classic methods. Applied in vision ([[convolutional-neural-network]]) and language ([[transformer-architecture]]).", ["self-supervised-learning", "convolutional-neural-network", "transformer-architecture"]),
    ("concepts/multi-modal-learning", "多模态学习", "多模态学习处理来自不同模态（文本、图像、音频）的数据。GPT-4（[[gpt4-technical-report]]）是多模态大模型的代表。CLIP连接了视觉和语言模态。[[attention-mechanism]]是跨模态对齐的关键技术。在[[ai-drug-discovery]]中，多模态学习可以同时处理分子结构和文本描述。", "Multi-modal learning processes data from different modalities (text, image, audio). GPT-4 ([[gpt4-technical-report]]) exemplifies multimodal LLMs. CLIP bridges vision and language. [[attention-mechanism]] is key for cross-modal alignment. In [[ai-drug-discovery]], multi-modal learning processes molecular structures and text simultaneously.", ["gpt4-technical-report", "attention-mechanism", "ai-drug-discovery"]),
]:
    typ = "source" if name.startswith("sources/") else "concept"
    P(name, title, typ, "ml", ["ml"], content_zh, content_en, links=lnk)

# ══════════════════════════════════════════════════════════════════════════
# DOMAIN 2: Sustainable Energy (35 pages)
# ══════════════════════════════════════════════════════════════════════════

for name, title, typ, tags, czh, cen, lnk in [
    ("entities/tesla-energy", "Tesla Energy", "entity", ["solar","battery"], "Tesla Energy是特斯拉的能源部门，提供Powerwall家用储能、Megapack商业储能和太阳能屋顶产品。使用[[battery-technology]]中的锂离子电池。与[[catl]]合作供应电池。Megapack在[[smart-grid]]中提供调峰服务。", "Tesla Energy provides Powerwall home storage, Megapack commercial storage, and solar roof products. Uses lithium-ion [[battery-technology]]. Partners with [[catl]] for battery supply. Megapack provides peak shaving in [[smart-grid]].", ["battery-technology","catl","smart-grid"]),
    ("entities/iea", "International Energy Agency", "entity", ["policy","statistics"], "国际能源署(IEA)是世界主要的能源政策顾问机构，发布年度《世界能源展望》（[[iea-world-energy-outlook-2024]]）。追踪全球[[photovoltaic-cell]]和[[wind-energy]]部署情况。与[[ipcc-ar6-report]]中的气候目标保持协调。", "The IEA is the world's premier energy policy advisor, publishing the annual World Energy Outlook ([[iea-world-energy-outlook-2024]]). Tracks global [[photovoltaic-cell]] and [[wind-energy]] deployment. Coordinates with [[ipcc-ar6-report]] climate targets.", ["iea-world-energy-outlook-2024","photovoltaic-cell","wind-energy","ipcc-ar6-report"]),
    ("entities/vestas", "Vestas", "entity", ["wind","turbine"], "Vestas是全球最大的风力发电机制造商，在[[wind-energy]]领域占据领导地位。与[[siemens-gamesa]]是主要竞争对手。产品覆盖陆上和海上风电。", "Vestas is the world's largest wind turbine manufacturer, leading in [[wind-energy]]. Competes with [[siemens-gamesa]]. Products cover onshore and offshore wind.", ["wind-energy","siemens-gamesa"]),
    ("entities/catl", "CATL (宁德时代)", "entity", ["battery","lithium"], "宁德时代(CATL)是全球最大的动力电池制造商，在[[battery-technology]]领域占据主导地位。其磷酸铁锂和三元锂电池广泛应用于电动汽车和[[energy-storage]]系统。与[[tesla-energy]]有深度合作。正在研发[[lithium-vs-solid-state]]中的固态电池。", "CATL is the world's largest power battery manufacturer, dominant in [[battery-technology]]. LFP and ternary lithium batteries are used in EVs and [[energy-storage]]. Deep partnership with [[tesla-energy]]. Developing solid-state batteries ([[lithium-vs-solid-state]]).", ["battery-technology","energy-storage","tesla-energy","lithium-vs-solid-state"]),
    ("entities/iter", "ITER", "entity", ["fusion","tokamak"], "ITER是一个国际[[nuclear-fusion]]研究项目，正在法国建造世界最大的托卡马克装置。目标是证明聚变能源的科学可行性。预计2035年实现氘氚等离子体燃烧。与[[brookhaven-national-lab]]等机构合作。", "ITER is an international [[nuclear-fusion]] project building the world's largest tokamak in France. Aims to prove fusion energy feasibility. Plans deuterium-tritium plasma by 2035. Collaborates with [[brookhaven-national-lab]].", ["nuclear-fusion","brookhaven-national-lab"]),
    ("entities/siemens-gamesa", "Siemens Gamesa", "entity", ["offshore","wind"], "Siemens Gamesa是全球领先的海上[[wind-energy]]供应商。其SG 14-222 DD是最大的海上风力发电机之一。与[[vestas]]竞争全球市场份额。", "Siemens Gamesa is a leading offshore [[wind-energy]] provider. Its SG 14-222 DD is among the largest offshore turbines. Competes with [[vestas]] for global market share.", ["wind-energy","vestas"]),
    ("entities/brookhaven-national-lab", "Brookhaven National Laboratory", "entity", ["research","energy"], "布鲁克海文国家实验室是美国能源部下属的研究机构，在[[photovoltaic-cell]]材料、[[nuclear-fusion]]和粒子物理学方面有重要研究。参与[[iter]]项目。", "Brookhaven National Laboratory is a DOE research facility with important work in [[photovoltaic-cell]] materials, [[nuclear-fusion]], and particle physics. Participates in [[iter]].", ["photovoltaic-cell","nuclear-fusion","iter"]),
    ("concepts/photovoltaic-cell", "光伏电池", "concept", ["solar","silicon"], "光伏电池将太阳光直接转化为电能。硅基电池占据主导市场，效率约20-25%。钙钛矿电池（[[nature-perovskite-review]]）是新一代技术，实验室效率已超过25%。与[[wind-energy]]互补形成可再生能源组合（[[solar-vs-wind]]）。[[nrel-solar-futures]]预测光伏将成为美国最大电力来源。", "Photovoltaic cells convert sunlight directly to electricity. Silicon cells dominate at 20-25% efficiency. Perovskite cells ([[nature-perovskite-review]]) are next-gen, exceeding 25% in labs. Complement [[wind-energy]] in renewable mix ([[solar-vs-wind]]). [[nrel-solar-futures]] predicts PV will be the largest US power source.", ["nature-perovskite-review","wind-energy","solar-vs-wind","nrel-solar-futures"]),
    ("concepts/wind-energy", "Wind Energy", "concept", ["renewable","turbine"], "风能是增长最快的可再生能源之一。陆上风电成本已低于化石燃料。海上风电由[[vestas]]和[[siemens-gamesa]]主导。[[iea-world-energy-outlook-2024]]预测风电装机将大幅增长。与[[photovoltaic-cell]]的对比见[[solar-vs-wind]]。风电预测可以使用[[lstm-network]]等时间序列模型。", "Wind energy is among the fastest-growing renewables. Onshore wind costs are below fossil fuels. Offshore wind is led by [[vestas]] and [[siemens-gamesa]]. [[iea-world-energy-outlook-2024]] projects significant capacity growth. Compare with [[photovoltaic-cell]] in [[solar-vs-wind]]. Wind forecasting can use [[lstm-network]] time series models.", ["vestas","siemens-gamesa","iea-world-energy-outlook-2024","photovoltaic-cell","solar-vs-wind","lstm-network"]),
    ("concepts/battery-technology", "电池技术", "concept", ["lithium","storage"], "电池技术是能源转型的关键支撑。锂离子电池（由[[catl]]等制造）是目前主流技术，能量密度约250-300Wh/kg。固态电池（[[lithium-vs-solid-state]]）是下一代方向，有望突破500Wh/kg。电池在[[energy-storage]]和[[smart-grid]]中发挥核心作用。[[tesla-energy]]的Megapack使用锂离子电池。", "Battery technology is key to energy transition. Lithium-ion batteries (manufactured by [[catl]]) are mainstream at 250-300Wh/kg. Solid-state batteries ([[lithium-vs-solid-state]]) target 500+Wh/kg. Batteries are central to [[energy-storage]] and [[smart-grid]]. [[tesla-energy]] Megapack uses lithium-ion.", ["catl","lithium-vs-solid-state","energy-storage","smart-grid","tesla-energy"]),
    ("concepts/carbon-capture", "Carbon Capture and Storage", "concept", ["ccs","climate"], "碳捕获与封存(CCS)技术从工业排放或大气中捕获CO₂并永久封存。直接空气捕获(DAC)可以从大气中直接抽取CO₂。[[ipcc-ar6-report]]认为CCS是实现净零排放的必要手段。与[[climate-economics]]中的碳定价政策密切相关。", "Carbon Capture and Storage (CCS) captures CO₂ from industrial emissions or atmosphere. Direct Air Capture (DAC) extracts CO₂ from air. [[ipcc-ar6-report]] considers CCS necessary for net zero. Closely linked to carbon pricing in [[climate-economics]].", ["ipcc-ar6-report","climate-economics"]),
    ("concepts/smart-grid", "智能电网", "concept", ["iot","grid"], "智能电网利用数字技术优化电力的生成、分配和消费。需求响应允许用户根据电价调整用电。分布式发电（如[[photovoltaic-cell]]）要求电网具备双向调度能力。[[lstm-network]]和[[reinforcement-learning]]被用于负荷预测和优化调度（见[[smart-grid-ml]]）。[[tesla-energy]]的储能产品是智能电网的重要组成部分。", "Smart grids use digital technology to optimize power generation, distribution, and consumption. Demand response adjusts usage based on pricing. Distributed generation (like [[photovoltaic-cell]]) requires bidirectional dispatch. [[lstm-network]] and [[reinforcement-learning]] are used for load forecasting and optimization ([[smart-grid-ml]]). [[tesla-energy]] storage is key to smart grids.", ["photovoltaic-cell","lstm-network","reinforcement-learning","smart-grid-ml","tesla-energy"]),
    ("concepts/hydrogen-fuel-cell", "氢燃料电池", "concept", ["hydrogen","pem"], "氢燃料电池通过氢气和氧气的电化学反应产生电能，副产物仅为水。质子交换膜(PEM)燃料电池是主流技术。绿色氢气通过可再生能源（[[photovoltaic-cell]]、[[wind-energy]]）电解水制取。与[[battery-technology]]在不同应用场景中互补。是[[energy-storage]]的另一种形式。", "Hydrogen fuel cells produce electricity via electrochemical reaction of H₂ and O₂, with water as the only byproduct. PEM is the mainstream technology. Green hydrogen is produced by electrolysis using renewables ([[photovoltaic-cell]], [[wind-energy]]). Complements [[battery-technology]] in different applications. Another form of [[energy-storage]].", ["photovoltaic-cell","wind-energy","battery-technology","energy-storage"]),
    ("concepts/nuclear-fusion", "核聚变", "concept", ["tokamak","plasma"], "核聚变是模仿太阳产能方式的能源技术，将轻元素核融合释放巨大能量。托卡马克是最有前景的聚变装置，[[iter]]正在建造世界最大的托卡马克。等离子体约束是核心挑战。如果实现商业化，将提供几乎无限的清洁能源。与[[energy-policy-history]]中的能源革命愿景相关。", "Nuclear fusion mimics the Sun, fusing light nuclei to release enormous energy. Tokamaks are the most promising devices; [[iter]] is building the world's largest. Plasma confinement is the core challenge. Commercial fusion would provide virtually unlimited clean energy. Related to energy revolution visions in [[energy-policy-history]].", ["iter","energy-policy-history"]),
    ("concepts/energy-storage", "储能技术", "concept", ["grid","storage"], "储能技术是可再生能源大规模应用的关键。[[battery-technology]]（锂离子、固态）是最灵活的储能方式。抽水蓄能是最成熟的大规模储能。压缩空气和飞轮储能适用于特定场景。[[hydrogen-fuel-cell]]可以作为长时储能手段。[[smart-grid]]需要多种储能技术协同工作。", "Energy storage is key to large-scale renewable deployment. [[battery-technology]] (lithium-ion, solid-state) is most flexible. Pumped hydro is the most mature large-scale storage. Compressed air and flywheels suit specific scenarios. [[hydrogen-fuel-cell]] serves as long-duration storage. [[smart-grid]] needs multiple storage technologies.", ["battery-technology","hydrogen-fuel-cell","smart-grid"]),
    # Energy Sources
    ("sources/ipcc-ar6-report", "IPCC AR6 Climate Report (2021)", "source", ["climate","policy"], "IPCC第六次评估报告是全球气候变化最权威的科学评估，指出必须在2030年前大幅减少温室气体排放。报告强调了[[photovoltaic-cell]]和[[wind-energy]]的成本下降趋势，以及[[carbon-capture]]技术的必要性。与[[climate-economics]]中的经济转型路径密切相关。", "The IPCC AR6 report is the most authoritative climate assessment, stating emissions must be drastically cut by 2030. Highlights [[photovoltaic-cell]] and [[wind-energy]] cost declines and [[carbon-capture]] necessity. Closely related to economic transition in [[climate-economics]].", ["photovoltaic-cell","wind-energy","carbon-capture","climate-economics"]),
    ("sources/iea-world-energy-outlook-2024", "IEA World Energy Outlook 2024", "source", ["energy","forecast"], "[[iea]]发布的2024年世界能源展望预测全球能源格局。报告分析了[[photovoltaic-cell]]、[[wind-energy]]、[[nuclear-fusion]]等技术的发展前景。指出[[battery-technology]]成本将继续下降。", "The [[iea]] World Energy Outlook 2024 projects the global energy landscape. Analyzes prospects for [[photovoltaic-cell]], [[wind-energy]], and [[nuclear-fusion]]. Projects continued [[battery-technology]] cost decline.", ["iea","photovoltaic-cell","wind-energy","nuclear-fusion","battery-technology"]),
    ("sources/nrel-solar-futures", "NREL Solar Futures Study (2021)", "source", ["solar","us"], "美国国家可再生能源实验室(NREL)的太阳能未来研究预测[[photovoltaic-cell]]将成为美国最大的电力来源。报告分析了大规模太阳能部署对[[smart-grid]]和[[energy-storage]]的需求。", "NREL's Solar Futures Study projects [[photovoltaic-cell]] as the largest US power source. Analyzes large-scale solar's demands on [[smart-grid]] and [[energy-storage]].", ["photovoltaic-cell","smart-grid","energy-storage"]),
    ("sources/bnef-energy-transition", "BloombergNEF New Energy Outlook", "source", ["finance","energy"], "彭博新能源财经的《新能源展望》分析了全球能源转型的投资趋势。覆盖[[photovoltaic-cell]]、[[wind-energy]]、[[battery-technology]]和[[hydrogen-fuel-cell]]的成本曲线和市场预测。与[[climate-economics]]中的绿色投资讨论相关。", "BloombergNEF's New Energy Outlook analyzes global energy transition investment. Covers cost curves and forecasts for [[photovoltaic-cell]], [[wind-energy]], [[battery-technology]], and [[hydrogen-fuel-cell]]. Related to green investment in [[climate-economics]].", ["photovoltaic-cell","wind-energy","battery-technology","hydrogen-fuel-cell","climate-economics"]),
    ("sources/nature-perovskite-review", "Perovskite Solar Cells Review (Nature Energy 2023)", "source", ["perovskite","solar"], "Nature Energy发表的钙钛矿太阳能电池综述介绍了这种新型[[photovoltaic-cell]]材料的最新进展。钙钛矿电池效率快速提升，可能与硅电池形成叠层结构。但稳定性和环境影响仍需解决。", "This Nature Energy review covers advances in perovskite [[photovoltaic-cell]] materials. Rapidly improving efficiency may enable tandem structures with silicon. Stability and environmental concerns remain.", ["photovoltaic-cell"]),
    # Additional energy pages
    ("concepts/carbon-pricing", "碳定价机制", "concept", ["policy","emissions"], "碳定价通过碳税或碳排放交易体系(ETS)为碳排放设定价格。欧盟碳交易市场是全球最大的ETS。与[[carbon-capture]]投资激励和[[climate-economics]]密切相关。", "Carbon pricing sets a price on emissions via carbon tax or Emissions Trading Systems (ETS). The EU ETS is the world's largest. Closely linked to [[carbon-capture]] investment incentives and [[climate-economics]].", ["carbon-capture","climate-economics"]),
    ("concepts/offshore-wind", "海上风电", "concept", ["wind","offshore"], "海上风电利用近海和远海的风力资源发电。[[siemens-gamesa]]和[[vestas]]是主要设备制造商。海上风电的风速更稳定但建设成本更高。浮式风电技术正在拓展可用海域范围。", "Offshore wind harvests ocean wind resources. [[siemens-gamesa]] and [[vestas]] are major equipment manufacturers. Offshore wind has steadier speeds but higher construction costs. Floating turbine technology expands usable sea areas.", ["siemens-gamesa","vestas"]),
    ("concepts/grid-parity", "平价上网", "concept", ["solar","economics"], "平价上网指可再生能源发电成本等于或低于传统化石燃料。[[photovoltaic-cell]]和[[wind-energy]]在许多地区已经实现平价。[[bnef-energy-transition]]的数据显示成本持续下降。", "Grid parity means renewable energy costs equal or less than fossil fuels. [[photovoltaic-cell]] and [[wind-energy]] have achieved parity in many regions. [[bnef-energy-transition]] data shows continued cost decline.", ["photovoltaic-cell","wind-energy","bnef-energy-transition"]),
    ("concepts/microgrid", "微电网", "concept", ["distributed","resilience"], "微电网是可以独立运行或与主电网连接的小型电力系统。整合[[photovoltaic-cell]]、[[battery-technology]]和智能控制。是[[smart-grid]]的分布式单元。在偏远地区和应急场景中尤为重要。", "Microgrids are small power systems that operate independently or grid-connected. Integrate [[photovoltaic-cell]], [[battery-technology]], and smart controls. Distributed units of the [[smart-grid]]. Vital for remote areas and emergencies.", ["photovoltaic-cell","battery-technology","smart-grid"]),
    ("entities/longi-green", "隆基绿能", "entity", ["solar","manufacturing"], "隆基绿能是全球最大的单晶硅[[photovoltaic-cell]]制造商。推动了单晶硅电池在全球的普及，降低了光伏发电成本。与[[nrel-solar-futures]]中描述的太阳能增长趋势一致。", "LONGi Green Energy is the world's largest monocrystalline silicon [[photovoltaic-cell]] manufacturer. Drove global monocrystalline adoption, reducing PV costs. Aligns with solar growth trends in [[nrel-solar-futures]].", ["photovoltaic-cell","nrel-solar-futures"]),
]:
    P(name, title, typ, "energy", tags, czh, cen, links=lnk)

# ══════════════════════════════════════════════════════════════════════════
# DOMAINS 3-8 + Cross-domain (remaining ~195 pages)
# Using more compact format for efficiency
# ══════════════════════════════════════════════════════════════════════════

# We'll use a compact data structure and generate content from templates
COMPACT_PAGES = [
    # ── Domain 3: Biomedicine (35 pages) ──
    ("entities/pfizer", "Pfizer (辉瑞)", "entity", "bio", ["vaccine","pharma"], ["mrna-technology","fda","covid-vaccine-development"], False),
    ("entities/crispr-therapeutics", "CRISPR Therapeutics", "entity", "bio", ["gene-editing"], ["crispr-gene-editing","fda"], False),
    ("entities/who", "World Health Organization", "entity", "bio", ["global-health"], ["pandemic-preparedness","clinical-trial-phases"], False),
    ("entities/fda", "FDA (美国食品药品监督管理局)", "entity", "bio", ["regulation","approval"], ["drug-discovery-pipeline","clinical-trial-phases"], False),
    ("entities/moderna", "Moderna", "entity", "bio", ["mrna","vaccine"], ["mrna-technology","covid-vaccine-development","pfizer"], False),
    ("entities/illumina", "Illumina", "entity", "bio", ["sequencing"], ["genomics","human-genome-project"], False),
    ("entities/novartis", "Novartis (诺华)", "entity", "bio", ["car-t","pharma"], ["car-t-therapy","cancer-immunotherapy-review"], False),
    ("entities/roche", "Roche (罗氏)", "entity", "bio", ["diagnostics","pharma"], ["drug-discovery-pipeline","antibody-drug-conjugate"], False),
    ("entities/astrazeneca", "AstraZeneca (阿斯利康)", "entity", "bio", ["oncology"], ["antibody-drug-conjugate","clinical-trial-phases"], False),
    ("concepts/crispr-gene-editing", "CRISPR基因编辑", "concept", "bio", ["cas9","guide-rna"], ["crispr-therapeutics","crispr-nobel-lecture","genomics","protein-folding"], False),
    ("concepts/mrna-technology", "mRNA技术", "concept", "bio", ["vaccine","lipid-nanoparticle"], ["pfizer","moderna","covid-vaccine-development","mrna-vs-traditional-vaccines"], False),
    ("concepts/car-t-therapy", "CAR-T细胞疗法", "concept", "bio", ["immunotherapy"], ["novartis","cancer-immunotherapy-review"], False),
    ("concepts/drug-discovery-pipeline", "Drug Discovery Pipeline", "concept", "bio", ["clinical-trial","target"], ["fda","clinical-trial-phases","ai-drug-discovery","explainable-ai"], False),
    ("concepts/genomics", "基因组学", "concept", "bio", ["sequencing","precision-medicine"], ["illumina","human-genome-project","crispr-gene-editing","federated-learning"], False),
    ("concepts/protein-folding", "蛋白质折叠", "concept", "bio", ["alphafold","structure"], ["deepmind","alphafold-nature-paper","crispr-gene-editing","ai-drug-discovery"], False),
    ("concepts/clinical-trial-phases", "临床试验阶段", "concept", "bio", ["phase","rct"], ["fda","drug-discovery-pipeline"], False),
    ("concepts/antibody-drug-conjugate", "抗体药物偶联物(ADC)", "concept", "bio", ["targeted-therapy"], ["drug-discovery-pipeline","roche","astrazeneca"], False),
    ("concepts/immunotherapy", "免疫疗法", "concept", "bio", ["checkpoint","t-cell"], ["car-t-therapy","cancer-immunotherapy-review"], False),
    ("concepts/gene-therapy", "基因治疗", "concept", "bio", ["vector","delivery"], ["crispr-gene-editing","genomics"], False),
    ("concepts/biomarker", "生物标志物", "concept", "bio", ["diagnosis","prognosis"], ["genomics","drug-discovery-pipeline","clinical-trial-phases"], False),
    ("concepts/pharmacogenomics", "药物基因组学", "concept", "bio", ["precision-medicine"], ["genomics","drug-discovery-pipeline"], True),  # isolated
    ("sources/covid-vaccine-development", "COVID-19 Vaccine Development Timeline (Nature 2021)", "source", "bio", ["covid","vaccine"], ["mrna-technology","pfizer","moderna","pandemic-preparedness"], False),
    ("sources/alphafold-nature-paper", "AlphaFold Protein Structure Database (Nature 2022)", "source", "bio", ["protein","ai"], ["protein-folding","deepmind","ai-drug-discovery"], False),
    ("sources/crispr-nobel-lecture", "CRISPR Nobel Lecture (Doudna & Charpentier 2020)", "source", "bio", ["nobel","gene-editing"], ["crispr-gene-editing","crispr-therapeutics"], False),
    ("sources/cancer-immunotherapy-review", "Cancer Immunotherapy Review (NEJM 2022)", "source", "bio", ["cancer","immunotherapy"], ["car-t-therapy","novartis","immunotherapy"], False),
    ("sources/human-genome-project", "Human Genome Project Final Report (2003)", "source", "bio", ["genome","sequencing"], ["genomics","illumina"], False),
    # ── Domain 4: Software Engineering (30 pages) ──
    ("entities/kubernetes", "Kubernetes", "entity", "swe", ["container","orchestration"], ["docker","microservices","devops"], False),
    ("entities/github", "GitHub", "entity", "swe", ["git","collaboration"], ["code-review","devops","linux-foundation"], False),
    ("entities/docker", "Docker", "entity", "swe", ["container","image"], ["kubernetes","microservices","devops"], False),
    ("entities/linux-foundation", "Linux Foundation", "entity", "swe", ["open-source"], ["kubernetes","github","open-source-economics"], False),
    ("entities/rust-lang", "Rust Programming Language", "entity", "swe", ["memory-safety","ownership"], ["design-patterns","distributed-systems"], False),
    ("entities/vscode", "Visual Studio Code", "entity", "swe", ["ide","extensions"], ["github"], True),  # isolated
    ("entities/postgresql", "PostgreSQL", "entity", "swe", ["database","sql"], ["distributed-systems","sql-vs-nosql"], False),
    ("entities/redis", "Redis", "entity", "swe", ["cache","in-memory"], ["distributed-systems","microservices"], False),
    ("entities/grafana", "Grafana", "entity", "swe", ["monitoring","dashboard"], ["devops"], True),  # isolated
    ("concepts/microservices", "微服务架构", "concept", "swe", ["service-mesh","api-gateway"], ["kubernetes","docker","api-design","distributed-systems","design-patterns"], False),
    ("concepts/devops", "DevOps", "concept", "swe", ["ci-cd","iac"], ["kubernetes","docker","github","accelerate-devops","test-driven-development"], False),
    ("concepts/design-patterns", "设计模式", "concept", "swe", ["singleton","factory"], ["clean-architecture","microservices","api-design"], False),
    ("concepts/distributed-systems", "分布式系统", "concept", "swe", ["cap-theorem","consensus"], ["kubernetes","microservices","designing-data-intensive-apps","blockchain"], False),
    ("concepts/code-review", "Code Review", "concept", "swe", ["peer-review","pull-request"], ["github","test-driven-development","technical-debt"], False),
    ("concepts/test-driven-development", "测试驱动开发(TDD)", "concept", "swe", ["unit-test","red-green"], ["devops","code-review","accelerate-devops"], False),
    ("concepts/api-design", "API Design", "concept", "swe", ["rest","graphql"], ["microservices","rest-vs-graphql","design-patterns"], False),
    ("concepts/technical-debt", "技术债务", "concept", "swe", ["refactoring","code-smell"], ["code-review","clean-architecture","agile-vs-waterfall"], False),
    ("concepts/event-driven-architecture", "事件驱动架构", "concept", "swe", ["message-queue","async"], ["microservices","distributed-systems"], False),
    ("concepts/domain-driven-design", "领域驱动设计(DDD)", "concept", "swe", ["bounded-context","aggregate"], ["microservices","design-patterns","clean-architecture"], False),
    ("concepts/observability", "可观测性", "concept", "swe", ["logging","tracing","metrics"], ["devops","microservices","distributed-systems"], False),
    ("concepts/gitops", "GitOps", "concept", "swe", ["declarative","reconciliation"], ["devops","kubernetes","github"], False),
    ("concepts/service-mesh", "服务网格", "concept", "swe", ["istio","envoy"], ["microservices","kubernetes"], True),  # isolated
    ("sources/designing-data-intensive-apps", "Designing Data-Intensive Applications (Kleppmann 2017)", "source", "swe", ["distributed","data"], ["distributed-systems","postgresql","sql-vs-nosql"], False),
    ("sources/clean-architecture", "Clean Architecture (Robert C. Martin 2017)", "source", "swe", ["architecture","principles"], ["design-patterns","technical-debt","domain-driven-design"], False),
    ("sources/accelerate-devops", "Accelerate: DevOps Research (Forsgren et al. 2018)", "source", "swe", ["dora","metrics"], ["devops","test-driven-development"], False),
    ("sources/google-sre-book", "Site Reliability Engineering (Google 2016)", "source", "swe", ["sre","reliability"], ["devops","observability","kubernetes"], False),
    ("sources/pragmatic-programmer", "The Pragmatic Programmer (Hunt & Thomas 1999)", "source", "swe", ["craftsmanship"], ["code-review","design-patterns"], True),  # isolated
    # ── Domain 5: History & Geopolitics (25 pages) ──
    ("entities/united-nations", "联合国", "entity", "history", ["security-council","peacekeeping"], ["cold-war","decolonization","who","pandemic-preparedness"], False),
    ("entities/european-union", "European Union", "entity", "history", ["integration","euro"], ["bretton-woods","globalization","nato"], False),
    ("entities/world-bank", "世界银行", "entity", "history", ["development","poverty"], ["bretton-woods","imf","globalization"], False),
    ("entities/nato", "NATO", "entity", "history", ["defense","article5"], ["cold-war","european-union"], False),
    ("entities/imf", "International Monetary Fund", "entity", "history", ["sdr","structural-adjustment"], ["bretton-woods","world-bank","financial-crisis-2008"], False),
    ("entities/wto", "World Trade Organization", "entity", "history", ["trade","dispute"], ["globalization","silk-road"], False),
    ("entities/opec", "OPEC", "entity", "history", ["oil","cartel"], ["energy-policy-history","climate-economics"], False),
    ("concepts/cold-war", "冷战", "concept", "history", ["containment","proxy-war"], ["nato","united-nations","decolonization","end-of-history"], False),
    ("concepts/bretton-woods", "布雷顿森林体系", "concept", "history", ["gold-standard","fixed-exchange"], ["imf","world-bank","central-banking","financial-crisis-2008"], False),
    ("concepts/globalization", "全球化", "concept", "history", ["trade","cultural-exchange"], ["silk-road","european-union","wto","industrial-revolution","climate-economics"], False),
    ("concepts/silk-road", "丝绸之路", "concept", "history", ["ancient-trade","bri"], ["globalization","industrial-revolution"], False),
    ("concepts/industrial-revolution", "工业革命", "concept", "history", ["steam-engine","mechanization"], ["globalization","energy-policy-history","climate-economics"], False),
    ("concepts/decolonization", "去殖民化", "concept", "history", ["liberation","post-colonial"], ["cold-war","united-nations"], False),
    ("concepts/marshall-plan", "马歇尔计划", "concept", "history", ["reconstruction","aid"], ["cold-war","european-union","bretton-woods"], False),
    ("concepts/nuclear-deterrence", "核威慑", "concept", "history", ["mad","arms-race"], ["cold-war","nato"], True),  # isolated
    ("concepts/digital-sovereignty", "数字主权", "concept", "history", ["data","governance"], ["globalization","ai-ethics"], False),
    ("sources/guns-germs-steel", "Guns, Germs, and Steel (Jared Diamond 1997)", "source", "history", ["geography","civilization"], ["industrial-revolution","globalization"], False),
    ("sources/sapiens-book", "Sapiens: A Brief History of Humankind (Harari 2011)", "source", "history", ["humanity","evolution"], ["industrial-revolution","globalization"], False),
    ("sources/end-of-history", "The End of History and the Last Man (Fukuyama 1992)", "source", "history", ["liberalism","democracy"], ["cold-war","capitalism-vs-socialism"], False),
    ("sources/clash-of-civilizations", "The Clash of Civilizations (Huntington 1996)", "source", "history", ["culture","conflict"], ["globalization","cold-war"], False),
    ("sources/oil-century", "The Prize: The Epic Quest for Oil (Yergin 1990)", "source", "history", ["oil","geopolitics"], ["opec","energy-policy-history","industrial-revolution"], False),
    # ── Domain 6: Cognitive Science & Psychology (20 pages) ──
    ("entities/daniel-kahneman", "Daniel Kahneman", "entity", "cogsci", ["nobel","behavioral"], ["dual-process-theory","cognitive-biases","behavioral-economics","thinking-fast-and-slow"], False),
    ("entities/noam-chomsky", "Noam Chomsky (乔姆斯基)", "entity", "cogsci", ["linguistics","grammar"], ["working-memory"], True),  # isolated
    ("entities/bci-neuralink", "Neuralink", "entity", "cogsci", ["bci","brain"], ["neuroplasticity","neuroscience-inspired-ai"], False),
    ("entities/apa", "American Psychological Association", "entity", "cogsci", ["psychology","standards"], ["cognitive-biases"], True),  # isolated
    ("concepts/cognitive-biases", "认知偏差", "concept", "cogsci", ["confirmation-bias","anchoring"], ["daniel-kahneman","dual-process-theory","behavioral-economics","ai-ethics"], False),
    ("concepts/dual-process-theory", "双系统理论", "concept", "cogsci", ["system1","system2"], ["daniel-kahneman","cognitive-biases","thinking-fast-and-slow","behavioral-economics"], False),
    ("concepts/neuroplasticity", "神经可塑性", "concept", "cogsci", ["synaptic","learning"], ["spaced-repetition","working-memory","bci-neuralink","neuroscience-inspired-ai"], False),
    ("concepts/selective-attention", "选择性注意", "concept", "cogsci", ["cocktail-party","inattentional-blindness"], ["attention-mechanism","working-memory","neuroscience-of-learning"], False),
    ("concepts/working-memory", "工作记忆", "concept", "cogsci", ["baddeley","phonological-loop"], ["metacognition","selective-attention","spaced-repetition"], False),
    ("concepts/spaced-repetition", "间隔重复", "concept", "cogsci", ["forgetting-curve","srs"], ["anki","neuroplasticity","make-it-stick","feynman-technique"], False),
    ("concepts/metacognition", "元认知", "concept", "cogsci", ["self-regulation","learning-strategies"], ["working-memory","bloom-taxonomy","feynman-technique"], False),
    ("concepts/embodied-cognition", "具身认知", "concept", "cogsci", ["body","perception"], ["neuroplasticity","selective-attention"], False),
    ("concepts/decision-fatigue", "决策疲劳", "concept", "cogsci", ["willpower","ego-depletion"], ["cognitive-biases","dual-process-theory"], False),
    ("concepts/flow-state", "心流状态", "concept", "cogsci", ["csikszentmihalyi","optimal-experience"], ["metacognition","selective-attention"], False),
    ("concepts/growth-mindset", "成长型思维", "concept", "cogsci", ["dweck","fixed-mindset"], ["neuroplasticity","metacognition","bloom-taxonomy"], False),
    ("sources/thinking-fast-and-slow", "Thinking, Fast and Slow (Kahneman 2011)", "source", "cogsci", ["behavioral","decision"], ["daniel-kahneman","dual-process-theory","cognitive-biases","behavioral-economics"], False),
    ("sources/neuroscience-of-learning", "The Neuroscience of Learning (Nature Reviews 2020)", "source", "cogsci", ["brain","learning"], ["neuroplasticity","spaced-repetition","selective-attention"], False),
    ("sources/predictably-irrational", "Predictably Irrational (Dan Ariely 2008)", "source", "cogsci", ["behavioral","irrational"], ["cognitive-biases","behavioral-economics"], False),
    # ── Domain 7: Finance & Economics (20 pages) ──
    ("entities/fed", "美联储(Federal Reserve)", "entity", "finance", ["monetary-policy","interest-rate"], ["central-banking","financial-crisis-2008","bretton-woods"], False),
    ("entities/jpmorgan", "JPMorgan Chase", "entity", "finance", ["investment-banking","trading"], ["quantitative-trading","risk-management","financial-crisis-2008"], False),
    ("entities/binance", "Binance (币安)", "entity", "finance", ["crypto","exchange"], ["blockchain"], False),
    ("entities/goldman-sachs", "Goldman Sachs (高盛)", "entity", "finance", ["investment-banking"], ["quantitative-trading","risk-management"], False),
    ("entities/sec", "SEC (美国证券交易委员会)", "entity", "finance", ["regulation"], ["quantitative-trading","blockchain"], True),  # isolated
    ("concepts/quantitative-trading", "量化交易", "concept", "finance", ["algorithmic","backtesting"], ["jpmorgan","goldman-sachs","risk-management","algorithmic-trading-ml","lstm-network","flash-boys"], False),
    ("concepts/blockchain", "区块链技术", "concept", "finance", ["distributed-ledger","smart-contract"], ["binance","distributed-systems"], False),
    ("concepts/risk-management", "风险管理", "concept", "finance", ["var","monte-carlo"], ["quantitative-trading","financial-crisis-2008","jpmorgan","explainable-ai","federated-learning"], False),
    ("concepts/behavioral-economics", "行为经济学", "concept", "finance", ["prospect-theory","loss-aversion"], ["daniel-kahneman","cognitive-biases","dual-process-theory","reinforcement-learning","thinking-fast-and-slow"], False),
    ("concepts/modern-portfolio-theory", "现代投资组合理论", "concept", "finance", ["markowitz","efficient-frontier"], ["risk-management","quantitative-trading"], False),
    ("concepts/central-banking", "中央银行制度", "concept", "finance", ["monetary-policy","qe"], ["fed","bretton-woods","financial-crisis-2008"], False),
    ("concepts/financial-crisis-2008", "2008金融危机", "concept", "finance", ["subprime","cdo"], ["fed","central-banking","risk-management","imf","black-swan-book"], False),
    ("concepts/cryptocurrency", "加密货币", "concept", "finance", ["bitcoin","defi"], ["blockchain","binance"], False),
    ("concepts/esg-investing", "ESG投资", "concept", "finance", ["sustainable","governance"], ["climate-economics","carbon-pricing"], False),
    ("concepts/high-frequency-trading", "高频交易", "concept", "finance", ["latency","market-making"], ["quantitative-trading","flash-boys"], False),
    ("sources/black-swan-book", "The Black Swan (Nassim Taleb 2007)", "source", "finance", ["tail-risk","uncertainty"], ["risk-management","financial-crisis-2008","cognitive-biases"], False),
    ("sources/flash-boys", "Flash Boys (Michael Lewis 2014)", "source", "finance", ["hft","market-structure"], ["high-frequency-trading","quantitative-trading"], False),
    ("sources/intelligent-investor", "The Intelligent Investor (Benjamin Graham 1949)", "source", "finance", ["value-investing"], ["modern-portfolio-theory","behavioral-economics"], True),  # isolated
    # ── Domain 8: Education & Knowledge Management (15 pages) ──
    ("entities/obsidian-app", "Obsidian", "entity", "edu", ["pkm","markdown"], ["zettelkasten","knowledge-graph-methodology"], False),
    ("entities/anki", "Anki", "entity", "edu", ["srs","flashcard"], ["spaced-repetition","make-it-stick"], False),
    ("entities/khan-academy", "Khan Academy (可汗学院)", "entity", "edu", ["online-learning","free"], ["bloom-taxonomy","digital-transformation-education"], False),
    ("entities/coursera", "Coursera", "entity", "edu", ["mooc","certificate"], ["digital-transformation-education"], True),  # isolated
    ("concepts/zettelkasten", "Zettelkasten卡片盒笔记法", "concept", "edu", ["luhmann","atomic-notes"], ["obsidian-app","knowledge-graph-methodology","how-to-take-smart-notes","metacognition"], False),
    ("concepts/feynman-technique", "费曼学习法", "concept", "edu", ["teach-to-learn","simplification"], ["metacognition","bloom-taxonomy","spaced-repetition","transfer-learning"], False),
    ("concepts/bloom-taxonomy", "布鲁姆分类法", "concept", "edu", ["remember","analyze","create"], ["feynman-technique","metacognition","khan-academy","growth-mindset"], False),
    ("concepts/knowledge-graph-methodology", "知识图谱方法论", "concept", "edu", ["ontology","triple"], ["obsidian-app","zettelkasten"], False),
    ("concepts/active-recall", "主动回忆", "concept", "edu", ["testing-effect","retrieval"], ["spaced-repetition","anki","make-it-stick"], False),
    ("concepts/deliberate-practice", "刻意练习", "concept", "edu", ["ericsson","expertise"], ["growth-mindset","feynman-technique"], False),
    ("concepts/constructivism", "建构主义学习理论", "concept", "edu", ["piaget","vygotsky"], ["bloom-taxonomy","metacognition"], True),  # isolated
    ("sources/how-to-take-smart-notes", "How to Take Smart Notes (Ahrens 2017)", "source", "edu", ["zettelkasten","writing"], ["zettelkasten","obsidian-app"], False),
    ("sources/make-it-stick", "Make It Stick: The Science of Successful Learning (Brown 2014)", "source", "edu", ["learning","memory"], ["spaced-repetition","active-recall","anki"], False),
    ("sources/peak-ericsson", "Peak: Secrets from the New Science of Expertise (Ericsson 2016)", "source", "edu", ["deliberate-practice","expertise"], ["deliberate-practice","growth-mindset"], False),
    # ── Cross-Domain: Synthesis (10 pages) ──
    ("synthesis/ai-drug-discovery", "AI驱动的药物发现", "synthesis", "cross", ["ai","pharma"], ["deepmind","protein-folding","alphafold-nature-paper","drug-discovery-pipeline","convolutional-neural-network","transformer-architecture","multi-modal-learning"], False),
    ("synthesis/smart-grid-ml", "机器学习在智能电网中的应用", "synthesis", "cross", ["ml","energy"], ["smart-grid","lstm-network","reinforcement-learning","photovoltaic-cell","energy-storage"], False),
    ("synthesis/algorithmic-trading-ml", "机器学习与量化交易", "synthesis", "cross", ["ml","finance"], ["quantitative-trading","lstm-network","reinforcement-learning","risk-management","transformer-architecture"], False),
    ("synthesis/ai-ethics", "AI伦理与治理", "synthesis", "cross", ["fairness","transparency"], ["anthropic","openai","cognitive-biases","explainable-ai","digital-sovereignty","ai-drug-discovery"], False),
    ("synthesis/climate-economics", "气候变化的经济影响", "synthesis", "cross", ["climate","economics"], ["ipcc-ar6-report","carbon-capture","carbon-pricing","globalization","industrial-revolution","esg-investing","opec"], False),
    ("synthesis/neuroscience-inspired-ai", "神经科学启发的人工智能", "synthesis", "cross", ["brain","ai"], ["attention-mechanism","selective-attention","neuroplasticity","convolutional-neural-network","reinforcement-learning","bci-neuralink"], False),
    ("synthesis/digital-transformation-education", "教育的数字化转型", "synthesis", "cross", ["edtech","ai"], ["khan-academy","coursera","spaced-repetition","bloom-taxonomy","transformer-architecture"], False),
    ("synthesis/open-source-economics", "开源软件的经济学", "synthesis", "cross", ["oss","economics"], ["linux-foundation","github","kubernetes","globalization"], False),
    ("synthesis/pandemic-preparedness", "大流行病防范体系", "synthesis", "cross", ["pandemic","policy"], ["who","covid-vaccine-development","mrna-technology","united-nations","genomics"], False),
    ("synthesis/energy-policy-history", "能源政策的历史演变", "synthesis", "cross", ["energy","history"], ["industrial-revolution","opec","ipcc-ar6-report","nuclear-fusion","globalization","oil-century"], False),
    # ── Cross-Domain: Comparison (10 pages) ──
    ("comparison/pytorch-vs-tensorflow", "PyTorch vs TensorFlow", "comparison", "cross", ["framework"], ["pytorch","tensorflow","hugging-face"], False),
    ("comparison/cnn-vs-transformer", "CNN vs Transformer", "comparison", "cross", ["architecture"], ["convolutional-neural-network","transformer-architecture","attention-mechanism"], False),
    ("comparison/solar-vs-wind", "太阳能 vs 风能", "comparison", "cross", ["renewable"], ["photovoltaic-cell","wind-energy","energy-storage"], False),
    ("comparison/rest-vs-graphql", "REST vs GraphQL", "comparison", "cross", ["api"], ["api-design","microservices"], False),
    ("comparison/sql-vs-nosql", "SQL vs NoSQL", "comparison", "cross", ["database"], ["postgresql","distributed-systems","designing-data-intensive-apps"], False),
    ("comparison/mrna-vs-traditional-vaccines", "mRNA疫苗 vs 传统疫苗", "comparison", "cross", ["vaccine"], ["mrna-technology","pfizer","moderna","covid-vaccine-development"], False),
    ("comparison/capitalism-vs-socialism", "资本主义 vs 社会主义", "comparison", "cross", ["economic-system"], ["industrial-revolution","cold-war","end-of-history","globalization"], False),
    ("comparison/lstm-vs-gru", "LSTM vs GRU", "comparison", "cross", ["rnn"], ["lstm-network","backpropagation","transformer-architecture"], False),
    ("comparison/lithium-vs-solid-state", "锂离子电池 vs 固态电池", "comparison", "cross", ["battery"], ["battery-technology","catl","energy-storage"], False),
    ("comparison/agile-vs-waterfall", "敏捷 vs 瀑布", "comparison", "cross", ["methodology"], ["devops","test-driven-development","technical-debt"], False),
]

# Content templates for compact pages
DOMAIN_CONTEXT = {
    "bio": ("生物医药", "biomedical research"),
    "swe": ("软件工程", "software engineering"),
    "history": ("历史与地缘政治", "history and geopolitics"),
    "cogsci": ("认知科学与心理学", "cognitive science and psychology"),
    "finance": ("金融与经济", "finance and economics"),
    "edu": ("教育与知识管理", "education and knowledge management"),
    "cross": ("跨领域", "cross-domain"),
}

TYPE_TEMPLATES_ZH = {
    "entity": "{title}是{domain_zh}领域的重要实体。{links_text_zh}",
    "concept": "{title}是{domain_zh}领域的核心概念。{links_text_zh}",
    "source": "{title}是{domain_zh}领域的重要参考文献。{links_text_zh}",
    "synthesis": "{title}是一篇跨领域综合分析。{links_text_zh}",
    "comparison": "{title}是一篇对比分析。{links_text_zh}",
}

TYPE_TEMPLATES_EN = {
    "entity": "{title} is a key entity in {domain_en}. {links_text_en}",
    "concept": "{title} is a core concept in {domain_en}. {links_text_en}",
    "source": "{title} is an important reference in {domain_en}. {links_text_en}",
    "synthesis": "{title} is a cross-domain synthesis. {links_text_en}",
    "comparison": "{title} is a comparative analysis. {links_text_en}",
}

def generate_links_text(links, lang="zh"):
    if not links:
        return ""
    link_refs = ", ".join(f"[[{l}]]" for l in links[:5])
    if lang == "zh":
        return f"与{link_refs}密切相关。这些关联体现了知识网络中的重要连接。深入了解这些关系有助于建立更全面的知识图谱。"
    return f"Closely related to {link_refs}. These connections reflect important links in the knowledge network. Understanding these relationships helps build a comprehensive knowledge graph."

# Register compact pages
for path, title, typ, domain, tags, links, isolated in COMPACT_PAGES:
    domain_zh, domain_en = DOMAIN_CONTEXT.get(domain, ("", ""))
    links_zh = generate_links_text(links, "zh")
    links_en = generate_links_text(links, "en")
    czh = TYPE_TEMPLATES_ZH[typ].format(title=title, domain_zh=domain_zh, links_text_zh=links_zh)
    cen = TYPE_TEMPLATES_EN[typ].format(title=title, domain_en=domain_en, links_text_en=links_en)
    P(path, title, typ, domain, tags, czh, cen, links=links if not isolated else [], isolated=isolated)

# ── Generate files ─────────────────────────────────────────────────────────

def random_date():
    month = random.randint(1, 4)
    day = random.randint(1, 28)
    return f"2026-{month:02d}-{day:02d}"

def write_page(page):
    """Write a single wiki page as .md file."""
    path = BASE / f"{page['path']}.md"
    path.parent.mkdir(parents=True, exist_ok=True)

    created = random_date()
    # Choose language: 40% Chinese, 60% English
    use_zh = random.random() < 0.4
    content = page["content_zh"] if use_zh else page["content_en"]

    # Build wikilinks into content if not already present
    for link in page["links"]:
        if f"[[{link}]]" not in content:
            content += f" See also [[{link}]]."

    sources_yaml = json.dumps(page["sources_field"]) if page["sources_field"] else "[]"
    tags_yaml = json.dumps(page["tags"])
    related_yaml = json.dumps(page["links"][:5])

    frontmatter = f"""---
type: {page['type']}
title: "{page['title']}"
created: {created}
updated: {created}
sources: {sources_yaml}
tags: {tags_yaml}
related: {related_yaml}
---"""

    full_content = f"""{frontmatter}

# {page['title']}

{content}
"""
    path.write_text(full_content, encoding="utf-8")

def write_index():
    """Write index.md cataloging all pages."""
    path = BASE / "index.md"
    lines = ["---", 'type: index', 'title: "Wiki Index"', f"created: 2026-01-15", "---", "", "# Wiki Index", ""]

    by_type = {}
    for p in PAGES:
        by_type.setdefault(p["type"], []).append(p)

    for typ in ["entity", "concept", "source", "synthesis", "comparison"]:
        pages = by_type.get(typ, [])
        lines.append(f"## {typ.title()}s ({len(pages)})")
        lines.append("")
        for p in sorted(pages, key=lambda x: x["title"]):
            name = p["path"].split("/")[-1]
            lines.append(f"- [[{name}|{p['title']}]]")
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")

def write_overview():
    """Write overview.md."""
    path = BASE / "overview.md"
    domains = {}
    for p in PAGES:
        domains.setdefault(p["domain"], []).append(p)

    content = """---
type: overview
title: "Wiki Overview"
created: 2026-01-15
---

# Wiki Overview

This knowledge base covers 8 major domains with cross-domain synthesis:

"""
    for domain, pages in sorted(domains.items()):
        domain_zh, domain_en = DOMAIN_CONTEXT.get(domain, (domain, domain))
        content += f"## {domain_en.title()} ({domain_zh}) — {len(pages)} pages\n\n"

    content += f"\nTotal: {len(PAGES)} pages across {len(domains)} domains.\n"
    path.write_text(content, encoding="utf-8")

def write_purpose():
    path = BASE / "purpose.md"
    path.write_text("""---
type: purpose
title: "Wiki Purpose"
---

# Purpose

This is a multi-domain personal knowledge base covering machine learning, sustainable energy, biomedicine, software engineering, history, cognitive science, finance, and education. The goal is to build interconnected knowledge across disciplines and discover cross-domain insights.

## Key Questions
- How do different domains influence each other?
- What are the emerging cross-domain trends?
- Where are the knowledge gaps that need further research?

## Research Scope
All 8 domains and their intersections.
""", encoding="utf-8")

def write_schema():
    path = BASE / "schema.md"
    path.write_text("""---
type: schema
title: "Wiki Schema"
---

# Schema

## Page Types
- entity: People, organizations, products, tools
- concept: Methods, theories, techniques, phenomena
- source: Paper summaries, book reviews, reports
- synthesis: Cross-domain analysis
- comparison: Side-by-side comparisons

## Rules
- Every page has YAML frontmatter with type, title, created, tags, related, sources
- Use [[wikilinks]] for cross-references
- Filenames use kebab-case
""", encoding="utf-8")

# ── Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Generating {len(PAGES)} wiki pages...")

    # Clean existing files
    import shutil
    for subdir in ["entities", "concepts", "sources", "synthesis", "comparison"]:
        d = BASE / subdir
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)

    # Write all pages
    for page in PAGES:
        write_page(page)

    # Write structural files
    write_index()
    write_overview()
    write_purpose()
    write_schema()

    # Summary
    by_type = {}
    by_domain = {}
    for p in PAGES:
        by_type[p["type"]] = by_type.get(p["type"], 0) + 1
        by_domain[p["domain"]] = by_domain.get(p["domain"], 0) + 1

    print(f"\nGenerated {len(PAGES)} pages:")
    for t, c in sorted(by_type.items()):
        print(f"  {t}: {c}")
    print(f"\nBy domain:")
    for d, c in sorted(by_domain.items()):
        print(f"  {d}: {c}")

    isolated = sum(1 for p in PAGES if p["isolated"])
    print(f"\nIsolated pages (no wikilinks): {isolated}")
    print(f"\nFiles written to: {BASE}")
