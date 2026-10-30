# NeuroMemory Cortex · 神经模型实验说明（v0.2）

> 范围：用于可重复、可证伪的计算实验。**不与用户私人记忆直接连通，不代表大脑扫描，也不能据此声称实现意识。**

## 1. 有实证或成熟计算理论支持的部分

1. 神经元以膜电位变化和脉冲参与信息处理；LIF 是对膜电位积分和阈值发放的简化模型，但不包含真实离子通道、树突、胶质、神经递质等。
2. Bi 和 Poo 在培养的海马神经元中发现，突触可塑性的方向与前、后神经元的脉冲时序有关。我们用一个指数时间窗表示这一思想；**其参数没有根据人体数据拟合**。
3. Hopfield 模型给出了有能量函数的联想记忆网络，能从部分受损线索恢复某些已储存模式。它是物理和计算模型，**不是对海马体完整神经回路的重建**。
4. 海马体—新皮层互补学习和记忆重放为多速率记忆提供了研究线索。但个体差异、知识重组、遗忘与再巩固的生物学解释仍存在争议。

## 2. 模型 A：带绝对不应期的 LIF 神经元

在膜电压 `V` 远离阈值时，使用常输入电流近似：

\[
 \tau_m\frac{\mathrm d V}{\mathrm dt}=V_{rest}-V+R_m I.
\]

采用前向 Euler 离散化：

\[
 V_{k+1}=V_k+\frac{\Delta t}{\tau_m}(V_{rest}-V_k+R_mI).
\]

`V >= V_threshold` 时记录一次脉冲、将 `V` 重置为 `V_reset`，并在绝对不应期保持重置电位。

| 参数 | 默认值 | 单位 | 工程含义 |
|---|---:|---|---|
| `tau_ms` | 20 | ms | 有效膜时间常数 |
| `resistance_mohm` | 10 | MΩ | 输入电阻 |
| `rest_mv` | −65 | mV | 静息电位 |
| `threshold_mv` | −50 | mV | 发放阈值 |
| `reset_mv` | −65 | mV | 重置电位 |
| `refractory_ms` | 2 | ms | 绝对不应期 |
| `dt_ms` | 0.25 | ms | 数值积分步长 |

量纲检查：`MΩ × nA = mV`；故 `R_m I` 与电压项量纲一致。

该求解器不是 Hodgkin–Huxley 模型，也不是从 EEG/fMRI 反演出的神经元活动。参数仅用于测试。

## 3. 模型 B：STDP（成对脉冲时序相关可塑性）

定义 `Δt = t_post − t_pre`，采用：

\[
 \Delta w=\begin{cases}
 A_+\exp(-\Delta t/\tau_+),&\Delta t>0,\\
 -A_-\exp(\Delta t/\tau_-),&\Delta t<0,\\
 0,&\Delta t=0.
 \end{cases}
\]

新权重截断到 `[0, 1]`。这一演示忽略频率依赖、钙动力学、抑制性突触、突触饱和、神经调质和实际脑区差异。正负窗是工程设定，不是通用生理定律。

## 4. 模型 C：Hopfield 吸引子网络

训练样本 `x_i^\mu ∈ {−1, +1}`，对称权重：

\[
 w_{ij}=\begin{cases}\frac{1}{N}\sum_\mu x_i^\mu x_j^\mu,&i\neq j,\\0,&i=j.\end{cases}
\]

无外场时的网络能量：

\[
 E(\mathbf s)=-\frac12\sum_{ij} w_{ij}s_i s_j.
\]

每次只异步更新一个单元 `s_i ← sign(Σ_j w_ij s_j)`，若局域场恰好为 0，保留旧状态。对称零对角权重确保在此更新规则下 `E` 不会上升。

测试使用固定的 24 位合成模式，在其上翻转两位作为噪声线索。**测试通过仅证明这组样本的恢复，不代表模型能可靠存储任意大量个人记忆**。经典 Hopfield 网络存在容量和伪吸引子限制。

## 5. 可复现实验

项目根目录运行：

```powershell
py -B -m neuromemory_cortex neural-demo
py -B -m unittest discover -s tests -v
```

模型返回脉冲次数、STDP 增减量、联想记忆恢复位数和能量变化。不给合成数据以外的输入，不调用 LLM/网络，也不读取记忆库正文。

## 6. 哪些是我们提出的工程假设？

| 假设 | 计划验证 | 主要反证条件 |
|---|---|---|
| 双速率快慢记忆可缓解遗忘 | 固定算力预算下比较简单 RAG 与慢巩固模块 | 旧知识准确率未提升，或新知识学习明显受损 |
| 吸引子网络能增强部分线索召回 | 在同样容量和延迟下比较 Hopfield、向量检索、关键词检索 | 在真实评测集上不优于简单基线 |
| STDP/SNN 可提高特定记忆任务效率 | 记录能量、时延、准确率，比较 ANN 基线 | GPU/CPU 能耗更高且无质量收益 |
| 自我模型可以逐渐贴近本人 | 由用户独立评审、版本纠错；统计误归因率 | 稳定生成未经证实的人格断言或冲突记忆 |
| 神经重放可帮助记忆巩固 | 冻结测试集、消融与重复种子 | 增益只来自增加计算预算或测试信息泄漏 |

**意识研究**属于独立的开放科学方向：需要先提出可操作定义、实验指标与伦理界限。模拟放电或生成类似人的文本，不构成主观体验的证明。

## 7. 经过科研插件检索的参考文献（MLA）

- Bi, Guo-qiang, and Mu-ming Poo. “Synaptic Modifications in Cultured Hippocampal Neurons: Dependence on Spike Timing, Synaptic Strength, and Postsynaptic Cell Type.” *The Journal of Neuroscience*, vol. 18, no. 24, 1998, pp. 10464–10472. https://doi.org/10.1523/JNEUROSCI.18-24-10464.1998.
- Hopfield, J. J. “Neural Networks and Physical Systems with Emergent Collective Computational Abilities.” *Proceedings of the National Academy of Sciences*, vol. 79, no. 8, 1982, pp. 2554–2558. https://doi.org/10.1073/pnas.79.8.2554.
- McClelland, James L., Bruce L. McNaughton, and Randall C. O’Reilly. “Why There Are Complementary Learning Systems in the Hippocampus and Neocortex.” *Psychological Review*, vol. 102, no. 3, 1995, pp. 419–457. https://doi.org/10.1037/0033-295X.102.3.419.
- Remme, Michiel W. H., et al. “Hebbian Plasticity in Parallel Synaptic Pathways: A Circuit Mechanism for Systems Memory Consolidation.” *PLOS Computational Biology*, https://doi.org/10.1371/journal.pcbi.1009681.

检索渠道：Litmaps、Undermind。检索工具返回的是文献索引及摘要；引用不意味着我们验证了全部论文实验的可复现性。
