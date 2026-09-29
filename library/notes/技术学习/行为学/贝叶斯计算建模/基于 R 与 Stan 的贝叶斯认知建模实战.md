## 第一章核心哲学：从行为表象到贝叶斯生成模型

计算精神病学（Computational Psychiatry）的核心动机，在于超越传统的描述性统计（如比较总体准确率、反应时）。行为表象往往具有“多对一”的欺骗性：疾病组表现差，可能是因为他们探索欲过强（决策噪声大），也可能是对惩罚过度敏感，甚至是由于前额叶受损导致的行为固着。

为了精准定位疾病的神经认知机制，我们需要搭建一条从宏观到微观的推断链条。

### 1.1 认知建模：将心理过程翻译为数学方程

认知模型是对大脑信息处理过程的数学假设。在反转概率学习（PRL）任务中，我们通常使用**强化学习（Reinforcement Learning, RL）**框架来模拟被试的内部状态演变。

- **价值更新（学习过程）**：大脑根据现实反馈与内心预期的落差（预测误差，Prediction Error, $PE$）来更新对事物的价值评估（$Q$ 或 $EV$）。
    
    $$PE_t = R_t - Q_{t}(choice)$$
    
    $$Q_{t+1}(choice) = Q_t(choice) + \alpha \times PE_t$$
    
    _知识点串联_：这里的 $\alpha$ 即为**学习率**，代表大脑对新信息的吸收权重。
    
- **动作选择（决策过程）**：大脑如何根据内心的价值评估转化为具体的按键动作？通常通过 **Softmax 规则**实现。
    
    $$P(choice=c) = \frac{\exp(\beta \cdot Q_c)}{\sum_{i} \exp(\beta \cdot Q_i)}$$
    
    _知识点串联_：这里的 $\beta$ 即为**逆温度参数（Inverse Temperature）**，它控制着决策的随机性。$\beta$ 越大，被试越倾向于“剥削”当前高分选项（笃定）；$\beta$ 越趋近于 0，被试的按键越接近纯随机（探索）。
    

### 1.2 为什么必须使用贝叶斯分层模型 (HBM)？

当我们用上述 RL 方程去拟合真实被试时，会面临一个巨大的统计学挑战：临床患者的数据往往充满噪声，或者某些被试中途放弃导致试次过少。如果使用传统的极大似然估计（MLE）为每个人独立计算 $\alpha$ 和 $\beta$，极易出现过拟合，得出极其离谱的极端值。

**贝叶斯分层模型（Hierarchical Bayesian Modeling）**通过引入“群体”的概念完美解决了这一问题：

- **生成式框架**：我们假设所有被试并不是孤立的，他们的参数（如 $\alpha_i$）都是从一个共同的“群体正态分布” $\mathcal{N}(\mu_{group}, \sigma_{group})$ 中抽样出来的。
    
- **收缩效应 (Shrinkage)**：在贝叶斯推断中，个体的最终参数估计是“个人数据似然”与“群体先验”博弈的结果。如果某个人的数据质量极差，群体分布的信息就会产生强大的“引力”，将这个离谱的估计强行拉向群体均值。这使得 HBM 成为在小样本、高噪声临床数据中提取参数的最佳方案。
    

---

## 第二章 Stan 概率编程：架构与底层算理

了解了心理学模型与贝叶斯思想，我们需要一种语言将其转化为代码。Stan 是一门专为贝叶斯推断设计的强类型 C++ 衍生语言，它使用哈密顿蒙特卡洛（HMC）算法，能够在复杂的概率空间中高效寻优。

### 2.1 Stan 程序的六大严密区块 (Blocks)

Stan 要求代码必须严格按照以下信息流顺序书写，这构成了数据从现实世界进入虚拟大脑，最终输出推断结果的完整流水线：

1. **`data`（外界输入）**：接收外部常量的严格类型声明区块。任何越界数据（违反 `<lower, upper>`）将引发运行时崩溃。不可包含缺失值（NA）。
    
2. **`transformed data`（数据预处理）**：在马尔可夫链启动前仅执行一次。常用于初始化变量（如 `initV = rep_vector(0.0, 2)`）。
    
3. **`parameters`（待破解的黑匣子）**：声明算法需进行动量模拟和梯度优化的未知参数集（如群体均值 $\mu$，群体方差 $\sigma$）。
    
4. **`transformed parameters`（参数变形器）**：在 MCMC 的每次步进中均被调用。常用于将无边界的算法探索参数，转换为具有物理边界的认知参数。
    
5. **`model`（核心打分系统）**：计算未标准化对数后验密度（Target Log-Posterior）。包含先验约束与似然计算。
    
6. **`generated quantities`（事后诸葛亮）**：在每次接受有效样本后执行一次。用于生成模型预测（PPC数据）、交叉验证对数似然（LOOIC），或跨组差异效应量（$\Delta\mu$）。
    

### 2.2 核心黑科技：非中心化参数化 (Non-centered Parameterization)

在分层模型中，个体参数与其所属的群体参数（$\mu, \sigma$）存在极强的数学耦合。这种几何结构（Neal's Funnel）会导致 HMC 算法卡死（即产生大量发散 Divergences）。

**数学转换（Matt Trick）**：我们将个体差异剥离为一个标准正态分布的 $Z$ 分数，使参数彻底解耦。

$$\theta_i \sim \mathcal{N}(\mu, \sigma) \iff z_i \sim \mathcal{N}(0, 1), \quad \theta_i = \mu + z_i \cdot \sigma$$

- **探索者空间**：在 `parameters` 块声明 $z_i$。
    
- **物理空间**：在 `transformed parameters` 块中，通过 $z_i$ 还原出真实参数，并使用 `Phi_approx()` 将其压缩至 $(0, 1)$ 的物理合法区间（例如学习率）。
    

### 2.3 揭秘魔法符号 `~` 与对数似然的本质

在 `model` 块中，波浪号 `~` 的本质动作是：**“计算左边变量在右边概率分布下的对数概率，并将其累加到系统的全局计分板（`target`）中。”**

它判断自身是“先验”还是“似然”的唯一依据，是左侧变量的“户口出身”：

- **先验打分**：当左边是未知参数时（如定义在 `parameters` 的 `z_alpha ~ normal(0, 1)`），它限制了参数的游走范围。
    
- **似然打分**：当左边是观测事实时（如定义在 `data` 的 `choice ~ categorical_logit(logits)`），它计算模型预测与现实数据的拟合度。这行代码在底层等价于：`target += categorical_logit_lpmf(choice | logits)`。
    

---

## 第三章认知建模的实战陷阱与验证规范

建立模型后，必须经过严格的验证工作流，确保模型“算对了”，并且“像个人”。

### 3.1 变量作用域与状态分离 ($Q$ vs $Q[choice]$)

在时间序列迭代中，价值变量的使用必须极其精准：

- **做决策（算似然）时，看全局**：`choice ~ categorical_logit(beta * Q)`。Softmax 机制必须对比所有选项以生成概率分布，因此需传入完整的预期向量 $Q$。
    
- **算误差（更新价值）时，看局部**：$PE = outcome - Q[choice]$。现实环境的物理反馈仅针对实际执行的动作，因此必须通过动态索引 `[choice]` 提取标量进行更新。
    

### 3.2 参数可恢复性 vs 后验预测检查 (PPC)

这两者是验证计算模型的两把不可或缺的利剑。

- **参数可恢复性 (Parameter Recovery / 前瞻验证)**：在接触真实数据前，在 R 语言中用已知的“真参数”模拟假被试，验证你的 Stan 代码和实验设计（如试次数是否足够）能否把“真参数”反推出来。
    
- **后验预测检查 (PPC / 回顾验证)**：拟合真实数据后，使用提取出的后验参数，让模型假扮成被试重新做任务（在 `generated quantities` 中利用 `_rng` 函数生成 `y_pred`），检验假数据的学习曲线是否与真实被试重合。
    

> **致命陷阱：一步向前预测 (One-step-ahead)**
> 
> 在生成 PPC 数据时，虽然模型输出了假动作 `y_pred`，但在推进到下一试次并更新内心 $Q$ 值时，**必须强制使用被试真实的观测动作 `choice`**。否则，模型的“记忆状态”将因为自己瞎猜的动作而与真实被试产生蝴蝶效应般的分歧。

---

## 第四章全栈实战：多组反事实更新模型 (Multi-group Fictitious Update)

此代码集成了我们讨论的所有最高阶机制：**双学习率、反事实推理、非中心化分层联合估计，以及组间差异的直接后验推断**。

### 4.1 Stan 模型代码 (`multigroup_fictitious.stan`)

该模型支持传入多组（$G \ge 2$）数据，自动实现不同群体向各自超参数收缩。


```c++
// 文件名: multigroup_fictitious.stan
data {
  int<lower=1> N;                     // 被试总数
  int<lower=2> G;                     // 组别总数 (如: 2组)
  int<lower=1, upper=G> group[N];     // 核心：群体身份索引
  
  int<lower=1> T;                     
  int<lower=1, upper=T> Tsubj[N];     
  int<lower=-1, upper=2> choice[N, T];// -1 为漏答试次
  real outcome[N, T];                 
}

transformed data {
  vector[2] initV = rep_vector(0.0, 2); 
}

parameters {
  // 组级超参数矩阵
  vector[G] mu_pr_eta_pos;
  vector<lower=0>[G] sigma_eta_pos;
  vector[G] mu_pr_eta_neg;
  vector<lower=0>[G] sigma_eta_neg;
  vector[G] mu_pr_beta;
  vector<lower=0>[G] sigma_beta;

  // 个体级 Z 分数
  vector[N] eta_pos_pr;   
  vector[N] eta_neg_pr;   
  vector[N] beta_pr;      
}

transformed parameters {
  vector<lower=0, upper=1>[N] eta_pos;
  vector<lower=0, upper=1>[N] eta_neg;
  vector<lower=0, upper=10>[N] beta;

  for (i in 1:N) {
    // 依据 group[i] 精准索引超参数并执行非中心化还原
    eta_pos[i] = Phi_approx(mu_pr_eta_pos[group[i]] + sigma_eta_pos[group[i]] * eta_pos_pr[i]);
    eta_neg[i] = Phi_approx(mu_pr_eta_neg[group[i]] + sigma_eta_neg[group[i]] * eta_neg_pr[i]);
    beta[i]    = Phi_approx(mu_pr_beta[group[i]]    + sigma_beta[group[i]]    * beta_pr[i]) * 10;
  }
}

model {
  // 组级超参数先验 (向量化)
  mu_pr_eta_pos ~ normal(0, 1);
  sigma_eta_pos ~ normal(0, 0.2);
  mu_pr_eta_neg ~ normal(0, 1);
  sigma_eta_neg ~ normal(0, 0.2);
  mu_pr_beta ~ normal(0, 1);
  sigma_beta ~ normal(0, 0.2);

  // 个体级先验
  eta_pos_pr ~ normal(0, 1);
  eta_neg_pr ~ normal(0, 1);
  beta_pr    ~ normal(0, 1);

  // 强化学习动力学演化
  for (i in 1:N) {
    vector[2] ev = initV;    
    vector[2] prob;  
    real PE;    
    real PEnc;   

    for (t in 1:(Tsubj[i])) {
      if (choice[i, t] != -1) { 
        // 软最大化降维逻辑回归表达
        prob[1] = 1 / (1 + exp(beta[i] * (ev[2] - ev[1])));
        prob[2] = 1 - prob[1];
        
        // 似然累加
        choice[i, t] ~ categorical(prob);

        // 真实预测误差 (PE) 与反事实预测误差 (PEnc)
        PE   =  outcome[i, t] - ev[choice[i, t]];
        PEnc = -outcome[i, t] - ev[3 - choice[i, t]];

        // 价值系统异步更新
        if (PE >= 0) {
          ev[choice[i, t]]      += eta_pos[i] * PE;
          ev[3 - choice[i, t]]  += eta_pos[i] * PEnc;
        } else {
          ev[choice[i, t]]      += eta_neg[i] * PE;
          ev[3 - choice[i, t]]  += eta_neg[i] * PEnc;
        }
      }
    }
  }
}

generated quantities {
  // 提取各组的物理真实均值
  vector<lower=0, upper=1>[G] mu_eta_pos;
  vector<lower=0, upper=1>[G] mu_eta_neg;
  vector<lower=0, upper=10>[G] mu_beta;

  // 组间差异量
  real delta_eta_pos;
  real delta_eta_neg;
  real delta_beta;

  // PPC 及交叉验证数据容器
  real log_lik[N];
  real y_pred[N, T];

  for (g in 1:G) {
    mu_eta_pos[g] = Phi_approx(mu_pr_eta_pos[g]);
    mu_eta_neg[g] = Phi_approx(mu_pr_eta_neg[g]);
    mu_beta[g]    = Phi_approx(mu_pr_beta[g]) * 10;
  }

  // 计算协变量效应 (假设 2=疾病组, 1=健康对照)
  delta_eta_pos = mu_eta_pos[2] - mu_eta_pos[1];
  delta_eta_neg = mu_eta_neg[2] - mu_eta_neg[1];
  delta_beta    = mu_beta[2] - mu_beta[1];

  for (i in 1:N) {
    for (t in 1:T) y_pred[i, t] = -1; // 初始化缺失值
  }

  { // 局部变量区：加速执行与节省内存
    for (i in 1:N) {
      vector[2] ev = initV;
      vector[2] prob;
      real PE;
      real PEnc;
      log_lik[i] = 0;

      for (t in 1:(Tsubj[i])) {
        if (choice[i, t] != -1) {
          prob[1] = 1 / (1 + exp(beta[i] * (ev[2] - ev[1])));
          prob[2] = 1 - prob[1];

          // 提取逐试次对数似然 (供 LOOIC 计算)
          log_lik[i]  += categorical_lpmf(choice[i, t] | prob);
          
          // 生成随机假动作 (供 PPC 检验)
          y_pred[i, t] = categorical_rng(prob); 

          PE   =  outcome[i, t] - ev[choice[i, t]];
          PEnc = -outcome[i, t] - ev[3 - choice[i, t]];

          // 一步向前推断：强制使用真实观测动作进行记忆更新
          if (PE >= 0) {
            ev[choice[i, t]]      += eta_pos[i] * PE;
            ev[3 - choice[i, t]]  += eta_pos[i] * PEnc;
          } else {
            ev[choice[i, t]]      += eta_neg[i] * PE;
            ev[3 - choice[i, t]]  += eta_neg[i] * PEnc;
          }
        }
      }
    }
  }
}
```

### 4.2 R 语言端分析流水线 (数据准备、采样与推断)

此脚本涵盖了实验数据模拟构建、并行 MCMC 采样，直至最终剥离 P 值、直接利用最高密度区间（HDI）进行贝叶斯统计推断的标准图表生成。

```r
library(tidyverse)
library(rstan)
library(bayesplot)
library(loo)

# 开启 C++ 编译并行加速
options(mc.cores = parallel::detectCores())
rstan_options(auto_write = TRUE)

# ==========================================
# 步骤 1. 数据模拟构建 (含疾病组表型特征假设)
# ==========================================
set.seed(42)
N_per_group <- 20
T_trials <- 120
groups <- c("Healthy", "Disease")
df_list <- list()
counter <- 1

for (grp_idx in 1:2) {
  grp_name <- groups[grp_idx]
  for (sub in 1:N_per_group) {
    subject_id <- paste0(grp_name, "_", sub)
    
    # 模拟假设：疾病组具有异常升高的负向学习率，对惩罚极其敏感
    eta_pos <- runif(1, 0.4, 0.7)
    eta_neg <- ifelse(grp_name == "Healthy", runif(1, 0.2, 0.4), runif(1, 0.6, 0.9))
    beta <- runif(1, 2, 4)
    ev <- c(0, 0)
    
    for (t in 1:T_trials) {
      correct_stim <- ifelse(t <= 60, 1, 2) # 第60次触发概率反转
      
      prob_1 <- 1 / (1 + exp(beta * (ev[2] - ev[1])))
      choice <- ifelse(runif(1) < prob_1, 1, 2)
      
      # 80/20 概率获得 1(奖励) 或 -1(惩罚)
      if (choice == correct_stim) {
        outcome <- ifelse(runif(1) < 0.8, 1, -1)
      } else {
        outcome <- ifelse(runif(1) < 0.2, 1, -1)
      }
      
      df_list[[counter]] <- tibble(
        subject_id = subject_id,
        group_idx = grp_idx, # 健康组=1, 疾病组=2
        trial = t, choice = choice, outcome = outcome
      )
      counter <- counter + 1
      
      # 内部状态更新
      PE <- outcome - ev[choice]
      PEnc <- -outcome - ev[3 - choice]
      if (PE >= 0) {
        ev[choice] <- ev[choice] + eta_pos * PE
        ev[3 - choice] <- ev[3 - choice] + eta_pos * PEnc
      } else {
        ev[choice] <- ev[choice] + eta_neg * PE
        ev[3 - choice] <- ev[3 - choice] + eta_neg * PEnc
      }
    }
  }
}
df <- bind_rows(df_list)

# ==========================================
# 步骤 2. 重塑为 Stan 严密边界矩阵
# ==========================================
subject_ids <- unique(df$subject_id)
N <- length(subject_ids)

choices_mat <- matrix(-1, nrow = N, ncol = T_trials)
outcomes_mat <- matrix(0, nrow = N, ncol = T_trials)
Tsubj <- numeric(N)
group_vec <- numeric(N)

for (i in 1:N) {
  sub_data <- df %>% filter(subject_id == subject_ids[i]) %>% arrange(trial)
  Tsubj[i] <- nrow(sub_data)
  group_vec[i] <- sub_data$group_idx[1]
  choices_mat[i, 1:Tsubj[i]] <- sub_data$choice
  outcomes_mat[i, 1:Tsubj[i]] <- sub_data$outcome
}

stan_data <- list(
  N = N, G = 2, group = group_vec,
  T = T_trials, Tsubj = Tsubj,
  choice = choices_mat, outcome = outcomes_mat
)

# ==========================================
# 步骤 3. HMC 算法并行采样执行
# ==========================================
cat("开始运行贝叶斯联合采样...\n")
fit <- stan(
  file = "multigroup_fictitious.stan", 
  data = stan_data,
  iter = 3000, 
  warmup = 1500,
  chains = 4,
  control = list(adapt_delta = 0.95, max_treedepth = 12),
  seed = 2026
)

# ==========================================
# 步骤 4. 模型诊断与最终推断
# ==========================================
# A. 严密诊断：检查 R-hat 是否 < 1.01，有效样本量是否充足
print(fit, pars = c("delta_eta_pos", "delta_eta_neg", "delta_beta"))

# B. 统计推断：通过 95% HDI 确认组间效应的实质性显著
color_scheme_set("red")
p_diff <- mcmc_areas(
  as.array(fit),
  pars = c("delta_eta_pos", "delta_eta_neg", "delta_beta"),
  prob = 0.95 
) + 
  geom_vline(xintercept = 0, linetype = "dashed", color = "black", size = 1) +
  labs(
    title = "参数组间差异后验分布 (疾病组 - 健康组)",
    subtitle = "若 95% 最高密度区间不包含 0，则表明两组存在实质性的认知机制差异"
  )
print(p_diff)

# C. 信息准则提取 (供跨模型比较用)
log_lik_1 <- extract_log_lik(fit, merge_chains = FALSE)
loo_1 <- loo(log_lik_1, r_eff = relative_eff(exp(log_lik_1)), cores = 4)
print(loo_1)
```