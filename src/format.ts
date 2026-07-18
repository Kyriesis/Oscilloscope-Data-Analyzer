export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function dimColor(hex: string, alpha = 0.3): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function formatValue(value: number | null, unit: string): string {
  if (value === null) return '--';
  const prefix = unit ? ` ${unit}` : '';
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.001 && value !== 0)) {
    return `${value.toExponential(4)}${prefix}`;
  }
  return `${value.toFixed(4)}${prefix}`;
}

export function formatAxisValue(value: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  if (value === 0) return '0';
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.001)) {
    return value.toExponential(3);
  }
  return value.toFixed(3);
}

export function formatTimebase(secondsPerDiv: number): string {
  if (!Number.isFinite(secondsPerDiv) || secondsPerDiv <= 0) return '[0s/div]';
  if (secondsPerDiv >= 1) return `[${secondsPerDiv.toFixed(3)}s/div]`;
  if (secondsPerDiv >= 1e-3) return `[${(secondsPerDiv * 1e3).toFixed(3)}ms/div]`;
  if (secondsPerDiv >= 1e-6) return `[${(secondsPerDiv * 1e6).toFixed(3)}μs/div]`;
  return `[${(secondsPerDiv * 1e9).toFixed(3)}ns/div]`;
}

export function formatVoltagePerDiv(voltsPerDiv: number, unit: string): string {
  if (!Number.isFinite(voltsPerDiv) || voltsPerDiv <= 0) return `[0${unit}/div]`;
  const abs = Math.abs(voltsPerDiv);
  if (abs >= 1) {
    const rounded = Math.round(abs);
    return `[${(rounded || 1).toFixed(0)}${unit}/div]`;
  }
  if (abs >= 1e-3) {
    const rounded = Math.round(abs * 1e3);
    return `[${(rounded || 1).toFixed(0)}m${unit}/div]`;
  }
  if (abs >= 1e-6) {
    const rounded = Math.round(abs * 1e6);
    return `[${(rounded || 1).toFixed(0)}μ${unit}/div]`;
  }
  const rounded = Math.round(abs * 1e9);
  return `[${(rounded || 1).toFixed(0)}n${unit}/div]`;
}

export function formatDeltaX(seconds: number): string {
  if (Math.abs(seconds) >= 1) return `ΔX: ${seconds.toFixed(6)} s`;
  if (Math.abs(seconds) >= 1e-3) return `ΔX: ${(seconds * 1000).toFixed(3)} ms`;
  return `ΔX: ${(seconds * 1e6).toFixed(3)} μs`;
}

export function formatDeltaT(seconds: number): string {
  if (Math.abs(seconds) >= 1) return `ΔT: ${seconds.toFixed(6)} s`;
  if (Math.abs(seconds) >= 1e-3) return `ΔT: ${(seconds * 1000).toFixed(3)} ms`;
  return `ΔT: ${(seconds * 1e6).toFixed(3)} μs`;
}

export function formatTimeAxisValue(value: number, timebase: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  if (value === 0) return '0';
  if (timebase < 1e-3) return (value * 1e6).toFixed(3);
  if (timebase <= 0.1) return (value * 1000).toFixed(3);
  return formatAxisValue(value);
}

export function formatFrequency(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '0 Hz';
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`;
  return `${hz.toFixed(3)} Hz`;
}
