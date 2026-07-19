import { describe, expect, it } from 'vitest';
import {
  clamp,
  dimColor,
  formatAxisValue,
  formatDeltaT,
  formatDeltaX,
  formatFrequency,
  formatTimeAxisValue,
  formatTimebase,
  formatValue,
  formatVoltagePerDiv,
} from './format';

describe('clamp', () => {
  it('returns value when inside range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns min when below range', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('returns max when above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('dimColor', () => {
  it('returns rgba with default alpha', () => {
    expect(dimColor('#ff0000')).toBe('rgba(255, 0, 0, 0.3)');
  });

  it('returns rgba with custom alpha', () => {
    expect(dimColor('#00ff00', 0.8)).toBe('rgba(0, 255, 0, 0.8)');
  });
});

describe('formatValue', () => {
  it('returns -- for null', () => {
    expect(formatValue(null, 'V')).toBe('--');
  });

  it('formats normal value with unit', () => {
    expect(formatValue(1.2345, 'V')).toBe('1.2345 V');
  });

  it('uses exponential for large values', () => {
    expect(formatValue(12345, 'V')).toBe('1.2345e+4 V');
  });

  it('uses exponential for tiny non-zero values', () => {
    expect(formatValue(0.0001, 'V')).toBe('1.0000e-4 V');
  });
});

describe('formatAxisValue', () => {
  it('returns NaN for non-finite', () => {
    expect(formatAxisValue(NaN)).toBe('NaN');
  });

  it('returns 0 for zero', () => {
    expect(formatAxisValue(0)).toBe('0');
  });

  it('formats normal value', () => {
    expect(formatAxisValue(1.2346)).toBe('1.235');
  });

  it('uses exponential for large values', () => {
    expect(formatAxisValue(12345)).toBe('1.235e+4');
  });
});

describe('formatTimebase', () => {
  it('returns zero for invalid input', () => {
    expect(formatTimebase(0)).toBe('[0s/div]');
    expect(formatTimebase(NaN)).toBe('[0s/div]');
  });

  it('formats seconds', () => {
    expect(formatTimebase(2)).toBe('[2.000s/div]');
  });

  it('formats milliseconds', () => {
    expect(formatTimebase(0.1)).toBe('[100.000ms/div]');
  });

  it('formats microseconds', () => {
    expect(formatTimebase(0.0001)).toBe('[100.000μs/div]');
  });

  it('formats nanoseconds', () => {
    expect(formatTimebase(1e-9)).toBe('[1.000ns/div]');
  });
});

describe('formatVoltagePerDiv', () => {
  it('returns zero for invalid input', () => {
    expect(formatVoltagePerDiv(0, 'V')).toBe('[0V/div]');
  });

  it('formats volts with 3 decimals', () => {
    expect(formatVoltagePerDiv(1.234, 'V')).toBe('[1.234V/div]');
    expect(formatVoltagePerDiv(1.6, 'V')).toBe('[1.600V/div]');
  });

  it('formats millivolts with 3 decimals', () => {
    expect(formatVoltagePerDiv(0.1234, 'V')).toBe('[123.400mV/div]');
  });

  it('formats microvolts with 3 decimals', () => {
    expect(formatVoltagePerDiv(0.0001234, 'V')).toBe('[123.400μV/div]');
  });

  it('formats nanovolts with 3 decimals', () => {
    expect(formatVoltagePerDiv(1.6e-10, 'V')).toBe('[0.160nV/div]');
  });

  it('shows 0.200nV/div without rounding up to 1', () => {
    expect(formatVoltagePerDiv(0.2e-9, 'V')).toBe('[0.200nV/div]');
  });
});

describe('formatDeltaX', () => {
  it('formats seconds', () => {
    expect(formatDeltaX(2)).toBe('ΔX: 2.000000 s');
  });

  it('formats milliseconds', () => {
    expect(formatDeltaX(0.1)).toBe('ΔX: 100.000 ms');
  });

  it('formats microseconds', () => {
    expect(formatDeltaX(0.0001)).toBe('ΔX: 100.000 μs');
  });

  it('preserves negative sign', () => {
    expect(formatDeltaX(-0.0001)).toBe('ΔX: -100.000 μs');
  });
});

describe('formatDeltaT', () => {
  it('formats milliseconds', () => {
    expect(formatDeltaT(0.001)).toBe('ΔT: 1.000 ms');
  });
});

describe('formatTimeAxisValue', () => {
  it('returns NaN for non-finite', () => {
    expect(formatTimeAxisValue(NaN, 0.1)).toBe('NaN');
  });

  it('returns 0 for zero', () => {
    expect(formatTimeAxisValue(0, 0.1)).toBe('0');
  });

  it('formats seconds when timebase > 100ms', () => {
    expect(formatTimeAxisValue(1.5, 0.2)).toBe('1.500');
  });

  it('formats milliseconds when timebase <= 100ms', () => {
    expect(formatTimeAxisValue(0.05, 0.1)).toBe('50.000');
  });

  it('formats microseconds when timebase < 1ms', () => {
    expect(formatTimeAxisValue(0.0005, 0.0005)).toBe('500.000');
  });
});

describe('formatFrequency', () => {
  it('returns 0 Hz for invalid input', () => {
    expect(formatFrequency(0)).toBe('0 Hz');
    expect(formatFrequency(NaN)).toBe('0 Hz');
  });

  it('formats Hz', () => {
    expect(formatFrequency(50)).toBe('50.000 Hz');
  });

  it('formats kHz', () => {
    expect(formatFrequency(1500)).toBe('1.500 kHz');
  });

  it('formats MHz', () => {
    expect(formatFrequency(1.5e6)).toBe('1.500 MHz');
  });

  it('formats GHz', () => {
    expect(formatFrequency(1.5e9)).toBe('1.500 GHz');
  });
});
