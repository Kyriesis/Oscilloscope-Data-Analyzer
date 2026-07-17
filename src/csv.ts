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

function buildChannel(
  name: string,
  unit: string,
  index: number,
  points: Point[]
): Channel {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
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
    color: getChannelColor(name, index),
    points,
    minY,
    maxY,
    visible: true,
    yOffset: 0,
    yZoom: 1,
    inverted: false,
  };
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
export function isYokogawaCsv(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const cells = parseCells(line);
    if (cells[0] === 'TraceName' || cells[0] === 'HResolution' || cells[0] === 'VUnit') {
      return true;
    }
  }
  return false;
}

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

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
      const y = dataRows[rowIndex][i];
      if (Number.isNaN(y)) continue;

      const x = rowIndex * hResolution + hOffset;
      points.push({ x, y });
    }

    return buildChannel(name, unit, i, points);
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

/**
 * 解析 Rigol 示波器导出的 CSV。
 * 表头示例：Time(s),CH1V,CH2V,CH3V,CH4V
 * 第一列为时间（秒），后续各列为对应通道电压。
 */
export function isRigolCsv(text: string): boolean {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return false;
  const cells = parseCells(firstLine);
  if (cells.length < 2) return false;

  // 格式 1：Time(s),CH1V,CH2V,...
  const firstHeader = cells[0].toLowerCase();
  if (firstHeader.startsWith('time')) {
    return cells.slice(1).some((cell) => /^ch\d/i.test(cell));
  }

  // 格式 2：CH1V,CH2V,...,t0=...,tInc=...
  const hasChannelHeaders = cells.some((cell) => /^ch\d/i.test(cell));
  const hasTimeParams = firstLine.toLowerCase().includes('t0') && firstLine.toLowerCase().includes('tinc');
  return hasChannelHeaders && hasTimeParams;
}

export function parseRigolCsv(text: string): OscilloscopeData {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error('CSV 文件为空');
  }

  const headerCells = parseCells(lines[0]);
  const firstHeader = headerCells[0].toLowerCase();
  const hasTimeColumn = firstHeader.startsWith('time');

  // 提取表头中的 t0 和 tInc（高精度格式）
  let hOffset = 0;
  let hResolution = 1;
  const hUnit = 's';

  for (const cell of headerCells) {
    const normalized = cell.replace(/\s/g, '').toLowerCase();
    const t0Match = normalized.match(/^t0=([\d\-+\.e]+)/i);
    const tIncMatch = normalized.match(/^tinc=([\d\-+\.e]+)/i);
    if (t0Match) {
      const val = parseNumber(t0Match[1]);
      if (val !== null) hOffset = val;
    }
    if (tIncMatch) {
      const val = parseNumber(tIncMatch[1]);
      if (val !== null) hResolution = val;
    }
  }

  // 通道名与单位从表头解析，例如 "CH1V" -> name: "CH1", unit: "V"
  const channelCells = hasTimeColumn ? headerCells.slice(1) : headerCells.filter((cell) => /^ch\d/i.test(cell));
  const channelInfos = channelCells.map((cell, i) => {
    const match = cell.match(/^(CH\d+)([A-Za-z]*)$/i);
    if (match) {
      return { name: match[1].toUpperCase(), unit: match[2] || '' };
    }
    return { name: `CH${i + 1}`, unit: '' };
  });

  const timeValues: number[] = [];
  const channelValues: number[][] = Array.from({ length: channelInfos.length }, () => []);

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCells(lines[i]);
    const minCells = hasTimeColumn ? channelInfos.length + 1 : channelInfos.length;
    if (cells.length < minCells) continue;

    if (hasTimeColumn) {
      // 格式 1：第一列是时间
      const t = parseNumber(cells[0]);
      if (t === null) continue;
      timeValues.push(t);
      for (let ch = 0; ch < channelInfos.length; ch += 1) {
        const val = parseNumber(cells[ch + 1] ?? '');
        channelValues[ch].push(val === null ? Number.NaN : val);
      }
    } else {
      // 格式 2：按行索引计算时间
      timeValues.push(hOffset + timeValues.length * hResolution);
      for (let ch = 0; ch < channelInfos.length; ch += 1) {
        const val = parseNumber(cells[ch] ?? '');
        channelValues[ch].push(val === null ? Number.NaN : val);
      }
    }
  }

  if (timeValues.length === 0) {
    throw new Error('未能从 Rigol CSV 中解析出有效数据');
  }

  // 如果存在显式时间列，以实际时间为准重新计算 hResolution/hOffset
  if (hasTimeColumn) {
    hResolution = timeValues.length > 1 ? timeValues[1] - timeValues[0] : 1;
    hOffset = timeValues[0];
  }

  const channels: Channel[] = channelInfos.map((info, i) => {
    const points: Point[] = [];
    for (let rowIndex = 0; rowIndex < timeValues.length; rowIndex += 1) {
      const y = channelValues[i][rowIndex];
      if (Number.isNaN(y)) continue;
      points.push({ x: timeValues[rowIndex], y });
    }
    return buildChannel(info.name, info.unit, i, points);
  });

  return {
    channels,
    sampleCount: timeValues.length,
    hResolution,
    hOffset,
    hUnit,
    xLabel: 'Time (s)',
    metadata: {
      Source: 'Rigol CSV',
      HResolution: String(hResolution),
      HOffset: String(hOffset),
    },
  };
}

/**
 * 通用 CSV 解析器注册表。
 * 按优先级排列：先检测特定品牌格式，最后回退到通用格式。
 */
export interface CsvParser {
  name: string;
  canParse: (text: string) => boolean;
  parse: (text: string) => OscilloscopeData;
}

export const csvParsers: CsvParser[] = [
  { name: 'yokogawa', canParse: isYokogawaCsv, parse: parseYokogawaCsv },
  { name: 'rigol', canParse: isRigolCsv, parse: parseRigolCsv },
];

/**
 * 自动检测并解析 CSV 文件。
 */
export function parseCsv(text: string): OscilloscopeData {
  const parser = csvParsers.find((p) => p.canParse(text));
  if (!parser) {
    throw new Error(
      '无法识别的 CSV 格式。当前支持 Yokogawa Xviewer 和 Rigol 示波器导出的 CSV。'
    );
  }
  return parser.parse(text);
}
