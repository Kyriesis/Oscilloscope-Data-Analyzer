"""
CSV 自动测量脚本：Pawl SW 下降沿 -> Cin Motor 堵转开始

用法：
    python analyze_csv.py RigolDS08019.csv
    python analyze_csv.py RigolDS08019.csv --pawl-sw 2 --cin-motor 1 --threshold-ratio 0.2

输出：
    Pawl SW 下降沿时间、Cin Motor 堵转开始时间、ΔT（ms）
"""

import csv
import sys
import math
import argparse
from pathlib import Path


def parse_rigol_csv(path: str) -> tuple[float, float, list[str], list[list[float]]]:
    """
    解析 Rigol CSV 格式：
    表头：CH1A,CH2V,CH3V,CH4V,t0 =-6.500000e+00, tInc = 8.000000e-06,
    后续行：每列对应通道值，末尾两列空
    """
    with open(path, newline='', encoding='utf-8') as f:
        lines = f.readlines()

    header = lines[0].strip()
    # 提取 t0 和 tInc
    t0 = None
    t_inc = None
    for token in header.split(','):
        token = token.strip()
        if token.lower().startswith('t0'):
            t0 = float(token.split('=')[1].strip())
        elif token.lower().startswith('tinc'):
            t_inc = float(token.split('=')[1].strip())
    if t0 is None or t_inc is None:
        raise ValueError("CSV 表头缺少 t0 或 tInc")

    # 通道名来自前几个非空列
    channel_names = [n.strip() for n in header.split(',')[:4]]

    data = []
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split(',')
        # 只取前 4 列数值
        values = [float(p.strip()) for p in parts[:4]]
        data.append(values)

    return t0, t_inc, channel_names, data


def detect_falling_edge(values: list[float], threshold: float = 1.5) -> int:
    """
    检测数字通道从高电平到低电平的下降沿。
    若存在多个，返回最后一个（通常是最接近事件窗口的跳变）。
    """
    edges = []
    for i in range(1, len(values)):
        if values[i - 1] > threshold and values[i] <= threshold:
            edges.append(i)
    if not edges:
        raise ValueError(f"未找到下降沿（阈值 {threshold}）")
    return edges[-1]


def moving_average(values: list[float], index: int, window_samples: int) -> float:
    """以 index 为中心，对 values 做滑动平均。"""
    half = window_samples // 2
    total = 0.0
    count = 0
    for j in range(index - half, index + half + 1):
        if 0 <= j < len(values):
            total += values[j]
            count += 1
    return total / count if count > 0 else 0.0


def detect_stall_start(
    values: list[float],
    fall_index: int,
    t_inc: float,
    baseline_window_ms: float = 100.0,
    search_window_ms: float = 300.0,
    smooth_window_ms: float = 2.0,
    threshold_ratio: float = 0.2,
) -> int:
    """
    检测 Cin Motor 从自由电流进入堵转电流的过渡点。

    算法：
    1. 取 fall_index 前 baseline_window_ms 的均值作为基线 I_base。
    2. 在 fall_index 后 search_window_ms 内找最小值 I_stall（堵转电流）。
    3. 动态阈值 = I_base + threshold_ratio * (I_stall - I_base)。
    4. 从 fall_index 向后扫描，找电流首次低于该阈值的位置。

    返回 stall_start 的索引。
    """
    baseline_samples = max(1, int(round(baseline_window_ms / 1000.0 / t_inc)))
    search_samples = max(1, int(round(search_window_ms / 1000.0 / t_inc)))
    smooth_samples = max(1, int(round(smooth_window_ms / 1000.0 / t_inc)))
    if smooth_samples % 2 == 0:
        smooth_samples += 1  # 确保奇数，中心对称

    # 基线：跳变前
    start = max(0, fall_index - baseline_samples)
    baseline = sum(values[start:fall_index]) / (fall_index - start)

    # 堵转电流：跳变后窗口内的最小值
    end = min(len(values), fall_index + search_samples)
    stall_min = float('inf')
    stall_min_idx = fall_index
    for i in range(fall_index, end):
        s = moving_average(values, i, smooth_samples)
        if s < stall_min:
            stall_min = s
            stall_min_idx = i

    if stall_min == float('inf'):
        raise ValueError("未找到堵转电流最小值")

    # 动态阈值
    threshold = baseline + threshold_ratio * (stall_min - baseline)

    # 首次低于阈值（从跳变后扫描到最小值点）
    for i in range(fall_index, stall_min_idx + 1):
        s = moving_average(values, i, smooth_samples)
        if s <= threshold:
            return i

    return stall_min_idx


def analyze_file(
    path: str,
    pawl_sw_channel: int = 2,
    cin_motor_channel: int = 1,
    threshold: float = 1.5,
    threshold_ratio: float = 0.2,
) -> dict:
    """分析单个 CSV 文件，返回测量结果。"""
    t0, t_inc, channel_names, data = parse_rigol_csv(path)

    # 提取通道数据（转换为 0 基索引）
    ch_idx = pawl_sw_channel - 1
    motor_idx = cin_motor_channel - 1
    ch2 = [row[ch_idx] for row in data]
    ch1 = [row[motor_idx] for row in data]

    fall_index = detect_falling_edge(ch2, threshold=threshold)
    stall_index = detect_stall_start(
        ch1, fall_index, t_inc, threshold_ratio=threshold_ratio
    )

    fall_time = t0 + fall_index * t_inc
    stall_time = t0 + stall_index * t_inc
    delta_t_ms = (stall_time - fall_time) * 1000.0

    return {
        "file": Path(path).name,
        "channel_names": channel_names,
        "pawl_sw_channel": pawl_sw_channel,
        "cin_motor_channel": cin_motor_channel,
        "fall_index": fall_index,
        "fall_time": fall_time,
        "stall_index": stall_index,
        "stall_time": stall_time,
        "delta_t_ms": delta_t_ms,
    }


def main():
    parser = argparse.ArgumentParser(
        description="自动测量 Pawl SW 下降沿到 Cin Motor 堵转开始的时间"
    )
    parser.add_argument("csv", help="输入 CSV 文件路径")
    parser.add_argument(
        "--pawl-sw", type=int, default=2, help="Pawl SW 所在通道编号（1-4），默认 2"
    )
    parser.add_argument(
        "--cin-motor", type=int, default=1, help="Cin Motor 所在通道编号（1-4），默认 1"
    )
    parser.add_argument(
        "--threshold", type=float, default=1.5, help="Pawl SW 高/低判断阈值（V），默认 1.5"
    )
    parser.add_argument(
        "--threshold-ratio",
        type=float,
        default=0.2,
        help="堵转电流动态阈值比例（0-1），默认 0.2",
    )
    args = parser.parse_args()

    result = analyze_file(
        args.csv,
        pawl_sw_channel=args.pawl_sw,
        cin_motor_channel=args.cin_motor,
        threshold=args.threshold,
        threshold_ratio=args.threshold_ratio,
    )

    print(f"文件: {result['file']}")
    print(f"通道: {result['channel_names']}")
    print(f"Pawl SW 下降沿时间: {result['fall_time']:.6f} s")
    print(f"Cin Motor 堵转开始时间: {result['stall_time']:.6f} s")
    print(f"ΔT: {result['delta_t_ms']:.3f} ms")


if __name__ == "__main__":
    main()
