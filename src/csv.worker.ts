import { parseCsv } from './csv';
import type { OscilloscopeData } from './types';

self.onmessage = (event: MessageEvent<{ text: string; filename?: string }>) => {
  try {
    const { text } = event.data;
    const data = parseCsv(text);
    self.postMessage({ type: 'success', data } as { type: 'success'; data: OscilloscopeData });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'CSV 解析失败',
    } as { type: 'error'; message: string });
  }
};

export {};
