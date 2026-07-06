/** 示波器风格通道配色 */
export const CHANNEL_COLORS: Record<string, string> = {
  CH1: '#ffcc00', // 黄
  CH2: '#00ff66', // 绿
  CH3: '#00ffff', // 青
  CH4: '#ff66ff', // 品红
  CH5: '#ff8800', // 橙
  CH6: '#4488ff', // 蓝
  CH7: '#66ccff', // 浅蓝
  CH8: '#ff5555', // 红
};

const FALLBACK_COLORS = [
  '#ffcc00',
  '#00ff66',
  '#00ffff',
  '#ff66ff',
  '#ff8800',
  '#4488ff',
  '#66ccff',
  '#ff5555',
];

export function getChannelColor(id: string, index: number): string {
  const normalized = id.trim().toUpperCase();
  if (CHANNEL_COLORS[normalized]) return CHANNEL_COLORS[normalized];
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}
