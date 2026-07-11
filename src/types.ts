export interface Point {
  /** 时间戳（已由 HResolution / HOffset 计算得到） */
  x: number;
  /** 通道采样值 */
  y: number;
}

export interface Channel {
  /** 通道标识，例如 CH1、CH2 */
  id: string;
  /** 固定通道名称，例如 CH1、CH2 */
  name: string;
  /** 用户自定义名称，例如 Pawl SW */
  customName: string;
  /** 物理单位，例如 V、A */
  unit: string;
  /** 波形绘制颜色 */
  color: string;
  /** 采样点序列 */
  points: Point[];
  /** Y 轴最小值 */
  minY: number;
  /** Y 轴最大值 */
  maxY: number;
  /** 是否显示 */
  visible: boolean;
  /** 垂直方向平移偏移（像素） */
  yOffset: number;
  /** 垂直方向缩放因子 */
  yZoom: number;
  /** 是否垂直翻转（通道反相） */
  inverted?: boolean;
}

export interface OscilloscopeData {
  /** 所有通道 */
  channels: Channel[];
  /** 采样点数 */
  sampleCount: number;
  /** 水平分辨率 */
  hResolution: number;
  /** 水平偏移 */
  hOffset: number;
  /** 水平轴单位 */
  hUnit: string;
  /** 水平轴标签 */
  xLabel: string;
  /** 原始元数据（调试用） */
  metadata: Record<string, string>;
}
