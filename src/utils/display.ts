// Copyright (c) ETH Zurich and the cats-viz authors. All rights reserved.

interface TileableRange {
    start: string | number;
    end: string | number;
    step: string | number;
    tile: string | number;
}

export interface AccessSubset {
    ranges?: TileableRange[];
}

interface AccessSubsetUnion extends AccessSubset {
    subsetList?: AccessSubset[];
}

export function accessSubsetToString(
    subset: AccessSubset | AccessSubsetUnion
): string {
    let subsets = [subset];
    if ('subsetList' in subset && subset.subsetList)
        subsets = subset.subsetList;

    let result = subsets.length > 1 ? '{' : '';
    for (let i = 0; i < subsets.length; i++) {
        const subs = subsets[i];
        if (!subs.ranges)
            continue;
        if (i > 0)
            result += ', ';
        result += '[';
        for (let j = 0; j < subs.ranges.length; j++) {
            const range = subs.ranges[j];
            if (j > 0)
                result += ', ';
            const start = typeof range.start === 'string' ?
                parseInt(range.start) : range.start;
            const end = typeof range.end === 'string' ?
                parseInt(range.end) : range.end;
            const step = typeof range.step === 'string' ?
                parseInt(range.step) : range.step;
            const tile = typeof range.tile === 'string' ?
                parseInt(range.tile) : range.tile;
            if (start === end && step === 1 && tile === 1) {
                result += start.toString();
            } else {
                result += `${start.toString()}:${end.toString()}`;
                if (step !== 1) {
                    result += `:${step.toString()}`;
                    if (tile !== 1)
                        result += `:${tile.toString()}`;
                } else if (tile !== 1) {
                    result += `::${tile.toString()}`;
                }
            }
        }
        result += ']';
    }
    result += subsets.length > 1 ? '}' : '';
    return result;
}

/**
 * Format bytes as human-readable text.
 * Taken from https://stackoverflow.com/a/14919494
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 *
 * @return Formatted string.
 */
export function bytesToString(
    bytes: number, si: boolean = false, dp: number = 1
) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh)
        return bytes.toString() + ' B';

    const units = si ?
        ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] :
        ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10**dp;

    do {
        bytes /= thresh;
        ++u;
    } while (
        Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1
    );

    return bytes.toFixed(dp) + ' ' + units[u];
}
