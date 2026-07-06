import { Channel, OscilloscopeData, Point } from './types';
import { getChannelColor } from './colors';

function parseCells(line: string): string[] {
  const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
  // 移除末尾因为尾逗号产生的空单元格
  while (cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '');
  if (normalized === '' || normalized === 'NaN' || normalized === 'Inf' || normalized === '-Inf') {
    return null;
  }
  let num = Number(normalized);
  if (Number.isNaN(num)) {
    // 兼容欧陆小数逗号写法
    num = Number(normalized.replace(',', '.'));
  }
  return Number.isNaN(num) ? null : num;
}

/**
 * 解析 Yokogawa 示波器 / Xviewer 导出的 CSV。
 * 元数据头示例：
 *   TraceName, CH1, CH2, CH4, CH6
 *   VUnit, V, A, V, V
 *   HResolution, 1.000000e-03
 *   HOffset, -1.000900e+01
 *   HUnit, s
 */
export function parseYokogawaCsv(text: string): OscilloscopeData {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let channelNames: string[] = [];
  let channelUnits: string[] = [];
  let hResolution = 1;
  let hOffset = 0;
  let hUnit = 's';
  let sampleCount = 0;
  const metadata: Record<string, string> = {};

  const dataRows: number[][] = [];

  for (const rawLine of lines) {
    const cells = parseCells(rawLine);
    if (cells.length === 0) continue;

    const key = cells[0];

    if (key === 'TraceName') {
      channelNames = cells.slice(1);
      continue;
    }
    if (key === 'VUnit') {
      channelUnits = cells.slice(1);
      continue;
    }
    if (key === 'HResolution') {
      const val = parseNumber(cells[1] ?? '');
      if (val !== null) hResolution = val;
      metadata.HResolution = String(hResolution);
      continue;
    }
    if (key === 'HOffset') {
      const val = parseNumber(cells[1] ?? '');
      if (val !== null) hOffset = val;
      metadata.HOffset = String(hOffset);
      continue;
    }
    if (key === 'HUnit') {
      hUnit = cells[1] ?? 's';
      metadata.HUnit = hUnit;
      continue;
    }
    if (key === 'BlockSize') {
      const val = parseNumber(cells[1] ?? '');
      if (val !== null) sampleCount = Math.floor(val);
      metadata.BlockSize = String(sampleCount);
      continue;
    }
    if (['Model', 'BlockNumber', 'Date', 'Time'].includes(key)) {
      metadata[key] = cells.slice(1).join(', ');
      continue;
    }

    // 数据行：第一列是序号/时间（常为空白），后续为各通道采样值
    const values = cells.slice(1).map(parseNumber);
    if (values.some((v) => v !== null)) {
      dataRows.push(values.map((v) => (v === null ? Number.NaN : v)));
    }
  }

  const channelCount = Math.max(
    channelNames.length,
    dataRows.length > 0 ? dataRows[0].length : 0
  );

  const channels: Channel[] = Array.from({ length: channelCount }, (_, i) => {
    const name = channelNames[i] ?? `CH${i + 1}`;
    const unit = channelUnits[i] ?? '';
    const points: Point[] = [];
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
      const y = dataRows[rowIndex][i];
      if (Number.isNaN(y)) continue;

      const x = rowIndex * hResolution + hOffset;
      points.push({ x, y });
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    if (!Number.isFinite(minY)) {
      minY = -1;
      maxY = 1;
    } else if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }

    return {
      id: name,
      name,
      customName: '',
      unit,
      color: getChannelColor(name, i),
      points,
      minY,
      maxY,
      visible: true,
      yOffset: 0,
      yZoom: 1,
    };
  });

  return {
    channels,
    sampleCount: sampleCount || dataRows.length,
    hResolution,
    hOffset,
    hUnit,
    xLabel: `Time (${hUnit})`,
    metadata,
  };
}
