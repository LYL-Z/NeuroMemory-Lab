# v0.4｜Neuronal Surface Study · 神经元三维表面与来源声明

**研究状态：工程实现已完成基础单元测试，真实 GPU 浏览器成像尚未验收。** 不能称其为「真实生物脑数字孪生」。

## 1. 科学问题与可证伪范围

本阶段研究的问题是：**在离线、个人计算机上，能否忠实解析一份数字神经元形态文件的树状连接与采样半径，并用可交互、实时渲染的三维表面展示？**

这不等同于：知道神经元间的突触连接、膜电导分布、细胞内形态全部细节、实际放电、主观意识或完整个人记忆。

| 层级 | 依据 | 当前实现 | 禁止外推 |
|---|---|---|---|
| SWC 形态 | INCF 的 SWC 数字形态规范 | 七列、唯一 ID、有效父节点、无环、有限坐标/半径；保留原始节点与归一化参数 | 单份 SWC 不代表脑区连接组 |
| 表面网格 | 图形学工程选择 | 逐段圆锥台（线性半径变化）、球形胞体、表面法线与简化漫反射/镜面反射，WebGL2 实例化 | 网格是几何近似，不是显微观察到的细胞膜 |
| 活动显示 | 独立计算的 LIF 轨迹 | 由本机 `/api/neural-demo` 返回时标 `ms`、电压 `mV`，仅用灰度表示演示胞体的电压 | **未用导入 SWC 参数拟合，不是该细胞的真实放电** |
| 来源管理 | 学术可追溯性需求 | 原文件字节 SHA-256，物种/脑区/样本 ID/来源/单位的会话内用户声明 | 哈希只校验字节一致，不验证生物学真实性 |

## 2. 几何数学

对于 SWC 的每一条父子边，令三维坐标为 $\mathbf a,\mathbf b$，半径为 $r_a,r_b$。参数 $t\in[0,1]$，沿轴中心线的位置为

\[
\mathbf c(t)=(1-t)\mathbf a+t\mathbf b,\qquad r(t)=(1-t)r_a+tr_b.
\]

取与 $\mathbf b-\mathbf a$ 正交的一对单位方向 $\mathbf e_1,\mathbf e_2$。锥台表面近似为

\[
\mathbf S(t,\theta)=\mathbf c(t)+r(t)(\mathbf e_1\cos\theta+\mathbf e_2\sin\theta).
\]

每周向用 10 边形离散。高性能方案将 10 边形的三角形模板与每条边的起止坐标/半径分别放入 GPU 顶点与实例缓冲。退化为零长度的边被跳过以避免无定义的局部基。球形胞体为 UV 参数网格，属示意近似：SWC 的 soma 有时使用多个点表示非球状几何，不应当将这个球体当作精确重建。

空间归一化：计算所有原始点的轴对齐包围盒中心 $\mathbf o$ 和最大边长 $L$，渲染位置为 $\mathbf p'=3.5(\mathbf p-\mathbf o)/L$。相应半径乘同一系数。**归一化保留单文件内部长度比，但不同文件不能凭屏幕像素比较实际尺寸。** 原始坐标、半径和中心/比例参数在会话内保留。

着色以单色调为主：法线、光线和视线决定物体明暗；深度缓冲决定遮挡；不把不同颜色解释为不同的神经元类型。没有神经元棘突、髓鞘、细胞器、膜蛋白与组织散射模型，也没有真实体渲染。

## 3. 神经活动显示的物理限制

LIF 计算中的膜电位 $V(t)$ 由离散数值积分得到，其对应一个等效点神经元，通常满足

\[
\tau_m \frac{dV}{dt}=-(V-E_L)+R_m I(t),\quad [\tau_m]=\mathrm{ms},\ [V]=\mathrm{mV},\ [R_m I]=\mathrm{mV}.
\]

界面仅把该独立合成实验的时间序列映射到展示模型的**胞体灰度**；每个胞体共享此信号，用于呈现时间变化。没有对任何导入的 SWC 神经元建立真实形态特异性的电缆方程；没有动作电位轴突传播，也没有用实验电生理数据拟合 $R_m, C_m$ 或离子通道。

自动运行禁用。只有用户点击「运行神经计算实验」才向同源本机服务请求合成结果；服务器返回 `personal_data_used=false`、`mode=synthetic_only` 和 `lif_trace.morphology_fitted=false`；前端核验这些标记后才显示结果。不读取 `vault` 私人来源，不调用云端模型。

## 4. SWC 来源与完整性

用户通过文件选择器手动打开文件，浏览器读取原始字节计算 SHA-256，不把 SWC 传给服务器。界面提供*未核验的用户声明*字段：物种、脑区或细胞类型、样本编号、文献/DOI、单位。字段及几何对象仅存在于当前浏览器会话；刷新丢失。

- 不自动将用户填写的来源升级为可信事实。
- 不捆绑未审查许可与引文的真实人类神经元数据。
- 若要引入公开真实形态：优先在官方 Allen Institute Cell Types Database 中按样本获取 SWC、原始元数据，并记录适用许可；或按 NeuroMorpho.Org 的使用条款通过 API 和直接 SWC URL 获取数据，同时提供来源署名及引用。**当前版本不会替用户联网下载。**
- 精确数值比较需使用原始数据而非视觉标定；对于带非标准单位或缺少 metadata 的 SWC，不能直接赋予 µm。

## 5. 可复现命令、已知风险与验收门槛

```bash
python3 -B -m unittest discover -s tests -v
node --check neuromemory_cortex/ui/morphology.js
node --check neuromemory_cortex/ui/morphology3d.js
node --check neuromemory_cortex/ui/app.js
```

测试覆盖：确定性合成树、SWC 错误父节点/环/非法半径、原始节点保留、GPU 锥台/球面顶点数量与确定性、合成电位插值、同源静态资源、演示接口与私人空数据库隔离。

**尚需在 Windows + RTX 5090 Laptop + Chrome/Edge 真机执行**：WebGL2 shader 编译与链接、显存/帧率指标（含 75,000 节点极端情况）、Canvas 2D 降级、减少动态效果、GPU context lost/recovery、DPI 125%/250%、窄屏与键盘交互、不同真实 SWC 格式差异。源码通过不等于这些真实验收通过。

后续科研门槛：先取得明确许可且可追溯的 SWC 样本，冻结样本与哈希，在参考形态工具上复核分支/半径/拓扑，再设计被动膜多区室 RC 电缆实验并用真实电生理记录校准与验证；没有证据时继续明确标示为工程模型。

## 参考资料（MLA）

1. International Neuroinformatics Coordinating Facility. “SWC File Format Specification.” *GitHub*, <https://github.com/INCF/swc-specification/blob/main/docs/source/swc.rst>. Accessed 29 Oct. 2026.
2. NeuroMorpho.Org. “Terms of Use.” *NeuroMorpho.Org*, <https://neuromorpho.org/useterm.jsp>. Accessed 29 Oct. 2026.
3. Allen Institute for Brain Science. “Cell Types.” *AllenSDK Documentation*, <https://alleninstitute.github.io/AllenSDK/cell_types.html>. Accessed 29 Oct. 2026.

这些来源只说明公开形态数据的结构、可获得性与使用条件，**没有被当作当前合成场景的真实测量依据**。
