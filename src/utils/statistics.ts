// Copyright (c) ETH Zurich and the cats-viz authors. All rights reserved.

export function median(values: number[]): number {
    if (values.length === 0)
        throw new Error('Input array is empty');

    // Sorting values, preventing original array from being mutated.
    values = [...values].sort((a, b) => a - b);
    const half = Math.floor(values.length / 2);
    return (
        values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2
    );
}
