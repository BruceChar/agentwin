/**
 * MACD 量价势能衰竭反转 —— 信号强度校准与置信度（文档 §10）。
 *
 * 将规则强度分 `Score` 或综合强度因子 `I` 映射为历史校准胜率与置信区间，
 * 避免把规则分误认为概率。纯函数实现，可离线在回测样本上构建校准表，
 * 再序列化（JSON）注入实盘/回测运行。
 */

/** 单条已结算信号样本：构建校准表的最小输入 */
export interface MacdEnergySignalSample {
  /** 综合强度因子 I = priceMult × volMult × macdMult */
  i: number;
  /** 规则强度分（0–10） */
  score: number;
  /** 该信号实际是否盈利（用于胜率校准） */
  win: boolean;
  /** 可选：盈亏比例（如 +0.03 / -0.01），用于期望收益统计 */
  pnlPct?: number;
}

/** 校准表中的一个强度桶 */
export interface CalibrationBucket {
  /** 下界（含） */
  lower: number;
  /** 上界（不含）；最后一桶为 Infinity */
  upper: number;
  /** 样本数 */
  n: number;
  /** 盈利样本数 */
  wins: number;
  /** 原始胜率 p_hat（n=0 时 null） */
  winRate: number | null;
  /** Wilson 95% 置信区间下界 */
  ciLower: number | null;
  /** Wilson 95% 置信区间上界 */
  ciUpper: number | null;
  /** 期望收益（pnlPct 均值，样本缺失时 null） */
  expectancy: number | null;
  /** 校准后的胜率（等渗回归 / Platt，n=0 时 null） */
  calibratedWinRate: number | null;
}

export type CalibrationDimension = 'i' | 'score';
export type CalibrationMethod = 'bin' | 'isotonic' | 'platt';

/** 校准表：可 JSON 序列化，注入策略运行时做 calibrated 评分 */
export interface MacdEnergyCalibrationTable {
  /** 校准表版本号，用于回测复现 */
  version: string;
  /** 分桶维度：按 I 或按 score */
  dimension: CalibrationDimension;
  /** 构建时间戳 */
  createdAt: number;
  /** 该表构建时的最小样本数要求 */
  minSamples: number;
  /** 校准方法 */
  method: CalibrationMethod;
  /** 各强度桶（按 lower 升序） */
  buckets: CalibrationBucket[];
}

/** 单次校准查询结果（文档 §10.5 输出字段） */
export interface CalibrationLookup {
  /** 命中桶 [lower, upper) */
  calibrationBucket: [number, number];
  /** 校准桶样本数 */
  sampleSize: number;
  /** 历史校准胜率；样本不足或桶为空时 null */
  calibratedWinRate: number | null;
  /** 置信区间下界 */
  confidenceLower: number | null;
  /** 置信区间上界 */
  confidenceUpper: number | null;
  /** 样本是否达到最小样本数（calibrationReliable） */
  reliable: boolean;
}

export interface WilsonInterval {
  center: number;
  lower: number;
  upper: number;
}

const DEFAULT_Z = 1.96; // 95%

/** 文档 §10.3 示例桶：I 维度的默认边界 */
export const DEFAULT_I_EDGES = [1, 1.2, 1.5, 2, 3, 5, 10];
/** 文档 §10.3 示例桶：Score 维度的默认边界 */
export const DEFAULT_SCORE_EDGES = [1, 2, 3, 5, 7, 9, 10];

/**
 * Wilson 95% 置信区间（文档 §10.3 公式）。
 * n<=0 时返回全 null（JSON 中为 null）。
 */
export function wilsonInterval(wins: number, n: number, z = DEFAULT_Z): WilsonInterval | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const p = Math.min(Math.max(wins / n, 0), 1);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { center, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

interface BucketAcc {
  lower: number;
  upper: number;
  n: number;
  wins: number;
  pnlSum: number;
  pnlN: number;
}

function assignBuckets(
  samples: { x: number; win: boolean; pnlPct?: number }[],
  edges: number[],
): BucketAcc[] {
  const bounds = [Number.NEGATIVE_INFINITY, ...edges.slice(), Number.POSITIVE_INFINITY];
  const accs: BucketAcc[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    accs.push({ lower: bounds[k]!, upper: bounds[k + 1]!, n: 0, wins: 0, pnlSum: 0, pnlN: 0 });
  }
  for (const s of samples) {
    if (!Number.isFinite(s.x)) continue;
    let idx = accs.findIndex((b) => s.x >= b.lower && s.x < b.upper);
    if (idx < 0) idx = accs.length - 1; // 超出上界的极值归入最后一桶
    const b = accs[idx]!;
    b.n += 1;
    if (s.win) b.wins += 1;
    if (s.pnlPct !== undefined && Number.isFinite(s.pnlPct)) {
      b.pnlSum += s.pnlPct;
      b.pnlN += 1;
    }
  }
  return accs;
}

/**
 * 等渗回归（PAVA，文档 §10.4 模型一）：在 (x, y) 上拟合随 x 单调不减的 y。
 * y 为各样本桶的胜率；返回与输入等长的单调化序列（按 x 升序输入）。
 */
export function isotonicRegression(points: { x: number; y: number; w?: number }[]): number[] {
  const sorted = points
    .map((p, idx) => ({ x: p.x, y: p.y, w: p.w && p.w > 0 ? p.w : 1, idx }))
    .sort((a, b) => a.x - b.x);
  const blocks: { sum: number; weight: number; items: number[] }[] = [];
  for (const p of sorted) {
    let block = { sum: p.y * p.w, weight: p.w, items: [p.idx] };
    while (blocks.length > 0) {
      const prev = blocks[blocks.length - 1]!;
      if (prev.sum / prev.weight < block.sum / block.weight) break;
      blocks.pop();
      block = { sum: prev.sum + block.sum, weight: prev.weight + block.weight, items: [...prev.items, ...block.items] };
    }
    blocks.push(block);
  }
  const out = new Array(points.length).fill(0);
  for (const b of blocks) {
    const v = b.sum / b.weight;
    for (const i of b.items) out[i] = v;
  }
  return out;
}

/**
 * Platt Scaling（文档 §10.4 模型二）：logit(p) = a × x + b，用梯度下降拟合。
 * 输入 x 建议使用 log(I) 或 Score（调用方决定）。
 */
export function plattScaling(points: { x: number; y: number; w?: number }[], opts: { lr?: number; iters?: number } = {}): { a: number; b: number } {
  const lr = opts.lr ?? 0.1;
  const iters = opts.iters ?? 2000;
  let a = 0;
  let b = 0;
  const data = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (data.length === 0) return { a, b };
  for (let it = 0; it < iters; it++) {
    let ga = 0;
    let gb = 0;
    let norm = 0;
    for (const p of data) {
      const w = p.w && p.w > 0 ? p.w : 1;
      const z = a * p.x + b;
      const pred = 1 / (1 + Math.exp(-z));
      const err = pred - p.y;
      ga += err * p.x * w;
      gb += err * w;
      norm += w;
    }
    if (norm === 0) break;
    a -= (lr * ga) / norm;
    b -= (lr * gb) / norm;
  }
  return { a, b };
}

export interface BuildCalibrationOptions {
  /** 分桶维度，默认 i */
  dimension?: CalibrationDimension;
  /** 自定义桶边界（升序）；缺省用文档示例桶 */
  edges?: number[];
  /** 校准方法，默认 isotonic */
  method?: CalibrationMethod;
  /** 最小样本数（写入表中，供运行时判断 reliable） */
  minSamples?: number;
  /** 版本号 */
  version?: string;
  /** 当前时间戳（便于测试固定） */
  now?: number;
}

/**
 * 由已结算信号样本构建校准表。
 * - `method=bin`：仅输出原始胜率 + Wilson 区间；
 * - `method=isotonic`：对分桶胜率做等渗回归（保证随强度单调不减）；
 * - `method=platt`：对分桶胜率做 Platt scaling。
 */
export function buildCalibrationTable(
  samples: MacdEnergySignalSample[],
  opts: BuildCalibrationOptions = {},
): MacdEnergyCalibrationTable {
  const dimension = opts.dimension ?? 'i';
  const method = opts.method ?? 'isotonic';
  const edges = opts.edges ?? (dimension === 'i' ? DEFAULT_I_EDGES : DEFAULT_SCORE_EDGES);
  const minSamples = opts.minSamples ?? 30;

  const points = samples
    .map((s) => ({ x: dimension === 'i' ? s.i : s.score, win: s.win, pnlPct: s.pnlPct }))
    .filter((s) => Number.isFinite(s.x));
  const accs = assignBuckets(points, edges);

  // 仅对非空桶做单调/逻辑拟合，避免空桶把曲线拉向 0。
  const nonEmpty = accs
    .map((b, idx) => ({ ...b, idx }))
    .filter((b) => b.n > 0);
  let calibrated: Map<number, number> = new Map();
  if (method === 'isotonic' && nonEmpty.length > 0) {
    const x = nonEmpty.map((b) => ({ x: (b.lower + b.upper) / 2, y: b.wins / b.n, w: b.n }));
    const fitted = isotonicRegression(x);
    nonEmpty.forEach((b, k) => calibrated.set(b.idx, fitted[k]!));
  } else if (method === 'platt' && nonEmpty.length > 0) {
    const useLog = dimension === 'i'; // log(I) 展开低段差异（文档 §10.4）
    const x = nonEmpty.map((b) => ({ x: useLog ? Math.log((b.lower + b.upper) / 2) : (b.lower + b.upper) / 2, y: b.wins / b.n, w: b.n }));
    const { a, b: bb } = plattScaling(x);
    nonEmpty.forEach((bucket, k) => {
      const xv = x[k]!.x;
      calibrated.set(bucket.idx, 1 / (1 + Math.exp(-(a * xv + bb))));
    });
  } else {
    nonEmpty.forEach((b) => calibrated.set(b.idx, b.wins / b.n));
  }

  const buckets: CalibrationBucket[] = accs.map((b, idx) => {
    const ci = b.n > 0 ? wilsonInterval(b.wins, b.n) : null;
    return {
      lower: b.lower,
      upper: b.upper,
      n: b.n,
      wins: b.wins,
      winRate: b.n > 0 ? b.wins / b.n : null,
      ciLower: ci ? ci.lower : null,
      ciUpper: ci ? ci.upper : null,
      expectancy: b.pnlN > 0 ? b.pnlSum / b.pnlN : null,
      calibratedWinRate: calibrated.has(idx) ? calibrated.get(idx)! : null,
    };
  });

  return { version: opts.version ?? '', dimension, createdAt: opts.now ?? Date.now(), minSamples, method, buckets };
}

/**
 * 查询校准表：返回命中桶的校准胜率与置信区间。
 * 样本不足 / 桶为空 / 无校准表时，`calibratedWinRate` 与区间为 null，`reliable=false`。
 */
export function lookupCalibration(
  table: MacdEnergyCalibrationTable | null | undefined,
  value: number,
  minSamples?: number,
): CalibrationLookup | null {
  if (!table || !Number.isFinite(value)) return null;
  const req = minSamples ?? table.minSamples;
  // 最后一桶上界为 Infinity，用 <= 兜住极值
  const bucket =
    table.buckets.find((b) => value >= b.lower && value < b.upper) ??
    (table.buckets.length > 0 && value >= table.buckets[table.buckets.length - 1]!.lower
      ? table.buckets[table.buckets.length - 1]
      : null);
  if (!bucket) return null;
  const reliable = bucket.n >= req;
  return {
    calibrationBucket: [bucket.lower, bucket.upper],
    sampleSize: bucket.n,
    calibratedWinRate: reliable ? bucket.calibratedWinRate : null,
    confidenceLower: reliable ? bucket.ciLower : null,
    confidenceUpper: reliable ? bucket.ciUpper : null,
    reliable: reliable && bucket.calibratedWinRate !== null,
  };
}

/** 序列化校准表为 JSON 字符串（便于持久化 / 注入实盘） */
export function serializeCalibrationTable(table: MacdEnergyCalibrationTable): string {
  return JSON.stringify(table);
}

/** 解析 JSON 校准表；非法输入返回 null */
export function parseCalibrationTable(json: string | null | undefined): MacdEnergyCalibrationTable | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as MacdEnergyCalibrationTable;
    if (!t || !Array.isArray(t.buckets) || (t.dimension !== 'i' && t.dimension !== 'score')) return null;
    return t;
  } catch {
    return null;
  }
}
