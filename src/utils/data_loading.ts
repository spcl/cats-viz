// Copyright (c) ETH Zurich and the cats-viz authors. All rights reserved.

import { gunzipSync } from 'zlib';
import { Buffer } from 'buffer';


/**
 * Read or decompress a JSON string, or a compressed JSON string.
 * @param json JSON string, as a string or compressed in an ArrayBuffer.
 * @returns    Tuple containing the parsed JSON, and a boolean indicating
 *             whether the original string was compressed or not.
 */
export function readOrDecompress(
    json: string | ArrayBuffer | Uint8Array
): [string, boolean] {
    try {
        return [
            new TextDecoder().decode(
                gunzipSync(Buffer.from(json as Uint8Array))
            ),
            true,
        ];
    } catch {
        if (typeof json !== 'string') {
            const enc = new TextDecoder('utf-8');
            return [enc.decode(json), false];
        }
        return [json, false];
    }
}
