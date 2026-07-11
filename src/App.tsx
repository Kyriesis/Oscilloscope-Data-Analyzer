import {
  ChangeEvent,
  DragEvent,
  Fragment,
  MouseEvent,
  PointerEvent,
  WheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Channel, OscilloscopeData, Point } from './types';
import { parseYokogawaCsv } from './csv';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** 计算点 P 到线段 AB 的最短距离 */
function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  if (abx === 0 && aby === 0) return Math.hypot(px - ax, py - ay);
  const apx = px - ax;
  const apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  const closestX = ax + t * abx;
  const closestY = ay + t * aby;
  return Math.hypot(px - closestX, py - closestY);
}

const BASE_MARGIN = { top: 44, right: 24, bottom: 52, left: 90 };

function getPlotDimensions(
  wrapper: HTMLDivElement | null,
  margin: { top: number; right: number; bottom: number; left: number }
) {
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  return {
    plotWidth: Math.max(1, rect.width - margin.left - margin.right),
    plotHeight: Math.max(1, rect.height - margin.top - margin.bottom),
  };
}

/** 限制水平平移，保证数据不超出图形框 */
function clampPanX(panX: number, zoomX: number, plotWidth: number) {
  if (zoomX <= 1) return 0;
  const min = plotWidth * (1 - zoomX);
  return clamp(panX, min, 0);
}

/** 计算通道 Y 偏移的允许范围，防止左侧 CH 标签 / 0 位标签与坐标上下端数值重叠（保留 5px 间隙） */
function getChannelYOffsetBounds(
  channel: Channel,
  index: number,
  total: number,
  plotHeight: number,
  margin: { top: number; bottom: number }
) {
  const bandHeight = plotHeight / total;
  const bandTop = margin.top + bandHeight * index;
  const bandCenterY = bandTop + bandHeight * 0.5;
  const ySpan = channel.maxY - channel.minY || 1;
  const yScale = ((bandHeight * 0.75) / ySpan) * channel.yZoom;
  const yMid = (channel.minY + channel.maxY) / 2;
  const flip = channel.inverted ? -1 : 1;
  const zeroYWithoutOffset = bandCenterY + yMid * yScale * flip;

  const hasCustomName = channel.customName.trim().length > 0;
  const chNameYOffset = hasCustomName ? 20 : 12;
  // 上端：CH 标签顶部要与坐标上端数值底部保持 2px
  const minZeroY = margin.top + 26 + chNameYOffset;
  // 下端：0 位标签底部要与坐标下端数值顶部保持 2px
  const maxZeroY = margin.top + plotHeight - 26;

  return {
    min: minZeroY - zeroYWithoutOffset,
    max: maxZeroY - zeroYWithoutOffset,
  };
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return '--';
  const prefix = unit ? ` ${unit}` : '';
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.001 && value !== 0)) {
    return `${value.toExponential(4)}${prefix}`;
  }
  return `${value.toFixed(4)}${prefix}`;
}

function findNearestPoint(channel: Channel, x: number): Point | null {
  if (channel.points.length === 0) return null;
  return channel.points.reduce((closest, point) =>
    Math.abs(point.x - x) < Math.abs(closest.x - x) ? point : closest
  );
}

function App() {
  const [data, setData] = useState<OscilloscopeData | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [zoomX, setZoomX] = useState(1);
  const [panX, setPanX] = useState(0);
  const [cursorA, setCursorA] = useState<number | null>(null);
  const [cursorB, setCursorB] = useState<number | null>(null);
  const [cursorMode, setCursorMode] = useState(false);
  const [draggingCursor, setDraggingCursor] = useState<'A' | 'B' | null>(null);
  const [hoveredCursor, setHoveredCursor] = useState<'A' | 'B' | null>(null);
  const [measureLabelY, setMeasureLabelY] = useState(0.35);
  const [draggingMeasureLabel, setDraggingMeasureLabel] = useState(false);
  const [hoveredMeasureLabel, setHoveredMeasureLabel] = useState(false);
  const [horizontalCursorMode, setHorizontalCursorMode] = useState(false);
  const [cursorC, setCursorC] = useState<number | null>(null);
  const [cursorD, setCursorD] = useState<number | null>(null);
  const [draggingHorizontalCursor, setDraggingHorizontalCursor] = useState<'C' | 'D' | null>(null);
  const [hoveredHorizontalCursor, setHoveredHorizontalCursor] = useState<'C' | 'D' | null>(null);
  const [horizontalMeasureLabelX, setHorizontalMeasureLabelX] = useState(0.65);
  const [draggingHorizontalMeasureLabel, setDraggingHorizontalMeasureLabel] = useState(false);
  const [hoveredHorizontalMeasureLabel, setHoveredHorizontalMeasureLabel] = useState(false);
  const [crossCursorMode, setCrossCursorMode] = useState(false);
  const [cursorE, setCursorE] = useState<number | null>(null);
  const [cursorF, setCursorF] = useState<number | null>(null);
  const [cursorG, setCursorG] = useState<number | null>(null);
  const [cursorH, setCursorH] = useState<number | null>(null);
  const [draggingCrossCursor, setDraggingCrossCursor] = useState<'E' | 'F' | 'G' | 'H' | 'EF' | 'GH' | null>(null);
  const [hoveredCrossCursor, setHoveredCrossCursor] = useState<'E' | 'F' | 'G' | 'H' | 'EF' | 'GH' | null>(null);
  const [crossMeasureLabelY, setCrossMeasureLabelY] = useState(0.35);
  const [crossMeasureLabelX, setCrossMeasureLabelX] = useState(0.65);
  const [draggingCrossMeasureLabelX, setDraggingCrossMeasureLabelX] = useState(false);
  const [hoveredCrossMeasureLabelX, setHoveredCrossMeasureLabelX] = useState(false);
  const [draggingCrossMeasureLabelY, setDraggingCrossMeasureLabelY] = useState(false);
  const [hoveredCrossMeasureLabelY, setHoveredCrossMeasureLabelY] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [resizeTick, setResizeTick] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [zoomXMode, setZoomXMode] = useState(false);
  const [zoomYMode, setZoomYMode] = useState(false);
  const [hoveredChannelId, setHoveredChannelId] = useState<string | null>(null);
  const [draggingChannelId, setDraggingChannelId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [lastHorizontalActiveChannelId, setLastHorizontalActiveChannelId] = useState<string | null>(null);
  const [lastCrossActiveChannelId, setLastCrossActiveChannelId] = useState<string | null>(null);
  const [testTemp, setTestTemp] = useState('');
  const [testVoltage, setTestVoltage] = useState('');
  const [testLocation, setTestLocation] = useState('');
  const [testDate, setTestDate] = useState('');
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [sortLockEnabled, setSortLockEnabled] = useState(() => {
    try {
      return localStorage.getItem('oscilloscope-sort-lock-enabled') === 'true';
    } catch {
      return false;
    }
  });
  const [lockedOrder, setLockedOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('oscilloscope-sort-lock-order');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [lockedY, setLockedY] = useState<Record<string, { yOffset: number; yZoom: number; inverted?: boolean; customName?: string }>>(() => {
    try {
      const raw = localStorage.getItem('oscilloscope-sort-lock-y');
      return raw ? (JSON.parse(raw) as Record<string, { yOffset: number; yZoom: number; inverted?: boolean; customName?: string }>) : {};
    } catch {
      return {};
    }
  });
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const plotMargin = useMemo(() => BASE_MARGIN, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const channelDragStartRef = useRef<{ y: number; channelId: string } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const draggedChannelRef = useRef<string | null>(null);
  const zoomYJustSelectedRef = useRef<string | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const importConditionsRef = useRef<HTMLInputElement | null>(null);

  const visibleChannels = useMemo(() => channels.filter((ch) => ch.visible), [channels]);

  const TEST_CONDITIONS_KEY = 'oscilloscope-test-conditions';

  function formatCsvDate(raw?: string): string | null {
    if (!raw) return null;
    const first = raw.split(',')[0].trim();
    return first || null;
  }

  const applyTestConditionsForFile = (filename?: string, csvDate?: string | null) => {
    const now = new Date();
    const formatted = csvDate ?? now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    setCurrentFilename(filename ?? null);
    if (!filename) {
      setTestTemp('');
      setTestVoltage('');
      setTestLocation('');
      setTestDate(formatted);
      return;
    }
    try {
      const stored = localStorage.getItem(TEST_CONDITIONS_KEY);
      const map = stored ? (JSON.parse(stored) as Record<string, { temp?: string; voltage?: string; location?: string; date?: string }>) : {};
      const saved = map[filename];
      if (saved) {
        setTestTemp(saved.temp ?? '');
        setTestVoltage(saved.voltage ?? '');
        setTestLocation(saved.location ?? '');
        setTestDate(saved.date ?? formatted);
      } else {
        setTestTemp('');
        setTestVoltage('');
        setTestLocation('');
        setTestDate(formatted);
      }
    } catch {
      setTestTemp('');
      setTestVoltage('');
      setTestLocation('');
      setTestDate(formatted);
    }
  };

  /** 如果开启了序列锁定，且新文件通道与锁定顺序完全匹配，则按锁定顺序重排并恢复 Y 轴视图 */
  function reorderChannelsByLock(
    initialized: Channel[],
    lockEnabled: boolean,
    order: string[],
    ySettings: Record<string, { yOffset: number; yZoom: number; inverted?: boolean; customName?: string }>
  ): Channel[] {
    if (!lockEnabled || order.length === 0) return initialized;
    if (initialized.length !== order.length) return initialized;
    const initializedNames = new Set(initialized.map((ch) => ch.name));
    const lockNames = new Set(order);
    if (
      initializedNames.size !== order.length ||
      lockNames.size !== order.length ||
      !order.every((name) => initializedNames.has(name))
    ) {
      return initialized;
    }
    const channelMap = new Map(initialized.map((ch) => [ch.name, ch]));
    return order.map((name) => {
      const ch = channelMap.get(name)!;
      const saved = ySettings[name];
      return saved
        ? {
            ...ch,
            yOffset: saved.yOffset,
            yZoom: saved.yZoom,
            inverted: saved.inverted ?? false,
            customName: saved.customName ?? ch.customName,
          }
        : ch;
    });
  }

  const toggleSortLock = () => {
    setSortLockEnabled((prev) => {
      const next = !prev;
      if (next && channels.length > 0) {
        setLockedOrder(channels.map((ch) => ch.name));
        setLockedY(
          Object.fromEntries(
            channels.map((ch) => [ch.name, { yOffset: ch.yOffset, yZoom: ch.yZoom, inverted: ch.inverted ?? false, customName: ch.customName }])
          )
        );
      }
      return next;
    });
  };

  /** 在序列锁定开启时同步某个通道的 Y 轴视图 */
  const updateLockedY = (name: string, yOffset: number, yZoom: number) => {
    if (!sortLockEnabled) return;
    setLockedY((prev) => ({
      ...prev,
      [name]: {
        yOffset,
        yZoom,
        inverted: prev[name]?.inverted ?? false,
        customName: prev[name]?.customName ?? '',
      },
    }));
  };

  // 加载 CSV 后重置视图
  const loadCsvText = (text: string, filename?: string) => {
    try {
      // 缓存原始 CSV 文本与文件名，页面刷新或 dev server 自动重载后可恢复
      try {
        sessionStorage.setItem('oscilloscope-csv-text', text);
        if (filename) sessionStorage.setItem('oscilloscope-csv-filename', filename);
      } catch {
        // 存储失败（如超出配额）不影响当前加载
      }
      const parsed = parseYokogawaCsv(text);
      const csvDate = formatCsvDate(parsed.metadata.Date);
      let initializedChannels: Channel[] = parsed.channels.map((ch) => ({
        ...ch,
        customName: ch.customName ?? '',
        yOffset: 0,
        yZoom: 1,
        inverted: ch.inverted ?? false,
      }));
      initializedChannels = reorderChannelsByLock(initializedChannels, sortLockEnabled, lockedOrder, lockedY);

      // 如果序列锁定开启，但新文件通道与锁定顺序不完全匹配，则自动关闭锁定，避免旧记忆被覆盖
      if (sortLockEnabled && lockedOrder.length > 0) {
        const initializedNames = new Set(initializedChannels.map((ch) => ch.name));
        const lockNames = new Set(lockedOrder);
        const matches =
          initializedChannels.length === lockedOrder.length &&
          initializedNames.size === lockedOrder.length &&
          lockNames.size === lockedOrder.length &&
          lockedOrder.every((name) => initializedNames.has(name));
        if (!matches) {
          setSortLockEnabled(false);
        }
      }

      setData(parsed);
      setChannels(initializedChannels);
      setZoomX(1);
      setPanX(0);
      setCursorA(null);
      setCursorB(null);
      setCursorMode(false);
      setHoveredCursor(null);
      setMeasureLabelY(0.35);
      setHoveredMeasureLabel(false);
      setDraggingMeasureLabel(false);
      setHorizontalCursorMode(false);
      setCursorC(null);
      setCursorD(null);
      setHoveredHorizontalCursor(null);
      setDraggingHorizontalCursor(null);
      setHorizontalMeasureLabelX(0.65);
      setHoveredHorizontalMeasureLabel(false);
      setDraggingHorizontalMeasureLabel(false);
      setCrossCursorMode(false);
      setCursorE(null);
      setCursorF(null);
      setCursorG(null);
      setCursorH(null);
      setHoveredCrossCursor(null);
      setDraggingCrossCursor(null);
      setCrossMeasureLabelY(0.35);
      setCrossMeasureLabelX(0.65);
      setHoveredCrossMeasureLabelX(false);
      setDraggingCrossMeasureLabelX(false);
      setHoveredCrossMeasureLabelY(false);
      setDraggingCrossMeasureLabelY(false);
      setZoomXMode(true);
      setZoomYMode(false);
      setHoveredChannelId(null);
      setDraggingChannelId(null);
      setSelectedChannelId(null);
      setLastHorizontalActiveChannelId(null);
      setLastCrossActiveChannelId(null);
      applyTestConditionsForFile(filename, csvDate);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV 解析失败');
      setData(null);
      setChannels([]);
      sessionStorage.removeItem('oscilloscope-csv-text');
    }
  };

  // 页面刷新或 dev server 自动重载后，恢复上次加载的数据
  useEffect(() => {
    const saved = sessionStorage.getItem('oscilloscope-csv-text');
    const savedFilename = sessionStorage.getItem('oscilloscope-csv-filename');
    if (saved && !data) {
      loadCsvText(saved, savedFilename || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 工况信息随当前文件自动保存/恢复
  useEffect(() => {
    if (!currentFilename) return;
    try {
      const stored = localStorage.getItem(TEST_CONDITIONS_KEY);
      const map = stored ? (JSON.parse(stored) as Record<string, { temp?: string; voltage?: string; location?: string; date?: string }>) : {};
      map[currentFilename] = {
        temp: testTemp,
        voltage: testVoltage,
        location: testLocation,
        date: testDate,
      };
      localStorage.setItem(TEST_CONDITIONS_KEY, JSON.stringify(map));
    } catch {
      // 存储失败不影响使用
    }
  }, [testTemp, testVoltage, testLocation, testDate, currentFilename]);

  // 持久化通道序列锁定状态、锁定顺序与 Y 轴视图
  useEffect(() => {
    try {
      localStorage.setItem('oscilloscope-sort-lock-enabled', String(sortLockEnabled));
      localStorage.setItem('oscilloscope-sort-lock-order', JSON.stringify(lockedOrder));
      localStorage.setItem('oscilloscope-sort-lock-y', JSON.stringify(lockedY));
    } catch {
      // 存储失败不影响使用
    }
  }, [sortLockEnabled, lockedOrder, lockedY]);

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const text = await file.text();
    loadCsvText(text, file.name);
    // 拖拽加载后清空原生文件输入框，避免它仍显示上一次“选择文件”的文件名
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    loadCsvText(text, file.name);
  };

  const handleExportConditions = () => {
    let map: Record<string, { temp?: string; voltage?: string; location?: string; date?: string }> = {};
    try {
      const stored = localStorage.getItem(TEST_CONDITIONS_KEY);
      if (stored) map = JSON.parse(stored);
    } catch {
      // 读取失败时导出空对象
    }
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oscilloscope-test-conditions.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportConditions = async (file: File) => {
    try {
      const text = await file.text();
      const map = JSON.parse(text) as Record<string, { temp?: string; voltage?: string; location?: string; date?: string }>;
      localStorage.setItem(TEST_CONDITIONS_KEY, JSON.stringify(map));
      if (currentFilename && map[currentFilename]) {
        const saved = map[currentFilename];
        setTestTemp(saved.temp ?? '');
        setTestVoltage(saved.voltage ?? '');
        setTestLocation(saved.location ?? '');
        setTestDate(saved.date ?? testDate);
      }
    } catch {
      // 解析失败时静默忽略
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!zoomXMode || !data) return;

    const dims = getPlotDimensions(viewRef.current, plotMargin);
    if (!dims) return;
    const { plotWidth } = dims;

    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const currentTimebase = xSpan / zoomX / 10;
    const direction = event.deltaY > 0 ? 'down' : 'up';
    const nextTimebase = getFineTimebase(currentTimebase, direction);
    const nextZoomX = clamp(xSpan / nextTimebase / 10, 1, 1e9);

    // 以鼠标当前位置为缩放中心：保持鼠标指向的数据点位置不变
    const rect = viewRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseXInCanvas = event.clientX - rect.left;
      const plotMouseX = clamp(mouseXInCanvas - plotMargin.left, 0, plotWidth);
      const scaleXOld = (plotWidth / xSpan) * zoomX;
      const dataMouseX = minX + (plotMouseX - panX) / scaleXOld;
      const scaleXNew = (plotWidth / xSpan) * nextZoomX;
      const nextPanX = plotMouseX - (dataMouseX - minX) * scaleXNew;
      setPanX(clampPanX(nextPanX, nextZoomX, plotWidth));
    }

    setZoomX(nextZoomX);
  };

  // 后续测量模块可能会用到，暂时保留
  // const getChannelValueAtX = (channel: Channel, x: number): number | null => {
  //   if (channel.points.length === 0) return null;
  //   const i = channel.points.findIndex((p) => p.x >= x);
  //   if (i <= 0) return channel.points[0]?.y ?? null;
  //   if (i === -1) return channel.points[channel.points.length - 1]?.y ?? null;
  //   const p0 = channel.points[i - 1];
  //   const p1 = channel.points[i];
  //   const t = (x - p0.x) / (p1.x - p0.x);
  //   return p0.y + (p1.y - p0.y) * t;
  // };

  const findHoveredChannel = (clientX: number, clientY: number, threshold = 30): string | null => {
    if (!viewRef.current || !data || visibleChannels.length === 0) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const scaleX = (plotWidth / xSpan) * zoomX;

    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    if (screenX < plotMargin.left || screenX > plotMargin.left + plotWidth) return null;

    let closestId: string | null = null;
    let minDist = Number.POSITIVE_INFINITY;
    const totalChannels = channels.length;

    channels.forEach((ch, index) => {
      if (!ch.visible) return;

      const bandHeight = plotHeight / totalChannels;
      const bandTop = plotMargin.top + bandHeight * index;
      const bandCenterY = bandTop + bandHeight * 0.5;
      const ySpan = ch.maxY - ch.minY || 1;
      const yScale = ((bandHeight * 0.75) / ySpan) * ch.yZoom;
      const yMid = (ch.minY + ch.maxY) / 2;
      const flip = ch.inverted ? -1 : 1;

      let channelMinDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < ch.points.length - 1; i += 1) {
        const p0 = ch.points[i];
        const p1 = ch.points[i + 1];
        const x0 = plotMargin.left + (p0.x - minX) * scaleX + panX;
        const x1 = plotMargin.left + (p1.x - minX) * scaleX + panX;
        // 简单剔除远离鼠标的水平区域，减少无效计算
        if (Math.max(x0, x1) < screenX - threshold || Math.min(x0, x1) > screenX + threshold) {
          continue;
        }
        const y0 = bandCenterY - (p0.y - yMid) * yScale * flip + ch.yOffset;
        const y1 = bandCenterY - (p1.y - yMid) * yScale * flip + ch.yOffset;
        const dist = pointToSegmentDistance(screenX, screenY, x0, y0, x1, y1);
        if (dist < channelMinDist) channelMinDist = dist;
      }

      if (channelMinDist < minDist && channelMinDist < threshold) {
        minDist = channelMinDist;
        closestId = ch.id;
      }
    });

    return closestId;
  };

  const getDataXFromMouse = (clientX: number): number | null => {
    if (!viewRef.current || !data) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const scaleX = (plotWidth / xSpan) * zoomX;
    const screenX = clientX - rect.left;
    const plotMouseX = screenX - plotMargin.left;
    return clamp(minX + (plotMouseX - panX) / scaleX, minX, maxX);
  };

  const findHoveredCursor = (clientX: number): 'A' | 'B' | null => {
    if (!viewRef.current || !data || !cursorMode) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const scaleX = (plotWidth / xSpan) * zoomX;
    const screenX = clientX - rect.left;

    const getDist = (cursorX: number | null) => {
      if (cursorX === null) return Number.POSITIVE_INFINITY;
      const cursorScreenX = plotMargin.left + (cursorX - minX) * scaleX + panX;
      return Math.abs(screenX - cursorScreenX);
    };

    const distA = getDist(cursorA);
    const distB = getDist(cursorB);
    const threshold = 8;
    if (distA <= distB && distA < threshold) return 'A';
    if (distB < distA && distB < threshold) return 'B';
    return null;
  };

  const measureLabelText = (text: string): number => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return 0;
    ctx.font = '12px Inter, ui-sans-serif, system-ui';
    return ctx.measureText(text).width;
  };

  const findHoveredMeasureLabel = (clientX: number, clientY: number): boolean => {
    if (!viewRef.current || !data || !cursorMode || cursorA === null || cursorB === null) return false;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const scaleX = (plotWidth / xSpan) * zoomX;
    const screenXA = plotMargin.left + (cursorA - minX) * scaleX + panX;
    const screenXB = plotMargin.left + (cursorB - minX) * scaleX + panX;
    const labelX = (screenXA + screenXB) / 2;
    const labelY = plotMargin.top + measureLabelY * plotHeight;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    const text = formatDeltaT(cursorB - cursorA);
    const textWidth = measureLabelText(text);
    const fontSize = 12;
    const textLeft = labelX - textWidth / 2;
    const textRight = labelX + textWidth / 2;
    const textTop = labelY - 5 - fontSize;
    const textBottom = labelY - 5;
    return (
      screenX >= textLeft - 10 &&
      screenX <= textRight + 10 &&
      screenY >= textTop - 10 &&
      screenY <= textBottom + 10
    );
  };

  const activeChannel = useMemo(() => {
    const selected = channels.find((ch) => ch.id === selectedChannelId);
    if (selected?.visible) return selected;
    return visibleChannels[0] ?? channels[0] ?? null;
  }, [channels, selectedChannelId, visibleChannels]);
  const activeChannelId = activeChannel?.id ?? null;
  const labelChannelId = horizontalCursorMode || crossCursorMode ? activeChannelId : selectedChannelId;

  const getActiveChannelYFromScreenY = (screenY: number): number | null => {
    if (!viewRef.current || !data || !activeChannel) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
    const totalChannels = channels.length;
    const index = channels.findIndex((ch) => ch.id === activeChannel.id);
    if (index === -1) return null;
    const bandHeight = plotHeight / totalChannels;
    const bandTop = plotMargin.top + bandHeight * index;
    const bandCenterY = bandTop + bandHeight * 0.5;
    const ySpan = activeChannel.maxY - activeChannel.minY || 1;
    const yScale = ((bandHeight * 0.75) / ySpan) * activeChannel.yZoom;
    const yMid = (activeChannel.minY + activeChannel.maxY) / 2;
    const flip = activeChannel.inverted ? -1 : 1;
    return yMid - (screenY - bandCenterY - activeChannel.yOffset) * flip / yScale;
  };

  const getActiveChannelScreenYFromRatio = (ratio: number | null): number | null => {
    if (ratio === null || !viewRef.current || !data || !activeChannel) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
    return plotMargin.top + ratio * plotHeight;
  };

  const getActiveChannelYFromRatio = (ratio: number | null): number | null => {
    const screenY = getActiveChannelScreenYFromRatio(ratio);
    if (screenY === null) return null;
    return getActiveChannelYFromScreenY(screenY);
  };

  const getMouseRatioY = (clientY: number): number | null => {
    if (!viewRef.current) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
    return clamp((clientY - rect.top - plotMargin.top) / plotHeight, 0, 1);
  };

  const findHoveredHorizontalCursor = (clientX: number, clientY: number): 'C' | 'D' | null => {
    if (!viewRef.current || !data || !horizontalCursorMode || !activeChannel) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    if (screenX < plotMargin.left || screenX > plotMargin.left + plotWidth) return null;

    const getDist = (cursorRatio: number | null) => {
      if (cursorRatio === null) return Number.POSITIVE_INFINITY;
      const cursorScreenY = getActiveChannelScreenYFromRatio(cursorRatio);
      if (cursorScreenY === null) return Number.POSITIVE_INFINITY;
      return Math.abs(screenY - cursorScreenY);
    };

    const distC = getDist(cursorC);
    const distD = getDist(cursorD);
    const threshold = 8;
    if (distC <= distD && distC < threshold) return 'C';
    if (distD < distC && distD < threshold) return 'D';
    return null;
  };

  const findHoveredHorizontalMeasureLabel = (clientX: number, clientY: number): boolean => {
    if (!viewRef.current || !data || !horizontalCursorMode || !activeChannel || cursorC === null || cursorD === null) return false;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const screenYC = getActiveChannelScreenYFromRatio(cursorC);
    const screenYD = getActiveChannelScreenYFromRatio(cursorD);
    if (screenYC === null || screenYD === null) return false;
    const labelX = plotMargin.left + horizontalMeasureLabelX * plotWidth;
    const labelY = (screenYC + screenYD) / 2;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    const deltaY = (getActiveChannelYFromRatio(cursorD) ?? 0) - (getActiveChannelYFromRatio(cursorC) ?? 0);
    const text = `ΔY: ${formatValue(deltaY, activeChannel.unit)}`;
    const textWidth = measureLabelText(text);
    const fontSize = 12;
    const textLeft = labelX + 6;
    const textRight = labelX + 6 + textWidth;
    const textTop = labelY - fontSize / 2;
    const textBottom = labelY + fontSize / 2;
    return (
      screenX >= textLeft - 10 &&
      screenX <= textRight + 10 &&
      screenY >= textTop - 10 &&
      screenY <= textBottom + 10
    );
  };

  const findHoveredCrossCursor = (clientX: number, clientY: number): 'E' | 'F' | 'G' | 'H' | 'EF' | 'GH' | null => {
    if (!viewRef.current || !data || !crossCursorMode || !activeChannel) return null;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const scaleX = (plotWidth / xSpan) * zoomX;
    const threshold = 8;

    const sxE = cursorE !== null ? plotMargin.left + (cursorE - minX) * scaleX + panX : null;
    const syF = cursorF !== null ? plotMargin.top + cursorF * plotHeight : null;
    if (
      sxE !== null &&
      syF !== null &&
      Math.abs(screenX - sxE) < threshold &&
      Math.abs(screenY - syF) < threshold
    ) {
      return 'EF';
    }

    const sxG = cursorG !== null ? plotMargin.left + (cursorG - minX) * scaleX + panX : null;
    const syH = cursorH !== null ? plotMargin.top + cursorH * plotHeight : null;
    if (
      sxG !== null &&
      syH !== null &&
      Math.abs(screenX - sxG) < threshold &&
      Math.abs(screenY - syH) < threshold
    ) {
      return 'GH';
    }

    const verticals: { id: 'E' | 'G'; x: number | null }[] = [
      { id: 'E', x: cursorE },
      { id: 'G', x: cursorG },
    ];
    let best: 'E' | 'F' | 'G' | 'H' | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const { id, x } of verticals) {
      if (x === null) continue;
      const sx = plotMargin.left + (x - minX) * scaleX + panX;
      if (screenY < plotMargin.top || screenY > plotMargin.top + plotHeight) continue;
      const dist = Math.abs(screenX - sx);
      if (dist < bestDist && dist < threshold) {
        bestDist = dist;
        best = id;
      }
    }

    const horizontals: { id: 'F' | 'H'; ratio: number | null }[] = [
      { id: 'F', ratio: cursorF },
      { id: 'H', ratio: cursorH },
    ];
    for (const { id, ratio } of horizontals) {
      if (ratio === null) continue;
      const sy = plotMargin.top + ratio * plotHeight;
      if (screenX < plotMargin.left || screenX > plotMargin.left + plotWidth) continue;
      const dist = Math.abs(screenY - sy);
      if (dist < bestDist && dist < threshold) {
        bestDist = dist;
        best = id;
      }
    }

    return best;
  };

  const findHoveredCrossMeasureLabelX = (clientX: number, clientY: number): boolean => {
    if (!viewRef.current || !data || !crossCursorMode || cursorE === null || cursorG === null) return false;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const scaleX = (plotWidth / xSpan) * zoomX;
    const screenXE = plotMargin.left + (cursorE - minX) * scaleX + panX;
    const screenXG = plotMargin.left + (cursorG - minX) * scaleX + panX;
    const labelX = (screenXE + screenXG) / 2;
    const labelY = plotMargin.top + crossMeasureLabelY * plotHeight;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    const text = formatDeltaX(cursorG - cursorE);
    const textWidth = measureLabelText(text);
    const fontSize = 12;
    const textLeft = labelX - textWidth / 2;
    const textRight = labelX + textWidth / 2;
    const textTop = labelY - 5 - fontSize;
    const textBottom = labelY - 5;
    return (
      screenX >= textLeft - 10 &&
      screenX <= textRight + 10 &&
      screenY >= textTop - 10 &&
      screenY <= textBottom + 10
    );
  };

  const findHoveredCrossMeasureLabelY = (clientX: number, clientY: number): boolean => {
    if (!viewRef.current || !data || !crossCursorMode || !activeChannel || cursorF === null || cursorH === null) return false;
    const rect = viewRef.current.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
    const screenYF = getActiveChannelScreenYFromRatio(cursorF);
    const screenYH = getActiveChannelScreenYFromRatio(cursorH);
    if (screenYF === null || screenYH === null) return false;
    const labelX = plotMargin.left + crossMeasureLabelX * plotWidth;
    const labelY = (screenYF + screenYH) / 2;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    const deltaY = (getActiveChannelYFromRatio(cursorH) ?? 0) - (getActiveChannelYFromRatio(cursorF) ?? 0);
    const text = `ΔY: ${formatValue(deltaY, activeChannel.unit)}`;
    const textWidth = measureLabelText(text);
    const fontSize = 12;
    const textLeft = labelX + 6;
    const textRight = labelX + 6 + textWidth;
    const textTop = labelY - fontSize / 2;
    const textBottom = labelY + fontSize / 2;
    return (
      screenX >= textLeft - 10 &&
      screenX <= textRight + 10 &&
      screenY >= textTop - 10 &&
      screenY <= textBottom + 10
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    pointerMovedRef.current = false;

    if (cursorMode) {
      // 仅左键：优先拖动测量值标注，其次拖动光标；其余情况保留平移拖动
      if (event.button === 0) {
        if (findHoveredMeasureLabel(event.clientX, event.clientY)) {
          setDraggingMeasureLabel(true);
          return;
        }
        const hovered = findHoveredCursor(event.clientX);
        if (hovered) {
          setDraggingCursor(hovered);
          return;
        }
        setDragging(true);
        dragStartRef.current = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    if (horizontalCursorMode) {
      // 仅左键：优先拖动测量值标注，其次拖动光标；其余平移拖动（点击曲线切通道在 click 中处理）
      if (event.button === 0) {
        if (findHoveredHorizontalMeasureLabel(event.clientX, event.clientY)) {
          setDraggingHorizontalMeasureLabel(true);
          return;
        }
        const hovered = findHoveredHorizontalCursor(event.clientX, event.clientY);
        if (hovered) {
          setDraggingHorizontalCursor(hovered);
          return;
        }
        setDragging(true);
        dragStartRef.current = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    if (crossCursorMode) {
      // 仅左键：优先拖动 ΔX/ΔY 标注，其次拖动纵横线；其余平移拖动
      if (event.button === 0) {
        if (findHoveredCrossMeasureLabelX(event.clientX, event.clientY)) {
          setDraggingCrossMeasureLabelX(true);
          return;
        }
        if (findHoveredCrossMeasureLabelY(event.clientX, event.clientY)) {
          setDraggingCrossMeasureLabelY(true);
          return;
        }
        const hovered = findHoveredCrossCursor(event.clientX, event.clientY);
        if (hovered) {
          setDraggingCrossCursor(hovered);
          return;
        }
        setDragging(true);
        dragStartRef.current = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    const hovered = findHoveredChannel(event.clientX, event.clientY, 10);

    if (zoomYMode) {
      if (hovered) {
        setDraggingChannelId(hovered);
        if (hovered !== selectedChannelId) {
          setSelectedChannelId(hovered);
          zoomYJustSelectedRef.current = hovered;
        }
        channelDragStartRef.current = { y: event.clientY, channelId: hovered };
        setHoveredChannelId(hovered);
        return;
      }
    }

    setDragging(true);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointerStartRef.current) {
      const dx = event.clientX - pointerStartRef.current.x;
      const dy = event.clientY - pointerStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        pointerMovedRef.current = true;
      }
    }

    // 各类拖动状态优先处理
    if (draggingMeasureLabel) {
      const rect = viewRef.current?.getBoundingClientRect();
      if (rect) {
        const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
        const screenY = event.clientY - rect.top;
        const nextY = clamp((screenY - plotMargin.top) / plotHeight, 0, 1);
        setMeasureLabelY(nextY);
      }
      return;
    }

    if (draggingCursor) {
      const dataX = getDataXFromMouse(event.clientX);
      if (dataX !== null) {
        if (draggingCursor === 'A') setCursorA(dataX);
        else setCursorB(dataX);
      }
      return;
    }

    if (draggingHorizontalMeasureLabel) {
      const rect = viewRef.current?.getBoundingClientRect();
      if (rect) {
        const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
        const screenX = event.clientX - rect.left;
        const nextX = clamp((screenX - plotMargin.left) / plotWidth, 0, 1);
        setHorizontalMeasureLabelX(nextX);
      }
      return;
    }

    if (draggingHorizontalCursor) {
      const ratio = getMouseRatioY(event.clientY);
      if (ratio !== null) {
        if (draggingHorizontalCursor === 'C') setCursorC(ratio);
        else setCursorD(ratio);
      }
      return;
    }

    if (draggingCrossMeasureLabelX) {
      const rect = viewRef.current?.getBoundingClientRect();
      if (rect) {
        const plotHeight = Math.max(1, rect.height - plotMargin.top - plotMargin.bottom);
        const screenY = event.clientY - rect.top;
        const nextY = clamp((screenY - plotMargin.top) / plotHeight, 0, 1);
        setCrossMeasureLabelY(nextY);
      }
      return;
    }

    if (draggingCrossMeasureLabelY) {
      const rect = viewRef.current?.getBoundingClientRect();
      if (rect) {
        const plotWidth = Math.max(1, rect.width - plotMargin.left - plotMargin.right);
        const screenX = event.clientX - rect.left;
        const nextX = clamp((screenX - plotMargin.left) / plotWidth, 0, 1);
        setCrossMeasureLabelX(nextX);
      }
      return;
    }

    if (draggingCrossCursor) {
      if (draggingCrossCursor === 'EF') {
        const dataX = getDataXFromMouse(event.clientX);
        const ratio = getMouseRatioY(event.clientY);
        if (dataX !== null) setCursorE(dataX);
        if (ratio !== null) setCursorF(ratio);
      } else if (draggingCrossCursor === 'GH') {
        const dataX = getDataXFromMouse(event.clientX);
        const ratio = getMouseRatioY(event.clientY);
        if (dataX !== null) setCursorG(dataX);
        if (ratio !== null) setCursorH(ratio);
      } else if (draggingCrossCursor === 'E' || draggingCrossCursor === 'G') {
        const dataX = getDataXFromMouse(event.clientX);
        if (dataX !== null) {
          if (draggingCrossCursor === 'E') setCursorE(dataX);
          else setCursorG(dataX);
        }
      } else {
        const ratio = getMouseRatioY(event.clientY);
        if (ratio !== null) {
          if (draggingCrossCursor === 'F') setCursorF(ratio);
          else setCursorH(ratio);
        }
      }
      return;
    }

    if (draggingChannelId && channelDragStartRef.current) {
      const dy = event.clientY - channelDragStartRef.current.y;
      channelDragStartRef.current.y = event.clientY;
      const dims = getPlotDimensions(viewRef.current, plotMargin);
      if (dims) {
        setChannels((prev) => {
          const idx = prev.findIndex((c) => c.id === draggingChannelId);
          if (idx < 0) return prev;
          const ch = prev[idx];
          const bounds = getChannelYOffsetBounds(
            ch,
            idx,
            prev.length,
            dims.plotHeight,
            plotMargin
          );
          const nextOffset = clamp(ch.yOffset + dy, bounds.min, bounds.max);
          updateLockedY(ch.name, nextOffset, ch.yZoom);
          return prev.map((c) =>
            c.id === draggingChannelId ? { ...c, yOffset: nextOffset } : c
          );
        });
      }
      return;
    }

    if (dragging && dragStartRef.current) {
      const dx = event.clientX - dragStartRef.current.x;
      dragStartRef.current = { x: event.clientX, y: event.clientY };
      const dims = getPlotDimensions(viewRef.current, plotMargin);
      if (dims) {
        setPanX((prev) => clampPanX(prev + dx, zoomX, dims.plotWidth));
      }
      return;
    }

    // 非拖动状态下的悬停检测
    if (cursorMode) {
      const hoveredLabel = findHoveredMeasureLabel(event.clientX, event.clientY);
      setHoveredMeasureLabel(hoveredLabel);
      if (!hoveredLabel) {
        const hovered = findHoveredCursor(event.clientX);
        setHoveredCursor(hovered);
      } else {
        setHoveredCursor(null);
      }
      return;
    }

    if (horizontalCursorMode) {
      const hoveredLabel = findHoveredHorizontalMeasureLabel(event.clientX, event.clientY);
      setHoveredHorizontalMeasureLabel(hoveredLabel);
      if (!hoveredLabel) {
        const hovered = findHoveredHorizontalCursor(event.clientX, event.clientY);
        setHoveredHorizontalCursor(hovered);
      } else {
        setHoveredHorizontalCursor(null);
      }
      return;
    }

    if (crossCursorMode) {
      const hoveredLabelX = findHoveredCrossMeasureLabelX(event.clientX, event.clientY);
      const hoveredLabelY = findHoveredCrossMeasureLabelY(event.clientX, event.clientY);
      setHoveredCrossMeasureLabelX(hoveredLabelX);
      setHoveredCrossMeasureLabelY(hoveredLabelY);
      if (!hoveredLabelX && !hoveredLabelY) {
        const hovered = findHoveredCrossCursor(event.clientX, event.clientY);
        setHoveredCrossCursor(hovered);
      } else {
        setHoveredCrossCursor(null);
      }
      return;
    }

    if (zoomYMode) {
      const hovered = findHoveredChannel(event.clientX, event.clientY, 10);
      setHoveredChannelId(hovered);
    }
  };

  const handlePointerUp = () => {
    setDragging(false);
    setDraggingChannelId(null);
    setDraggingCursor(null);
    setDraggingMeasureLabel(false);
    setDraggingHorizontalCursor(null);
    setDraggingHorizontalMeasureLabel(false);
    setDraggingCrossCursor(null);
    setDraggingCrossMeasureLabelX(false);
    setDraggingCrossMeasureLabelY(false);
    dragStartRef.current = null;
    channelDragStartRef.current = null;
    pointerStartRef.current = null;
    // 拖动后由 click 事件不会触发，需要在这里清标记；纯点击则保留到 click 中处理
    if (pointerMovedRef.current) {
      zoomYJustSelectedRef.current = null;
    }
  };

  const handleCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (pointerMovedRef.current) return;

    if (cursorMode) {
      if (hoveredMeasureLabel) return;
      if (!event.ctrlKey) return;
      const dataX = getDataXFromMouse(event.clientX);
      if (dataX !== null) setCursorA(dataX);
      return;
    }

    if (horizontalCursorMode) {
      if (hoveredHorizontalMeasureLabel || hoveredHorizontalCursor) return;
      const hoveredChannel = findHoveredChannel(event.clientX, event.clientY, 10);
      if (!event.ctrlKey) {
        if (hoveredChannel) {
          setSelectedChannelId(hoveredChannel);
          setLastHorizontalActiveChannelId(hoveredChannel);
          setChannels((prev) =>
            prev.map((ch) => (ch.id === hoveredChannel ? { ...ch, visible: true } : ch))
          );
        }
        return;
      }
      const ratio = getMouseRatioY(event.clientY);
      if (ratio !== null) setCursorC(ratio);
      return;
    }

    if (crossCursorMode) {
      if (hoveredCrossMeasureLabelX || hoveredCrossMeasureLabelY || hoveredCrossCursor) return;
      const hoveredChannel = findHoveredChannel(event.clientX, event.clientY, 10);
      if (!event.ctrlKey) {
        if (hoveredChannel) {
          setSelectedChannelId(hoveredChannel);
          setLastCrossActiveChannelId(hoveredChannel);
          setChannels((prev) =>
            prev.map((ch) => (ch.id === hoveredChannel ? { ...ch, visible: true } : ch))
          );
        }
        return;
      }
      const dataX = getDataXFromMouse(event.clientX);
      const ratio = getMouseRatioY(event.clientY);
      if (dataX !== null) setCursorE(dataX);
      if (ratio !== null) setCursorF(ratio);
      return;
    }

    // 点击曲线选中该通道并显示左侧通道标识；Zoom Y 模式下首次点击仅激活，再次点击才放大 Y
    const hovered = findHoveredChannel(event.clientX, event.clientY, 10);
    if (hovered) {
      const alreadySelected = hovered === selectedChannelId;
      setSelectedChannelId(hovered);
      if (zoomYMode && alreadySelected && !zoomYJustSelectedRef.current) {
        setChannels((prev) =>
          prev.map((ch) => {
            if (ch.id !== hovered) return ch;
            const nextZoom = clamp(ch.yZoom * 2, 0.015625, 32);
            updateLockedY(ch.name, ch.yOffset, nextZoom);
            return { ...ch, yZoom: nextZoom };
          })
        );
      }
      zoomYJustSelectedRef.current = null;
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
    if (cursorMode) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (pointerMovedRef.current) return;
      if (hoveredMeasureLabel) return;
      const dataX = getDataXFromMouse(event.clientX);
      if (dataX !== null) setCursorB(dataX);
      return;
    }

    if (horizontalCursorMode) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (pointerMovedRef.current) return;
      if (hoveredHorizontalMeasureLabel || hoveredHorizontalCursor) return;
      const ratio = getMouseRatioY(event.clientY);
      if (ratio !== null) setCursorD(ratio);
      return;
    }

    if (crossCursorMode) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (pointerMovedRef.current) return;
      if (hoveredCrossMeasureLabelX || hoveredCrossMeasureLabelY || hoveredCrossCursor) return;
      const dataX = getDataXFromMouse(event.clientX);
      const ratio = getMouseRatioY(event.clientY);
      if (dataX !== null) setCursorG(dataX);
      if (ratio !== null) setCursorH(ratio);
      return;
    }

    event.preventDefault();
    if (zoomYMode && hoveredChannelId) {
      setChannels((prev) =>
        prev.map((ch) => {
          if (ch.id !== hoveredChannelId) return ch;
          const nextZoom = clamp(ch.yZoom * 0.5, 0.015625, 32);
          updateLockedY(ch.name, ch.yOffset, nextZoom);
          return { ...ch, yZoom: nextZoom };
        })
      );
    }
  };

  const toggleChannel = (id: string) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.id === id ? { ...ch, visible: !ch.visible } : ch))
    );
  };

  const toggleChannelInvert = (id: string) => {
    const ch = channels.find((c) => c.id === id);
    if (!ch) return;
    const nextInverted = !ch.inverted;
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, inverted: nextInverted } : c))
    );
    if (sortLockEnabled) {
      setLockedY((prev) => ({
        ...prev,
        [ch.name]: {
          yOffset: ch.yOffset,
          yZoom: ch.yZoom,
          inverted: nextInverted,
          customName: ch.customName,
        },
      }));
    }
  };

  const startEditingChannelName = (id: string, currentCustomName: string) => {
    setEditingChannelId(id);
    setEditingName(currentCustomName);
  };

  const saveEditingChannelName = () => {
    if (!editingChannelId) return;
    const trimmed = editingName.trim();
    setChannels((prev) =>
      prev.map((ch) => (ch.id === editingChannelId ? { ...ch, customName: trimmed } : ch))
    );
    if (sortLockEnabled) {
      const ch = channels.find((c) => c.id === editingChannelId);
      if (ch) {
        setLockedY((prev) => ({
          ...prev,
          [ch.name]: {
            yOffset: ch.yOffset,
            yZoom: ch.yZoom,
            inverted: ch.inverted ?? false,
            customName: trimmed,
          },
        }));
      }
    }
    setEditingChannelId(null);
    setEditingName('');
  };

  const cancelEditingChannelName = () => {
    setEditingChannelId(null);
    setEditingName('');
  };

  const handleChannelDragStart = (event: DragEvent<HTMLSpanElement>, id: string) => {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    draggedChannelRef.current = id;
    setDraggedId(id);
    setDropIndex(null);
  };

  const computeDropIndex = (event: DragEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    const listRect = list.getBoundingClientRect();
    const relY = event.clientY - listRect.top;
    const items = Array.from(list.querySelectorAll('.channel-item'));
    let insertIndex = 0;
    for (let i = 0; i < items.length; i += 1) {
      const itemRect = items[i].getBoundingClientRect();
      const itemMidY = itemRect.top + itemRect.height / 2 - listRect.top;
      if (relY > itemMidY) {
        insertIndex = i + 1;
      }
    }
    return insertIndex;
  };

  const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropIndex(computeDropIndex(event));
  };

  const handleListDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggedChannelRef.current;
    if (!sourceId) {
      setDropIndex(null);
      return;
    }
    const insertIndex = computeDropIndex(event);
    const fromIndex = channels.findIndex((ch) => ch.id === sourceId);
    if (fromIndex !== -1) {
      const targetIndex = fromIndex < insertIndex ? insertIndex - 1 : insertIndex;
      if (targetIndex !== fromIndex) {
        const next = [...channels];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(targetIndex, 0, moved);
        // 方案 A：重排后统一把所有通道 yOffset 重置为 0，避免 band 变化导致的错位/出界
        const reset = next.map((ch) => ({ ...ch, yOffset: 0 }));
        setChannels(reset);
        if (sortLockEnabled) {
          setLockedOrder(reset.map((ch) => ch.name));
          setLockedY(
            Object.fromEntries(
              reset.map((ch) => [ch.name, { yOffset: 0, yZoom: ch.yZoom, inverted: ch.inverted ?? false, customName: ch.customName }])
            )
          );
        }
      }
    }
    draggedChannelRef.current = null;
    setDraggedId(null);
    setDropIndex(null);
  };

  const handleChannelDragEnd = () => {
    draggedChannelRef.current = null;
    setDraggedId(null);
    setDropIndex(null);
  };

  const resetView = () => {
    setZoomX(1);
    setPanX(0);
    setCursorA(null);
    setCursorB(null);
    setZoomXMode(false);
    setZoomYMode(false);
    setCursorMode(false);
    setHoveredChannelId(null);
    setDraggingChannelId(null);
    setHoveredCursor(null);
    setMeasureLabelY(0.35);
    setHoveredMeasureLabel(false);
    setDraggingMeasureLabel(false);
    setHorizontalCursorMode(false);
    setCursorC(null);
    setCursorD(null);
    setHoveredHorizontalCursor(null);
    setDraggingHorizontalCursor(null);
    setHorizontalMeasureLabelX(0.65);
    setHoveredHorizontalMeasureLabel(false);
    setDraggingHorizontalMeasureLabel(false);
    setCrossCursorMode(false);
    setCursorE(null);
    setCursorF(null);
    setCursorG(null);
    setCursorH(null);
    setHoveredCrossCursor(null);
    setDraggingCrossCursor(null);
    setCrossMeasureLabelY(0.35);
    setCrossMeasureLabelX(0.65);
    setHoveredCrossMeasureLabelX(false);
    setDraggingCrossMeasureLabelX(false);
    setHoveredCrossMeasureLabelY(false);
    setDraggingCrossMeasureLabelY(false);
    setSelectedChannelId(null);
    setLastHorizontalActiveChannelId(null);
    setLastCrossActiveChannelId(null);
    setChannels((prev) => prev.map((ch) => ({ ...ch, yOffset: 0, yZoom: 1 })));
  };

  const toggleCursorMode = () => {
    setCursorMode((prev) => {
      const next = !prev;
      if (next) {
        // 光标模式与 Zoom Y 冲突，自动关闭；Zoom X 可共存；横向光标互斥
        setZoomYMode(false);
        setHorizontalCursorMode(false);
        setHoveredHorizontalCursor(null);
        setDraggingHorizontalCursor(null);
        setHoveredHorizontalMeasureLabel(false);
        setDraggingHorizontalMeasureLabel(false);
        setCrossCursorMode(false);
        setHoveredCrossCursor(null);
        setDraggingCrossCursor(null);
        setHoveredCrossMeasureLabelX(false);
        setDraggingCrossMeasureLabelX(false);
        setHoveredCrossMeasureLabelY(false);
        setDraggingCrossMeasureLabelY(false);
        setSelectedChannelId(null);
      } else {
        setHoveredCursor(null);
        setHoveredMeasureLabel(false);
        setDraggingMeasureLabel(false);
      }
      return next;
    });
  };

  const toggleHorizontalCursorMode = () => {
    setHorizontalCursorMode((prev) => {
      const next = !prev;
      if (next) {
        // 横向光标与 Zoom Y、纵向光标互斥
        setZoomYMode(false);
        setCursorMode(false);
        setHoveredCursor(null);
        setDraggingCursor(null);
        setHoveredMeasureLabel(false);
        setDraggingMeasureLabel(false);
        setCrossCursorMode(false);
        setHoveredCrossCursor(null);
        setDraggingCrossCursor(null);
        setHoveredCrossMeasureLabelX(false);
        setDraggingCrossMeasureLabelX(false);
        setHoveredCrossMeasureLabelY(false);
        setDraggingCrossMeasureLabelY(false);
        // 优先恢复横向测量上次激活的通道，否则激活第一个可见通道
        const target =
          channels.find((ch) => ch.id === lastHorizontalActiveChannelId && ch.visible)?.id ??
          visibleChannels[0]?.id ??
          null;
        setSelectedChannelId(target);
        if (target) setLastHorizontalActiveChannelId(target);
      } else {
        setHoveredHorizontalCursor(null);
        setDraggingHorizontalCursor(null);
        setHoveredHorizontalMeasureLabel(false);
        setDraggingHorizontalMeasureLabel(false);
        setSelectedChannelId(null);
      }
      return next;
    });
  };

  const toggleCrossCursorMode = () => {
    setCrossCursorMode((prev) => {
      const next = !prev;
      if (next) {
        // 纵横光标与 Zoom Y、纵向光标、横向光标互斥
        setZoomYMode(false);
        setCursorMode(false);
        setHoveredCursor(null);
        setDraggingCursor(null);
        setHoveredMeasureLabel(false);
        setDraggingMeasureLabel(false);
        setHorizontalCursorMode(false);
        setHoveredHorizontalCursor(null);
        setDraggingHorizontalCursor(null);
        setHoveredHorizontalMeasureLabel(false);
        setDraggingHorizontalMeasureLabel(false);
        // 优先恢复纵横测量上次激活的通道，否则激活 CH1，再否则激活第一个可见通道
        const target =
          channels.find((ch) => ch.id === lastCrossActiveChannelId && ch.visible)?.id ??
          channels.find((ch) => ch.id === 'CH1' && ch.visible)?.id ??
          visibleChannels[0]?.id ??
          null;
        setSelectedChannelId(target);
        if (target) setLastCrossActiveChannelId(target);
      } else {
        setHoveredCrossCursor(null);
        setDraggingCrossCursor(null);
        setHoveredCrossMeasureLabelX(false);
        setDraggingCrossMeasureLabelX(false);
        setHoveredCrossMeasureLabelY(false);
        setDraggingCrossMeasureLabelY(false);
        setSelectedChannelId(null);
      }
      return next;
    });
  };

  const handleClearCursors = () => {
    if (cursorMode) {
      setCursorA(null);
      setCursorB(null);
      setHoveredCursor(null);
      setDraggingCursor(null);
      setMeasureLabelY(0.35);
      setHoveredMeasureLabel(false);
      setDraggingMeasureLabel(false);
    }
    if (horizontalCursorMode) {
      setCursorC(null);
      setCursorD(null);
      setHoveredHorizontalCursor(null);
      setDraggingHorizontalCursor(null);
      setHorizontalMeasureLabelX(0.65);
      setHoveredHorizontalMeasureLabel(false);
      setDraggingHorizontalMeasureLabel(false);
    }
    if (crossCursorMode) {
      setCursorE(null);
      setCursorF(null);
      setCursorG(null);
      setCursorH(null);
      setHoveredCrossCursor(null);
      setDraggingCrossCursor(null);
      setCrossMeasureLabelY(0.35);
      setCrossMeasureLabelX(0.65);
      setHoveredCrossMeasureLabelX(false);
      setDraggingCrossMeasureLabelX(false);
      setHoveredCrossMeasureLabelY(false);
      setDraggingCrossMeasureLabelY(false);
    }
  };

  // 窗口大小变化时触发重绘
  useEffect(() => {
    const handleResize = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 窗口大小变化或状态变化时重新限制水平平移
  useEffect(() => {
    const dims = getPlotDimensions(viewRef.current, plotMargin);
    if (!dims) return;
    const nextPanX = clampPanX(panX, zoomX, dims.plotWidth);
    if (nextPanX !== panX) setPanX(nextPanX);
  }, [zoomX, panX, resizeTick]);

  // 绘制示波器画面
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = viewRef.current;
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    const width = rect.width;
    const height = rect.height;
    const plotWidth = Math.max(1, width - plotMargin.left - plotMargin.right);
    const plotHeight = Math.max(1, height - plotMargin.top - plotMargin.bottom);

    // 背景
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);

    if (channels.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px Inter, ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        error ?? '请上传或拖拽 Yokogawa CSV 文件',
        width / 2,
        height / 2
      );
      ctx.textAlign = 'left';
      return;
    }

    const totalChannels = channels.length;
    const { minX, maxX } = getTimeRange(data, channels);
    const xSpan = maxX - minX || 1;
    const scaleX = (plotWidth / xSpan) * zoomX;

    drawGrid(ctx, plotMargin, plotWidth, plotHeight);
    drawAxes(ctx, plotMargin, plotWidth, plotHeight, minX, maxX, scaleX, panX);

    // 使用裁剪限制波形和光标只绘制在图形框内部
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotMargin.left, plotMargin.top, plotWidth, plotHeight);
    ctx.clip();

    channels.forEach((ch, index) => {
      if (ch.visible) {
        drawChannelWaveform(ctx, ch, index, totalChannels, plotMargin, plotWidth, plotHeight, scaleX, panX, minX, activeChannelId, horizontalCursorMode, crossCursorMode);
      }
    });

    // 纵向光标模式下绘制 A/B 虚线与测量虚线
    if (cursorMode) {
      drawCursorLine(ctx, cursorA, '#ffffff', plotMargin, plotHeight, minX, scaleX, panX);
      drawCursorLine(ctx, cursorB, '#ffffff', plotMargin, plotHeight, minX, scaleX, panX);
      drawMeasureLine(ctx, cursorA, cursorB, measureLabelY, plotMargin, plotWidth, plotHeight, minX, scaleX, panX);
    }

    // 横向光标模式下绘制 C/D 虚线与测量虚线
    const screenYC = horizontalCursorMode ? getActiveChannelScreenYFromRatio(cursorC) : null;
    const screenYD = horizontalCursorMode ? getActiveChannelScreenYFromRatio(cursorD) : null;
    const dataYC = horizontalCursorMode ? getActiveChannelYFromRatio(cursorC) : null;
    const dataYD = horizontalCursorMode ? getActiveChannelYFromRatio(cursorD) : null;
    if (horizontalCursorMode) {
      drawHorizontalCursorLine(ctx, cursorC, '#ffffff', plotMargin, plotWidth, plotHeight, screenYC);
      drawHorizontalCursorLine(ctx, cursorD, '#ffffff', plotMargin, plotWidth, plotHeight, screenYD);
      drawHorizontalMeasureAnnotation(ctx, dataYC, dataYD, horizontalMeasureLabelX, activeChannel, plotMargin, plotWidth, plotHeight, screenYC, screenYD);
    }

    // 纵横光标模式下绘制 EF/GH 十字虚线与 ΔX/ΔY 测量虚线
    const screenYF = crossCursorMode ? getActiveChannelScreenYFromRatio(cursorF) : null;
    const screenYH = crossCursorMode ? getActiveChannelScreenYFromRatio(cursorH) : null;
    const dataYF = crossCursorMode ? getActiveChannelYFromRatio(cursorF) : null;
    const dataYH = crossCursorMode ? getActiveChannelYFromRatio(cursorH) : null;
    if (crossCursorMode) {
      drawCursorLine(ctx, cursorE, '#ff8a64', plotMargin, plotHeight, minX, scaleX, panX);
      drawCursorLine(ctx, cursorG, '#64d0ff', plotMargin, plotHeight, minX, scaleX, panX);
      drawHorizontalCursorLine(ctx, cursorF, '#ff8a64', plotMargin, plotWidth, plotHeight, screenYF);
      drawHorizontalCursorLine(ctx, cursorH, '#64d0ff', plotMargin, plotWidth, plotHeight, screenYH);
      drawMeasureLine(ctx, cursorE, cursorG, crossMeasureLabelY, plotMargin, plotWidth, plotHeight, minX, scaleX, panX);
      drawCrossMeasureXLabel(ctx, cursorE, cursorG, crossMeasureLabelY, plotMargin, plotWidth, plotHeight, minX, scaleX, panX);
      drawHorizontalMeasureAnnotation(ctx, dataYF, dataYH, crossMeasureLabelX, activeChannel, plotMargin, plotWidth, plotHeight, screenYF, screenYH);
    }

    ctx.restore();

    // 标签绘制在裁剪区域外，确保始终可读；隐藏通道标签变淡
    const singleChannelMode = zoomYMode || horizontalCursorMode || crossCursorMode;
    channels.forEach((ch, index) => {
      drawChannelLabels(ctx, ch, index, totalChannels, plotMargin, plotHeight, labelChannelId, singleChannelMode);
    });

    // 纵向光标模式下绘制 A/B 标签与测量值文本
    if (cursorMode) {
      drawCursorLabel(ctx, cursorA, '#ff8a64', 'A', plotMargin, plotWidth, minX, scaleX, panX);
      drawCursorLabel(ctx, cursorB, '#64d0ff', 'B', plotMargin, plotWidth, minX, scaleX, panX);
      drawMeasureLabel(ctx, cursorA, cursorB, measureLabelY, plotMargin, plotWidth, plotHeight, minX, scaleX, panX);
    }

    // 横向光标模式下绘制 C/D 标签
    if (horizontalCursorMode) {
      drawHorizontalCursorLabel(ctx, cursorC, '#ff8a64', 'C', plotMargin, plotWidth, plotHeight, screenYC);
      drawHorizontalCursorLabel(ctx, cursorD, '#64d0ff', 'D', plotMargin, plotWidth, plotHeight, screenYD);
    }

    // 纵横光标模式下绘制 EF/GH 标签
    if (crossCursorMode) {
      drawCursorLabel(ctx, cursorE, '#ff8a64', 'E', plotMargin, plotWidth, minX, scaleX, panX);
      drawCursorLabel(ctx, cursorG, '#64d0ff', 'G', plotMargin, plotWidth, minX, scaleX, panX);
      drawHorizontalCursorLabel(ctx, cursorF, '#ff8a64', 'F', plotMargin, plotWidth, plotHeight, screenYF);
      drawHorizontalCursorLabel(ctx, cursorH, '#64d0ff', 'H', plotMargin, plotWidth, plotHeight, screenYH);
    }

    const overlayChannel = singleChannelMode
      ? zoomYMode
        ? channels.find((ch) => ch.id === selectedChannelId && ch.visible) ?? null
        : activeChannel
      : null;
    drawOverlay(ctx, data, visibleChannels, width, plotMargin, plotWidth, minX, maxX, zoomX, testTemp, testVoltage, singleChannelMode, overlayChannel, totalChannels, currentFilename);
  }, [channels, visibleChannels, data, zoomX, panX, error, resizeTick, zoomYMode, hoveredChannelId, draggingChannelId, selectedChannelId, cursorMode, cursorA, cursorB, hoveredCursor, draggingCursor, measureLabelY, draggingMeasureLabel, hoveredMeasureLabel, horizontalCursorMode, cursorC, cursorD, hoveredHorizontalCursor, draggingHorizontalCursor, horizontalMeasureLabelX, draggingHorizontalMeasureLabel, hoveredHorizontalMeasureLabel, crossCursorMode, cursorE, cursorF, cursorG, cursorH, hoveredCrossCursor, draggingCrossCursor, crossMeasureLabelY, crossMeasureLabelX, draggingCrossMeasureLabelX, draggingCrossMeasureLabelY, hoveredCrossMeasureLabelX, hoveredCrossMeasureLabelY, activeChannel, testTemp, testVoltage, currentFilename]);

  // 计算每个通道在光标处的值
  const cursorValues = useMemo(() => {
    if (cursorA === null && cursorB === null) return [];
    return visibleChannels.map((ch) => {
      const pointA = cursorA !== null ? findNearestPoint(ch, cursorA) : null;
      const pointB = cursorB !== null ? findNearestPoint(ch, cursorB) : null;
      const deltaY = pointA && pointB ? pointB.y - pointA.y : null;
      return {
        channel: ch,
        a: pointA?.y ?? null,
        b: pointB?.y ?? null,
        deltaY,
      };
    });
  }, [visibleChannels, cursorA, cursorB]);

  const draggedIndex = draggedId ? channels.findIndex((ch) => ch.id === draggedId) : -1;

  const shouldShowInsertLine = (index: number) => {
    if (dropIndex !== index) return false;
    if (draggedIndex === -1) return false;
    // 拖动第一个通道时，其上下方都不需要插入位
    if (draggedIndex === 0 && (index === 0 || index === 1)) return false;
    // 拖动最后一个通道时，其上下方都不需要插入位
    if (draggedIndex === channels.length - 1 && (index === channels.length - 1 || index === channels.length)) return false;
    return true;
  };

  return (
    <div className="app-shell">
      <header className="scope-header">
        <h1>Oscilloscope Data Analyzer</h1>
        <div className="scope-toolbar">
          <button
            type="button"
            className={`toolbar-btn ${zoomXMode ? 'active' : ''}`}
            onClick={() => setZoomXMode((v) => !v)}
            title="激活后滚轮缩放 X 轴"
          >
            Zoom X
          </button>
          <button
            type="button"
            className={`toolbar-btn ${zoomYMode ? 'active' : ''}`}
            onClick={() => {
              setZoomYMode((v) => !v);
              setCursorMode(false);
              setHorizontalCursorMode(false);
              setCrossCursorMode(false);
              setHoveredCrossCursor(null);
              setDraggingCrossCursor(null);
              setHoveredCrossMeasureLabelX(false);
              setDraggingCrossMeasureLabelX(false);
              setHoveredCrossMeasureLabelY(false);
              setDraggingCrossMeasureLabelY(false);
              setSelectedChannelId(null);
            }}
            title="激活后点击/拖动单条曲线进行 Y 方向操作"
          >
            Zoom Y
          </button>
          <button
            type="button"
            className={`toolbar-btn ${cursorMode ? 'active' : ''}`}
            onClick={toggleCursorMode}
            title="激活后 Ctrl+左键设置光标 A，Ctrl+右键设置光标 B，可拖动测量线"
          >
            纵向光标
          </button>
          <button
            type="button"
            className={`toolbar-btn ${horizontalCursorMode ? 'active' : ''}`}
            onClick={toggleHorizontalCursorMode}
            title="激活后选择通道，Ctrl+左键设置光标 C，Ctrl+右键设置光标 D，可拖动测量线"
          >
            横向光标
          </button>
          <button
            type="button"
            className={`toolbar-btn ${crossCursorMode ? 'active' : ''}`}
            onClick={toggleCrossCursorMode}
            title="激活后选择通道，Ctrl+左键设置十字线 EF，Ctrl+右键设置十字线 GH，可拖动测量线"
          >
            纵横光标
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={!cursorMode && !horizontalCursorMode && !crossCursorMode}
            onClick={handleClearCursors}
            title="清除当前测量模式下的光标和标注"
          >
            清除光标
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={resetView}
            title="重置视图"
          >
            重置视图
          </button>
          <button
            type="button"
            className={`toolbar-btn ${showHelp ? 'active' : ''}`}
            onClick={() => setShowHelp((v) => !v)}
            title="打开/关闭帮助说明"
          >
            帮助
          </button>
        </div>
        <div className="scope-meta">
          {data ? (
            <>
              <span>采样数: {data.sampleCount.toLocaleString()}</span>
              <span>采样间隔: {formatValue(data.hResolution, data.hUnit)}</span>
              <span>通道: {data.channels.length}</span>
            </>
          ) : (
            <span>等待 CSV 文件</span>
          )}
        </div>
      </header>

      <main className="scope-main">
        <section
          className="scope-display"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onWheel={handleWheel}
        >
          <div ref={viewRef} className="canvas-frame">
            <canvas
              ref={canvasRef}
              style={{
                cursor: dragging
                  ? 'grabbing'
                  : crossCursorMode && (
                      hoveredCrossMeasureLabelX ||
                      hoveredCrossMeasureLabelY ||
                      draggingCrossMeasureLabelX ||
                      draggingCrossMeasureLabelY
                    )
                  ? 'pointer'
                  : crossCursorMode && hoveredCrossCursor
                  ? 'pointer'
                  : crossCursorMode
                  ? 'crosshair'
                  : horizontalCursorMode && (hoveredHorizontalMeasureLabel || draggingHorizontalMeasureLabel)
                  ? 'pointer'
                  : horizontalCursorMode && hoveredHorizontalCursor
                  ? 'pointer'
                  : horizontalCursorMode
                  ? 'crosshair'
                  : cursorMode && (hoveredMeasureLabel || draggingMeasureLabel)
                  ? 'pointer'
                  : cursorMode && hoveredCursor
                  ? 'pointer'
                  : cursorMode
                  ? 'crosshair'
                  : zoomYMode && hoveredChannelId
                  ? 'ns-resize'
                  : 'crosshair',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onClick={handleCanvasClick}
              onContextMenu={handleContextMenu}
            />
          </div>

          <div className="test-condition-form">
            <label htmlFor="test-temp">温度(°C)</label>
            <input
              id="test-temp"
              type="text"
              value={testTemp}
              onChange={(e) => setTestTemp(e.target.value)}
            />
            <label htmlFor="test-voltage">电压(V)</label>
            <input
              id="test-voltage"
              type="text"
              value={testVoltage}
              onChange={(e) => setTestVoltage(e.target.value)}
            />
            <label htmlFor="test-location">地点</label>
            <input
              id="test-location"
              type="text"
              placeholder="Location"
              value={testLocation}
              onChange={(e) => setTestLocation(e.target.value)}
            />
            <label htmlFor="test-date">日期</label>
            <input
              id="test-date"
              type="text"
              value={testDate}
              disabled
            />
            <input
              ref={importConditionsRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportConditions(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="test-condition-btn"
              onClick={() => importConditionsRef.current?.click()}
            >
              导入
            </button>
            <button
              type="button"
              className="test-condition-btn"
              onClick={handleExportConditions}
            >
              导出
            </button>
          </div>

          {showHelp && (
            <div
              className="help-overlay"
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="help-panel">
                <div className="help-header">
                  <h2>帮助说明</h2>
                  <button
                    type="button"
                    className="help-close"
                    onClick={() => setShowHelp(false)}
                    aria-label="关闭帮助"
                  >
                    ✕
                  </button>
                </div>
                <div className="help-body">
                  <section>
                    <h3>开发者</h3>
                    <p>David Zhu (Inteva)</p>
                    <p>Kimi Code</p>
                  </section>
                  <section>
                    <h3>版本说明</h3>
                    <p>v0.0.1</p>
                    <p>基于 Vite + React + TypeScript 构建，无外部图表库。</p>
                  </section>
                  <section>
                    <h3>操作指南</h3>
                    <ul>
                      <li>上传或拖拽 Yokogawa CSV 文件到左侧文件区或波形显示区。</li>
                      <li>左侧通道列表可勾选显示/隐藏、拖动排序、双击自定义名称。</li>
                      <li><strong>Zoom X</strong>：激活后滚轮缩放 X 轴，以鼠标位置为中心。</li>
                      <li><strong>Zoom Y</strong>：激活后点击通道首次选中，再次点击放大 Y；悬停曲线后拖动可上下移动通道。</li>
                      <li><strong>纵向光标</strong>：左键设置 A，右键设置 B，拖动虚线或标注。</li>
                      <li><strong>横向光标</strong>：选择激活通道后，左键设置 C，右键设置 D，拖动横线或标注。</li>
                      <li><strong>纵横光标</strong>：选择激活通道后，左键设置十字线 EF，右键设置 GH；拖动单线或交点移动十字线。</li>
                      <li><strong>清除光标</strong>：清除当前测量模式下的光标和标注。</li>
                      <li><strong>重置视图</strong>：恢复所有缩放、平移和测量状态。</li>
                    </ul>
                  </section>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="scope-sidebar">
          <div className="panel">
            <h2>文件</h2>
            <label className="file-label" htmlFor="file" title={currentFilename ?? '上传或拖拽 CSV'}>
              {currentFilename ?? '上传或拖拽 CSV'}
            </label>
            <input
              id="file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
            />
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>通道</h2>
              <button
                type="button"
                className={`lock-btn ${sortLockEnabled ? 'active' : ''}`}
                onClick={toggleSortLock}
                title={sortLockEnabled ? '序列锁定已开启：相同通道组的新文件将沿用当前排序' : '序列锁定已关闭：新文件按默认顺序加载'}
              >
                {sortLockEnabled ? '🔒 序列锁定' : '🔓 序列锁定'}
              </button>
            </div>
            <div
              className="channel-list"
              onDragOver={handleListDragOver}
              onDrop={handleListDrop}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setDropIndex(null);
                }
              }}
            >
              {channels.map((ch, index) => (
                <Fragment key={ch.id}>
                  {shouldShowInsertLine(index) && <div className="channel-insert-line" />}
                  <div
                    className={`channel-item ${draggedId === ch.id ? 'dragging' : ''}`}
                    style={{ '--ch-color': ch.color } as React.CSSProperties}
                  >
                    <div
                      className="channel-content"
                      draggable={editingChannelId !== ch.id}
                      style={{ cursor: horizontalCursorMode || crossCursorMode || zoomYMode ? 'pointer' : undefined }}
                      onDragStart={(event) => handleChannelDragStart(event, ch.id)}
                      onDragEnd={handleChannelDragEnd}
                      onClick={(event) => {
                        if (!horizontalCursorMode && !crossCursorMode && !zoomYMode) return;
                        if ((event.target as HTMLElement).tagName === 'INPUT') return;
                        if (!ch.visible) {
                          setChannels((prev) =>
                            prev.map((c) => (c.id === ch.id ? { ...c, visible: true } : c))
                          );
                        }
                        setSelectedChannelId(ch.id);
                        if (horizontalCursorMode) setLastHorizontalActiveChannelId(ch.id);
                        if (crossCursorMode) setLastCrossActiveChannelId(ch.id);
                      }}
                      title="拖动排序；双击通道名可重命名；测量/Zoom Y 模式下点击可激活通道"
                    >
                      <input
                        id={`ch-${ch.id}`}
                        type="checkbox"
                        checked={ch.visible}
                        onChange={() => toggleChannel(ch.id)}
                      />
                      <span
                        className="channel-color"
                        style={{
                          opacity:
                            ch.visible &&
                            ((horizontalCursorMode || crossCursorMode) && activeChannel !== null && ch.id !== activeChannel.id)
                              ? 0.25
                              : 1,
                          backgroundColor: ch.visible ? undefined : '#4b5563',
                          boxShadow: ch.visible ? undefined : 'none',
                        }}
                      />
                      <span className="channel-name">{ch.name}</span>
                      {editingChannelId === ch.id ? (
                        <input
                          className="channel-name-input"
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={saveEditingChannelName}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditingChannelName();
                            if (e.key === 'Escape') cancelEditingChannelName();
                          }}
                          autoFocus
                          placeholder="自定义名称"
                        />
                      ) : (
                        <span
                          className="channel-custom-name editable"
                          onDoubleClick={() => startEditingChannelName(ch.id, ch.customName)}
                          title="双击编辑自定义名称"
                        >
                          {ch.customName ? `(${ch.customName})` : <span className="custom-name-placeholder">(Name)</span>}
                        </span>
                      )}
                      <button
                        type="button"
                        className={`channel-invert-btn ${ch.inverted ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleChannelInvert(ch.id);
                        }}
                        title={ch.inverted ? '取消反相' : '通道反相'}
                      >
                        R
                      </button>
                      <span className="channel-unit">[{ch.unit}]</span>
                    </div>
                  </div>
                </Fragment>
              ))}
              {shouldShowInsertLine(channels.length) && <div className="channel-insert-line" />}
              {channels.length === 0 && <div className="empty-tip">暂无通道</div>}
            </div>
          </div>

          {cursorMode && (
            <div className="panel measure-panel">
              <h2>光标测量</h2>
              <div className="cursor-info">
                <span className="cursor-a">A: {cursorA !== null ? cursorA.toFixed(6) : '未选择'}</span>
                <span className="cursor-b">B: {cursorB !== null ? cursorB.toFixed(6) : '未选择'}</span>
                {cursorA !== null && cursorB !== null && (
                  <span className="cursor-delta">{formatDeltaT(cursorB - cursorA)}</span>
                )}
              </div>
              {cursorValues.length > 0 && (
                <table className="measure-table">
                  <thead>
                    <tr>
                      <th>通道</th>
                      <th>A</th>
                      <th>B</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cursorValues.map(({ channel, a, b, deltaY }) => (
                      <tr key={channel.id}>
                        <td style={{ color: channel.color }}>{channel.name}</td>
                        <td>{formatValue(a, channel.unit)}</td>
                        <td>{formatValue(b, channel.unit)}</td>
                        <td>{formatValue(deltaY, channel.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {horizontalCursorMode && activeChannel && (
            <div className="panel measure-panel">
              <h2>横向光标测量</h2>
              <div className="cursor-info">
                <span style={{ color: activeChannel.color }}>通道: {activeChannel.name}</span>
                <span className="cursor-a">
                  C: {cursorC !== null ? formatValue(getActiveChannelYFromRatio(cursorC), activeChannel.unit) : '未选择'}
                </span>
                <span className="cursor-b">
                  D: {cursorD !== null ? formatValue(getActiveChannelYFromRatio(cursorD), activeChannel.unit) : '未选择'}
                </span>
                {cursorC !== null && cursorD !== null && (
                  <span className="cursor-delta">
                    ΔY: {formatValue(
                      (getActiveChannelYFromRatio(cursorD) ?? 0) - (getActiveChannelYFromRatio(cursorC) ?? 0),
                      activeChannel.unit
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          {crossCursorMode && activeChannel && (
            <div className="panel measure-panel">
              <h2>纵横光标测量</h2>
              <div className="cursor-info">
                <span style={{ color: activeChannel.color }}>通道: {activeChannel.name}</span>
                <span className="cursor-a">
                  E: {cursorE !== null ? cursorE.toFixed(6) : '未选择'}
                </span>
                <span className="cursor-a">
                  F: {cursorF !== null ? formatValue(getActiveChannelYFromRatio(cursorF), activeChannel.unit) : '未选择'}
                </span>
                <span className="cursor-b">
                  G: {cursorG !== null ? cursorG.toFixed(6) : '未选择'}
                </span>
                <span className="cursor-b">
                  H: {cursorH !== null ? formatValue(getActiveChannelYFromRatio(cursorH), activeChannel.unit) : '未选择'}
                </span>
                {cursorE !== null && cursorG !== null && (
                  <span className="cursor-delta">{formatDeltaX(cursorG - cursorE)}</span>
                )}
                {cursorF !== null && cursorH !== null && (
                  <span className="cursor-delta">
                    ΔY: {formatValue(
                      (getActiveChannelYFromRatio(cursorH) ?? 0) - (getActiveChannelYFromRatio(cursorF) ?? 0),
                      activeChannel.unit
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          {data && Object.keys(data.metadata).length > 0 && (
            <div className="panel metadata-panel">
              <h2>文件信息</h2>
              <dl className="metadata-list">
                {Object.entries(data.metadata).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

// ---------- 绘图辅助函数 ----------

function getTimeRange(data: OscilloscopeData | null, channels: Channel[]): { minX: number; maxX: number } {
  if (data && data.sampleCount > 0) {
    const minX = data.hOffset;
    const maxX = data.hOffset + (data.sampleCount - 1) * data.hResolution;
    if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX) {
      return { minX, maxX };
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const ch of channels) {
    if (ch.points.length > 0) {
      minX = Math.min(minX, ch.points[0].x);
      maxX = Math.max(maxX, ch.points[ch.points.length - 1].x);
    }
  }

  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1 };
  if (minX === maxX) return { minX: minX - 0.5, maxX: maxX + 0.5 };
  return { minX, maxX };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number
) {
  // 外框
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(margin.left, margin.top, plotWidth, plotHeight);

  // 主网格：9 条横线 + 9 条竖线，坐标轴上无点；每条线 99 个点
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  // 竖线（x = 10% ~ 90%）
  for (let i = 1; i <= 9; i += 1) {
    const x = margin.left + (plotWidth / 10) * i;
    for (let j = 1; j <= 99; j += 1) {
      const y = margin.top + (plotHeight / 100) * j;
      ctx.moveTo(x, y);
      ctx.arc(x, y, 0.9, 0, Math.PI * 2);
    }
  }
  // 横线（y = 10% ~ 90%）
  for (let j = 1; j <= 9; j += 1) {
    const y = margin.top + (plotHeight / 10) * j;
    for (let i = 1; i <= 99; i += 1) {
      const x = margin.left + (plotWidth / 100) * i;
      ctx.moveTo(x, y);
      ctx.arc(x, y, 0.9, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  minX: number,
  maxX: number,
  scaleX: number,
  panX: number
) {
  ctx.fillStyle = '#9ca3af';
  ctx.font = '11px Inter, ui-sans-serif, system-ui';
  ctx.textAlign = 'center';

  // 根据当前的缩放与平移计算可见时间范围
  const visibleMinX = Math.max(minX, minX - panX / scaleX);
  const visibleMaxX = Math.min(maxX, minX + (plotWidth - panX) / scaleX);
  const visibleSpan = Math.max(0, visibleMaxX - visibleMinX) || 1;

  // X 轴刻度
  for (let i = 0; i <= 10; i += 1) {
    const x = margin.left + (plotWidth / 10) * i;
    const value = visibleMinX + (visibleSpan / 10) * i;
    ctx.fillText(formatAxisValue(value), x, margin.top + plotHeight + 18);
  }

  // X 轴标签
  ctx.fillText('Time (s)', margin.left + plotWidth / 2, margin.top + plotHeight + 38);
  ctx.textAlign = 'left';
}

function dimColor(hex: string, alpha = 0.3): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawChannelWaveform(
  ctx: CanvasRenderingContext2D,
  channel: Channel,
  index: number,
  total: number,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  scaleX: number,
  panX: number,
  minX: number,
  selectedChannelId: string | null,
  horizontalCursorMode: boolean,
  crossCursorMode: boolean
) {
  const bandHeight = plotHeight / total;
  const bandTop = margin.top + bandHeight * index;
  const bandCenterY = bandTop + bandHeight * 0.5;
  const ySpan = channel.maxY - channel.minY || 1;
  const yScale = ((bandHeight * 0.75) / ySpan) * channel.yZoom;
  const yMid = (channel.minY + channel.maxY) / 2;
  const flip = channel.inverted ? -1 : 1;

  // 波形：横向/纵横光标模式下，被选中/激活通道保持原样，其余通道变暗
  const isSelected = channel.id === selectedChannelId;
  ctx.strokeStyle = ((horizontalCursorMode || crossCursorMode) && selectedChannelId !== null && !isSelected)
    ? dimColor(channel.color)
    : channel.color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  let first = true;
  for (const point of channel.points) {
    const x = margin.left + (point.x - minX) * scaleX + panX;
    const y = bandCenterY - (point.y - yMid) * yScale * flip + channel.yOffset;
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function drawChannelLabels(
  ctx: CanvasRenderingContext2D,
  channel: Channel,
  index: number,
  total: number,
  margin: { top: number; right: number; bottom: number; left: number },
  plotHeight: number,
  labelChannelId: string | null,
  singleChannelMode: boolean
) {
  const bandHeight = plotHeight / total;
  const bandTop = margin.top + bandHeight * index;
  const bandCenterY = bandTop + bandHeight * 0.5 + channel.yOffset;
  const ySpan = channel.maxY - channel.minY || 1;
  const yScale = ((bandHeight * 0.75) / ySpan) * channel.yZoom;
  const yMid = (channel.minY + channel.maxY) / 2;
  const flip = channel.inverted ? -1 : 1;

  // 隐藏通道标签变淡
  ctx.globalAlpha = channel.visible ? 1 : 0.35;

  // 单通道模式（Zoom Y / 横向 / 纵横）只显示已选中的通道；
  // 其余情况（初始、重置、Zoom X、纵向光标等）显示所有可见通道
  if (channel.visible && (!singleChannelMode || channel.id === labelChannelId)) {
    const zeroY = bandCenterY + yMid * yScale * flip;
    const hasCustomName = channel.customName.trim().length > 0;
    const chNameYOffset = hasCustomName ? 20 : 12;
    // 单通道模式下标签占整个图形区；多通道模式下每个通道占自己的带状区域
    const labelTop = singleChannelMode ? margin.top : bandTop;
    const labelBottom = singleChannelMode ? margin.top + plotHeight : bandTop + bandHeight;
    // 保持 CH 标签与 0 位标签均有 2px 间隙
    const minZeroY = labelTop + 26 + chNameYOffset;
    const maxZeroY = labelBottom - 26;
    const stackY = clamp(zeroY, minZeroY, maxZeroY);

    ctx.fillStyle = channel.color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';

    // 固定通道名与单位（如 CH1 (V)）
    ctx.font = 'bold 12px Inter, ui-sans-serif, system-ui';
    const nameText = channel.unit ? `${channel.name} (${channel.unit})` : channel.name;
    ctx.fillText(nameText, margin.left - 12, stackY - chNameYOffset);

    // 用户自定义名称（如 Pawl SW）
    if (hasCustomName) {
      ctx.font = '10px Inter, ui-sans-serif, system-ui';
      ctx.fillText(channel.customName, margin.left - 12, stackY - 8);
    }

    // 0 位文字
    ctx.font = '10px Inter, ui-sans-serif, system-ui';
    ctx.fillText('0', margin.left - 12, stackY + 8);

    // 单通道模式下保留 Y 轴顶部 / 底部刻度值（反相时上下互换）
    if (singleChannelMode) {
      const valueTop = yMid + (bandCenterY - labelTop) * flip / yScale;
      const valueBottom = yMid + (bandCenterY - labelBottom) * flip / yScale;
      ctx.font = '10px Inter, ui-sans-serif, system-ui';
      ctx.fillText(formatAxisValue(valueTop), margin.left - 12, labelTop + 10);
      ctx.fillText(formatAxisValue(valueBottom), margin.left - 12, labelBottom - 4);
    }

    // 0 位短参考线（画在 Y 轴左侧，避免被波形覆盖）
    const markerY = clamp(zeroY, labelTop, labelBottom);
    ctx.strokeStyle = channel.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left - 10, markerY);
    ctx.lineTo(margin.left, markerY);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawCursorLine(
  ctx: CanvasRenderingContext2D,
  cursorX: number | null,
  color: string,
  margin: { top: number; right: number; bottom: number; left: number },
  plotHeight: number,
  minX: number,
  scaleX: number,
  panX: number
) {
  if (cursorX === null) return;
  const screenX = margin.left + (cursorX - minX) * scaleX + panX;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(screenX, margin.top);
  ctx.lineTo(screenX, margin.top + plotHeight);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCursorLabel(
  ctx: CanvasRenderingContext2D,
  cursorX: number | null,
  color: string,
  label: string,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  minX: number,
  scaleX: number,
  panX: number
) {
  if (cursorX === null) return;
  const screenX = margin.left + (cursorX - minX) * scaleX + panX;
  if (screenX < margin.left || screenX > margin.left + plotWidth) return;

  ctx.fillStyle = color;
  ctx.font = 'bold 12px Inter, ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, screenX, margin.top - 6);
  ctx.textBaseline = 'alphabetic';
}

function drawHorizontalCursorLine(
  ctx: CanvasRenderingContext2D,
  cursorY: number | null,
  color: string,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  screenY: number | null
) {
  if (cursorY === null || screenY === null) return;
  if (screenY < margin.top || screenY > margin.top + plotHeight) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(margin.left, screenY);
  ctx.lineTo(margin.left + plotWidth, screenY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawHorizontalCursorLabel(
  ctx: CanvasRenderingContext2D,
  cursorY: number | null,
  color: string,
  label: string,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  screenY: number | null
) {
  if (cursorY === null || screenY === null) return;
  if (screenY < margin.top || screenY > margin.top + plotHeight) return;

  ctx.fillStyle = color;
  ctx.font = 'bold 12px Inter, ui-sans-serif, system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, margin.left + plotWidth + 8, screenY);
  ctx.textBaseline = 'alphabetic';
}

function drawHorizontalMeasureAnnotation(
  ctx: CanvasRenderingContext2D,
  dataYC: number | null,
  dataYD: number | null,
  horizontalMeasureLabelX: number,
  channel: Channel | null,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  screenYC: number | null,
  screenYD: number | null
) {
  if (dataYC === null || dataYD === null || channel === null || screenYC === null || screenYD === null) return;
  const labelX = margin.left + horizontalMeasureLabelX * plotWidth;
  const labelY = (screenYC + screenYD) / 2;
  if (labelY < margin.top || labelY > margin.top + plotHeight) return;

  // 两光标之间的竖直虚线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(labelX, clamp(screenYC, margin.top, margin.top + plotHeight));
  ctx.lineTo(labelX, clamp(screenYD, margin.top, margin.top + plotHeight));
  ctx.stroke();
  ctx.setLineDash([]);

  // 虚线右侧的 ΔY 值
  const deltaY = dataYD - dataYC;
  const text = `ΔY: ${formatValue(deltaY, channel.unit)}`;
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '12px Inter, ui-sans-serif, system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, labelX + 6, labelY);
  ctx.textBaseline = 'alphabetic';
}

function getMeasureAnnotationPosition(
  cursorA: number | null,
  cursorB: number | null,
  measureLabelY: number,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  minX: number,
  scaleX: number,
  panX: number
): { labelX: number; labelY: number; screenXA: number; screenXB: number } | null {
  if (cursorA === null || cursorB === null) return null;
  const screenXA = margin.left + (cursorA - minX) * scaleX + panX;
  const screenXB = margin.left + (cursorB - minX) * scaleX + panX;
  const labelX = (screenXA + screenXB) / 2;
  const labelY = margin.top + measureLabelY * plotHeight;
  return { labelX, labelY, screenXA, screenXB };
}

function drawMeasureLine(
  ctx: CanvasRenderingContext2D,
  cursorA: number | null,
  cursorB: number | null,
  measureLabelY: number,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  minX: number,
  scaleX: number,
  panX: number
) {
  const pos = getMeasureAnnotationPosition(cursorA, cursorB, measureLabelY, margin, plotWidth, plotHeight, minX, scaleX, panX);
  if (!pos) return;
  const { labelX: _, labelY, screenXA, screenXB } = pos;
  if ((screenXA < margin.left && screenXB < margin.left) ||
      (screenXA > margin.left + plotWidth && screenXB > margin.left + plotWidth)) {
    return;
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(clamp(screenXA, margin.left, margin.left + plotWidth), labelY);
  ctx.lineTo(clamp(screenXB, margin.left, margin.left + plotWidth), labelY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMeasureLabel(
  ctx: CanvasRenderingContext2D,
  cursorA: number | null,
  cursorB: number | null,
  measureLabelY: number,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  minX: number,
  scaleX: number,
  panX: number
) {
  if (cursorA === null || cursorB === null) return;
  const pos = getMeasureAnnotationPosition(cursorA, cursorB, measureLabelY, margin, plotWidth, plotHeight, minX, scaleX, panX);
  if (!pos) return;
  const { labelX, labelY } = pos;
  if (labelX < margin.left - 80 || labelX > margin.left + plotWidth + 80) return;

  const text = formatDeltaT(cursorB - cursorA);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '12px Inter, ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, labelX, labelY - 5);
  ctx.textBaseline = 'alphabetic';
}

function drawCrossMeasureXLabel(
  ctx: CanvasRenderingContext2D,
  cursorE: number | null,
  cursorG: number | null,
  measureLabelY: number,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  plotHeight: number,
  minX: number,
  scaleX: number,
  panX: number
) {
  if (cursorE === null || cursorG === null) return;
  const pos = getMeasureAnnotationPosition(cursorE, cursorG, measureLabelY, margin, plotWidth, plotHeight, minX, scaleX, panX);
  if (!pos) return;
  const { labelX, labelY } = pos;
  if (labelX < margin.left - 80 || labelX > margin.left + plotWidth + 80) return;

  const text = formatDeltaX(cursorG - cursorE);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '12px Inter, ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, labelX, labelY - 5);
  ctx.textBaseline = 'alphabetic';
}

function formatDeltaX(seconds: number): string {
  if (Math.abs(seconds) >= 1) return `ΔX: ${seconds.toFixed(6)} s`;
  return `ΔX: ${(seconds * 1000).toFixed(3)} ms`;
}

function formatDeltaT(seconds: number): string {
  if (Math.abs(seconds) >= 1) return `ΔT: ${seconds.toFixed(6)} s`;
  return `ΔT: ${(seconds * 1000).toFixed(3)} ms`;
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  data: OscilloscopeData | null,
  visibleChannels: Channel[],
  width: number,
  margin: { top: number; right: number; bottom: number; left: number },
  plotWidth: number,
  minX: number,
  maxX: number,
  zoomX: number,
  testTemp: string,
  testVoltage: string,
  singleChannelMode: boolean,
  overlayChannel: Channel | null,
  total: number,
  filename: string | null
) {
  if (!data) return;

  // 右上角显示当前数据文件名
  if (filename) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px Inter, ui-sans-serif, system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(filename, width - 12, 20);
  }

  // 右上角 X 轴时基：每格时间
  const xSpan = maxX - minX || 1;
  const secondsPerDiv = xSpan / zoomX / 10;
  ctx.fillStyle = '#d1d5db';
  ctx.font = '13px Inter, ui-sans-serif, system-ui';
  ctx.textAlign = 'right';
  ctx.fillText(formatTimebase(secondsPerDiv), margin.left + plotWidth - 8, margin.top + 16);

  // 左上角显示温度和电压信息；两者均为空时不显示
  const tempText = testTemp.trim();
  const voltageText = testVoltage.trim();
  if (tempText || voltageText) {
    const parts: string[] = [];
    if (tempText) parts.push(`温度：${tempText}°C`);
    if (voltageText) parts.push(`电压：${voltageText}V`);
    ctx.textAlign = 'left';
    ctx.fillText(parts.join('  '), 12, 20);
  }

  // Zoom Y / 横向 / 纵横测量模式下，在坐标区域左上角显示当前选中通道的 Y 轴每格电压
  if (singleChannelMode && overlayChannel) {
    const ySpan = overlayChannel.maxY - overlayChannel.minY || 1;
    // 单通道模式下左侧 Y 轴刻度按整个绘图区高度（10 格）显示，因此 V/div 需乘上通道总数
    const voltsPerDiv = (total * ySpan) / (overlayChannel.yZoom * 7.5);
    ctx.textAlign = 'left';
    ctx.fillStyle = overlayChannel.color;
    ctx.fillText(
      formatVoltagePerDiv(voltsPerDiv, overlayChannel.unit || 'V'),
      margin.left + 8,
      margin.top + 16
    );
  }

  ctx.textAlign = 'left';
}

function formatAxisValue(value: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  if (value === 0) return '0';
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.001)) {
    return value.toExponential(3);
  }
  return value.toFixed(3);
}

function formatTimebase(secondsPerDiv: number): string {
  if (!Number.isFinite(secondsPerDiv) || secondsPerDiv <= 0) return '[0s/div]';
  if (secondsPerDiv >= 1) return `[${secondsPerDiv.toFixed(3)}s/div]`;
  if (secondsPerDiv >= 1e-3) return `[${(secondsPerDiv * 1e3).toFixed(3)}ms/div]`;
  if (secondsPerDiv >= 1e-6) return `[${(secondsPerDiv * 1e6).toFixed(3)}μs/div]`;
  return `[${(secondsPerDiv * 1e9).toFixed(3)}ns/div]`;
}

function formatVoltagePerDiv(voltsPerDiv: number, unit: string): string {
  if (!Number.isFinite(voltsPerDiv) || voltsPerDiv <= 0) return `[0${unit}/div]`;
  const abs = Math.abs(voltsPerDiv);
  if (abs >= 1) return `[${abs.toFixed(3)}${unit}/div]`;
  if (abs >= 1e-3) return `[${(abs * 1e3).toFixed(3)}m${unit}/div]`;
  if (abs >= 1e-6) return `[${(abs * 1e6).toFixed(3)}μ${unit}/div]`;
  return `[${(abs * 1e9).toFixed(3)}n${unit}/div]`;
}

/** 将任意时基值吸附到标准序列（1,2,3,...,9 × 10^n）上 */
function snapTimebase(secondsPerDiv: number): number {
  if (secondsPerDiv <= 0) return 1e-6;
  const exponent = Math.floor(Math.log10(secondsPerDiv));
  const decade = Math.pow(10, exponent);
  const k = Math.max(1, Math.min(9, Math.round(secondsPerDiv / decade)));
  return k * decade;
}

/** 按 10% 递减/递增序列返回下一个时基值
 * 例如 1s → 900ms → 800ms → ... → 100ms → 90ms → ... → 1us
 * direction: 'up' 表示放大（更小的 s/div），'down' 表示缩小（更大的 s/div）
 */
function getFineTimebase(secondsPerDiv: number, direction: 'up' | 'down'): number {
  const minTimebase = 1e-6;
  if (secondsPerDiv <= minTimebase && direction === 'up') return minTimebase;

  const snapped = snapTimebase(secondsPerDiv);
  const exponent = Math.floor(Math.log10(snapped));
  const decade = Math.pow(10, exponent);
  const k = Math.round(snapped / decade);

  if (direction === 'up') {
    if (k > 1) {
      return (k - 1) * decade;
    }
    const lowerDecade = decade / 10;
    if (lowerDecade < minTimebase) return minTimebase;
    return 9 * lowerDecade;
  }
  if (k < 9) {
    return (k + 1) * decade;
  }
  return decade * 10;
}

export default App;
