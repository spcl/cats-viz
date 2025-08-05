// Copyright (c) ETH Zurich and the cats-viz authors. All rights reserved.

import {
    HTMLCanvasRenderable,
} from 'rendure/src/renderer/core/html_canvas/html_canvas_renderable';
import {
    AllocationEvent,
    CATSAccessEvent,
    CATSAllocationEvent,
    CATSDeallocationEvent,
    CATSEvent,
    CATSScopeEntryEvent,
    CATSScopeExitEvent,
    DataAccessEvent,
    DeallocationEvent,
    InputOutputMap,
    MemoryEvent,
    MemoryTimelineScope,
} from '../../access_timeline_view';
import { AccessTimelineRenderer } from './access_timeline_renderer';
import {
    ptLineDistance,
} from 'rendure/src/renderer/core/common/renderer_utils';
import { KELLY_COLORS } from 'rendure/src/utils/colors';
import type { Point2D } from 'rendure/src/types';
import {
    AccessSubset,
    accessSubsetToString,
    bytesToString,
} from '../../utils/display';
import { median } from '../../utils/statistics';


export type TimelineViewElementClasses = 'container' | 'access' | 'axes';

export abstract class TimelineViewElement extends HTMLCanvasRenderable {

    protected _guid: string = '';
    protected _type: string = 'TimelineViewElement';

    public constructor(
        renderer: AccessTimelineRenderer,
        ctx: CanvasRenderingContext2D,
        minimapCtx?: CanvasRenderingContext2D
    ) {
        super(renderer, ctx, minimapCtx, 0, undefined);
    }

    public get guid(): string {
        return this._guid;
    }

    public get type(): string {
        return this._type;
    }

    public get label(): string {
        return this.type;
    }

    public get renderer(): AccessTimelineRenderer {
        return this._renderer as AccessTimelineRenderer;
    }

    public shade(_color: string, _alpha: number): void {
        return;
    }

    public drawSummaryInfo(
        _mousePos?: Point2D, _overrideTooFarForText?: boolean
    ): void {
        return;
    }

    public minimapDraw(): void {
        return;
    }

}


function isInputOutput(
    dataName: string, caseSensitive: boolean = false,
    inputOutputDefinitions?: InputOutputMap
): [boolean, boolean] {
    let isInput = false;
    let isOutput = false;
    if (inputOutputDefinitions) {
        const parts = dataName.split('->');
        const rootData = caseSensitive ? parts[0] : parts[0].toLowerCase();
        const inout = inputOutputDefinitions.inout;
        for (const elem of inout) {
            if (typeof elem === 'string') {
                const testString = caseSensitive ? elem : elem.toLowerCase();
                if (rootData === testString)
                    return [true, true];
            } else {
                const regex = new RegExp(elem.expr);
                if (regex.test(rootData))
                    return [true, true];
            }
        }

        const inputs = inputOutputDefinitions.in;
        for (const elem of inputs) {
            if (typeof elem === 'string') {
                const testString = caseSensitive ? elem : elem.toLowerCase();
                if (rootData === testString) {
                    isInput = true;
                    break;
                }
            } else {
                const regex = new RegExp(elem.expr);
                if (regex.test(rootData)) {
                    isInput = true;
                    break;
                }
            }
        }

        const outputs = inputOutputDefinitions.out;
        for (const elem of outputs) {
            if (typeof elem === 'string') {
                const testString = caseSensitive ? elem : elem.toLowerCase();
                if (rootData === testString) {
                    isOutput = true;
                    break;
                }
            } else {
                const regex = new RegExp(elem.expr);
                if (regex.test(rootData)) {
                    isOutput = true;
                    break;
                }
            }
        }
    }
    return [isInput, isOutput];
}

type DrawCall = (mousepos?: Point2D) => void;


function parseTrace(
    timeline: CATSEvent[], renderer: AccessTimelineRenderer
): TimelineChart {
    let nEvents = 0;
    let maxFootprint = 0;

    let currentFootprint = 0;
    let inOutSize = 0;
    let inSize = 0;
    let outSize = 0;
    const containerMap = new Map();
    const scopesMap = new Map<string, ScopeElement>();
    const inOutMap = new Map<string, [boolean, boolean]>();
    for (const event of timeline) {
        if (event.type === 'access') {
            nEvents++;
        } else if (event.type === 'allocation') {
            const alloc = event as CATSAllocationEvent;
            containerMap.set(alloc.buffer_name, alloc.size);
            let parsedAlloc: number = 0;
            if (typeof alloc.size === 'string') {
                try {
                    parsedAlloc = +alloc.size;
                } catch (_ignored) {
                    console.warn('Failed to parse allocation size', alloc.size);
                }
            } else {
                parsedAlloc = alloc.size;
            }
            currentFootprint += parsedAlloc;
            const cleanName = alloc.buffer_name.replace(
                /^(\d*___state->__)?\d+_/g, ''
            );
            const [isInput, isOutput] = isInputOutput(
                cleanName, false, renderer.inputOutputDefinitions
            );
            inOutMap.set(cleanName, [isInput, isOutput]);
            if (isInput && isOutput)
                inOutSize += parsedAlloc;
            else if (isInput)
                inSize += parsedAlloc;
            else if (isOutput)
                outSize += parsedAlloc;
            if (currentFootprint > maxFootprint)
                maxFootprint = currentFootprint;
        } else if (event.type === 'deallocation') {
            const dealloc = event as CATSDeallocationEvent;
            currentFootprint -= containerMap.get(dealloc.buffer_name);
            containerMap.delete(dealloc.buffer_name);
        }
    }

    const maxHeight = 10000;
    let targetHeight = maxFootprint;
    const targetWidth = 10000;
    if (targetHeight > maxHeight)
        targetHeight = maxHeight;
    const scaleY = targetHeight / maxFootprint;
    const scaleX = targetWidth / nEvents;

    const xAxis = new ChartAxis(
        renderer, renderer.ctx, 'horizontal', 0, nEvents, scaleX
    );
    const yAxis = new ChartAxis(
        renderer, renderer.ctx, 'vertical', 0, maxFootprint, scaleY
    );

    const containers = [];
    const readAccesses = [];
    const writeAccesses = [];
    const scopes = [];

    const allocationBoundingPolygon: Point2D[] = [];

    let time = 0;
    let inStackTop = 0;
    let inOutStackTop = inStackTop - (inSize * scaleY);
    let outStackTop = inOutStackTop - (inOutSize * scaleY);
    let stackTop = outStackTop - (outSize * scaleY);
    const elemMap = new Map<string, AllocatedContainer>();
    let colorIdx = 0;
    const maxColorIdx = KELLY_COLORS.length;
    let nCond = 0;
    let scopeStackDepth = 0;
    for (const event of timeline) {
        if (event.type === 'allocation') {
            const alloc = event as CATSAllocationEvent;

            let dataName = alloc.buffer_name;
            dataName = dataName.replace(/^(\d*___state->__)?\d+_/g, '');
            const [isInput, isOutput] = inOutMap.get(dataName) ?? [
                false,
                false,
            ];
            let parsedAlloc: number = 0;
            if (typeof alloc.size === 'string') {
                try {
                    parsedAlloc = +alloc.size;
                } catch (_ignored) {
                    console.warn('Failed to parse allocation size', alloc.size);
                }
            } else {
                parsedAlloc = alloc.size;
            }
            const allocatedElem = new AllocatedContainer(
                renderer, renderer.ctx,
                '#' + KELLY_COLORS[colorIdx].toString(16),
                nCond > 0, dataName, parsedAlloc, undefined, isInput, isOutput
            );
            allocatedElem.allocatedAt = time;
            containers.push(allocatedElem);
            allocatedElem.height = parsedAlloc * scaleY;
            allocatedElem.x = time * scaleX;
            if (isInput && isOutput) {
                inOutStackTop -= allocatedElem.height;
                allocatedElem.y = inOutStackTop;
            } else if (isInput) {
                inStackTop -= allocatedElem.height;
                allocatedElem.y = inStackTop;
            } else if (isOutput) {
                outStackTop -= allocatedElem.height;
                allocatedElem.y = outStackTop;
            } else {
                stackTop -= allocatedElem.height;
                allocatedElem.y = stackTop;
            }
            elemMap.set(alloc.buffer_name, allocatedElem);

            allocationBoundingPolygon.push({
                x: allocatedElem.x,
                y: allocatedElem.y + allocatedElem.height,
            });
            allocationBoundingPolygon.push({
                x: allocatedElem.x,
                y: allocatedElem.y,
            });

            colorIdx++;
            if (colorIdx >= maxColorIdx)
                colorIdx = 0;
        } else if (event.type === 'deallocation') {
            const dealloc = event as CATSDeallocationEvent;
            if (!elemMap.has(dealloc.buffer_name)) {
                console.warn(
                    'Deallocating not allocated data', dealloc.buffer_name
                );
                continue;
            }
            const allocatedElem = elemMap.get(dealloc.buffer_name)!;
            allocatedElem.width = (time * scaleX) - allocatedElem.x;
            allocatedElem.deallocatedAt = time;
            if (allocatedElem.isInput && allocatedElem.isOutput)
                inOutStackTop += allocatedElem.height;
            else if (allocatedElem.isInput)
                inStackTop += allocatedElem.height;
            else if (allocatedElem.isOutput)
                outStackTop += allocatedElem.height;
            else
                stackTop += allocatedElem.height;

            allocationBoundingPolygon.push({
                x: allocatedElem.x + allocatedElem.width,
                y: allocatedElem.y,
            });
            allocationBoundingPolygon.push({
                x: allocatedElem.x + allocatedElem.width,
                y: allocatedElem.y + allocatedElem.height,
            });

            elemMap.delete(dealloc.buffer_name);
        } else if (event.type === 'access') {
            const accessEvent = event as CATSAccessEvent;
            const allocatedElem = elemMap.get(accessEvent.buffer_name)!;
            const accessElem = new ContainerAccess(
                renderer, renderer.ctx,
                accessEvent.mode === 'r' ? 'read' : 'write',
                accessEvent.offset?.toString() ?? '', time, scaleX,
                allocatedElem, nCond > 0
            );
            if (accessEvent.mode === 'r')
                readAccesses.push(accessElem);
            else
                writeAccesses.push(accessElem);
            time++;
        } else if (event.type === 'scope_entry') {
            const entry = event as CATSScopeEntryEvent;

            let label = '';
            if (entry.scope_type === 'loop') {
                label = 'Loop';
                label += ` ${entry.id.toString()}`;
            } else if (entry.scope_type === 'func') {
                label = 'Function';
                label += ` ${entry.funcname}`;
            } else if (entry.scope_type === 'parallel') {
                label = 'Parallel';
                label += ` ${entry.id.toString()}`;
            } else {
                label = 'Conditional';
                label += ` ${entry.id.toString()}`;
                nCond++;
            }

            const scope = new ScopeElement(
                renderer, renderer.ctx, label, scopeStackDepth, time,
                undefined, scaleX
            );
            scopeStackDepth++;

            scopesMap.set(entry.id.toString(), scope);
        } else { // event.type === scope_exit
            const exit = event as CATSScopeExitEvent;
            const scope = scopesMap.get(exit.id.toString());
            if (!scope) {
                console.warn('Scope exit without matching entry', exit);
                continue;
            }
            if (scope.label.startsWith('Conditional'))
                nCond--;
            scopeStackDepth--;
            if (scopeStackDepth < 0)
                scopeStackDepth = 0;
            scope.setEnd(time, scaleX);
            if (scope.start !== time)
                scopes.push(scope);
            scopesMap.delete(exit.id.toString());
        }
    }

    for (const remainingScope of scopesMap.values()) {
        remainingScope.setEnd(time, scaleX);
        if (remainingScope.start !== time)
            scopes.push(remainingScope);
    }

    if (elemMap.size > 0) {
        let finalFootprint = 0;
        for (const [_, elem] of elemMap)
            finalFootprint += elem.height;

        for (const leftOverContainers of elemMap.keys()) {
            const allocElem = elemMap.get(leftOverContainers)!;
            allocElem.width = (time * scaleX) - allocElem.x;
            allocElem.deallocatedAt = time;
        }
        allocationBoundingPolygon.push({
            x: time * scaleX,
            y: finalFootprint,
        });
        allocationBoundingPolygon.push({
            x: time * scaleX,
            y: 0,
        });
    }

    // Smooth out the allocation bounding polygon.
    // For any three points p1, p2, and p3 that all lie on the same
    // x-coordinate, we remove p2.
    let cleanedAllocationBoundingPolygon: Point2D[] = [];
    if (allocationBoundingPolygon.length >= 3) {
        const allocPolygon: Point2D[] = [allocationBoundingPolygon[0]];
        for (let i = 1; i < allocationBoundingPolygon.length - 1; i++) {
            const p1 = allocationBoundingPolygon[i - 1];
            const p2 = allocationBoundingPolygon[i];
            const p3 = allocationBoundingPolygon[i + 1];
            if (p1.x === p2.x && p2.x === p3.x)
                continue;
            allocPolygon.push({
                x: p2.x,
                y: p2.y,
            });
        }
        const lastPoint = allocationBoundingPolygon[
            allocationBoundingPolygon.length - 1
        ];
        allocPolygon.push({
            x: lastPoint.x,
            y: lastPoint.y,
        });
        cleanedAllocationBoundingPolygon = allocPolygon;
    }
    return new TimelineChart(
        xAxis, yAxis, nEvents, maxFootprint,
        containers, readAccesses, writeAccesses,
        scopes, scaleX, scaleY,
        cleanedAllocationBoundingPolygon,
        renderer
    );
}


function collectScopes(
    renderer: AccessTimelineRenderer, scope: MemoryTimelineScope,
    depth: number, scaleX: number
): ScopeElement[] {
    const elements = [
        new ScopeElement(
            renderer, renderer.ctx,
            scope.label, depth, scope.start_time, scope.end_time, scaleX
        ),
    ];
    for (const child of scope.children) {
        for (const nElem of collectScopes(renderer, child, depth + 1, scaleX))
            elements.push(nElem);
    }
    return elements;
}

function parseTraceLegacy(
    timeline: MemoryEvent[], rootScope: MemoryTimelineScope,
    renderer: AccessTimelineRenderer
): TimelineChart {
    let nEvents = 0;
    let maxFootprint = 0;

    let currentFootprint = 0;
    let inOutSize = 0;
    let inSize = 0;
    let outSize = 0;
    const containerMap = new Map();
    const inOutMap = new Map<string, [boolean, boolean]>();
    for (const event of timeline) {
        if (event.type === 'DataAccessEvent') {
            nEvents++;
        } else if (event.type === 'AllocationEvent') {
            for (const data of (event as AllocationEvent).data) {
                containerMap.set(data[0], data[1]);
                currentFootprint += data[1];
                const cleanName = data[0].replace(
                    /^(\d*___state->__)?\d+_/g, ''
                );
                const [isInput, isOutput] = isInputOutput(
                    cleanName, false, renderer.inputOutputDefinitions
                );
                inOutMap.set(cleanName, [isInput, isOutput]);
                if (isInput && isOutput)
                    inOutSize += data[1];
                else if (isInput)
                    inSize += data[1];
                else if (isOutput)
                    outSize += data[1];
            }
            if (currentFootprint > maxFootprint)
                maxFootprint = currentFootprint;
        } else {
            for (const data of (event as DeallocationEvent).data) {
                currentFootprint -= containerMap.get(data);
                containerMap.delete(data);
            }
        }
    }

    const maxHeight = 10000;
    let targetHeight = maxFootprint;
    const targetWidth = 10000;
    if (targetHeight > maxHeight)
        targetHeight = maxHeight;
    const scaleY = targetHeight / maxFootprint;
    const scaleX = targetWidth / nEvents;

    const xAxis = new ChartAxis(
        renderer, renderer.ctx, 'horizontal', 0, nEvents, scaleX
    );
    const yAxis = new ChartAxis(
        renderer, renderer.ctx, 'vertical', 0, maxFootprint, scaleY
    );

    const containers = [];
    const readAccesses = [];
    const writeAccesses = [];

    const allocationBoundingPolygon: Point2D[] = [];

    let time = 0;
    let inStackTop = 0;
    let inOutStackTop = inStackTop - (inSize * scaleY);
    let outStackTop = inOutStackTop - (inOutSize * scaleY);
    let stackTop = outStackTop - (outSize * scaleY);
    const elemMap = new Map<string, AllocatedContainer>();
    let colorIdx = 0;
    const maxColorIdx = KELLY_COLORS.length;
    for (const event of timeline) {
        if (event.type === 'AllocationEvent') {
            for (const data of (event as AllocationEvent).data) {
                let dataName = data[0];
                dataName = dataName.replace(/^(\d*___state->__)?\d+_/g, '');
                const [isInput, isOutput] = inOutMap.get(dataName) ?? [
                    false,
                    false,
                ];
                const allocatedElem = new AllocatedContainer(
                    renderer, renderer.ctx,
                    '#' + KELLY_COLORS[colorIdx].toString(16),
                    (event as AllocationEvent).conditional,
                    dataName, data[1], undefined, isInput, isOutput
                );
                allocatedElem.allocatedAt = time;
                containers.push(allocatedElem);
                allocatedElem.height = data[1] * scaleY;
                allocatedElem.x = time * scaleX;
                if (isInput && isOutput) {
                    inOutStackTop -= allocatedElem.height;
                    allocatedElem.y = inOutStackTop;
                } else if (isInput) {
                    inStackTop -= allocatedElem.height;
                    allocatedElem.y = inStackTop;
                } else if (isOutput) {
                    outStackTop -= allocatedElem.height;
                    allocatedElem.y = outStackTop;
                } else {
                    stackTop -= allocatedElem.height;
                    allocatedElem.y = stackTop;
                }
                elemMap.set(data[0], allocatedElem);

                allocationBoundingPolygon.push({
                    x: allocatedElem.x,
                    y: allocatedElem.y + allocatedElem.height,
                });
                allocationBoundingPolygon.push({
                    x: allocatedElem.x,
                    y: allocatedElem.y,
                });

                colorIdx++;
                if (colorIdx >= maxColorIdx)
                    colorIdx = 0;
            }
        } else if (event.type === 'DeallocationEvent') {
            for (const data of (event as DeallocationEvent).data) {
                if (!elemMap.has(data)) {
                    console.warn('Deallocating not allocated data', data);
                    continue;
                }
                const allocatedElem = elemMap.get(data)!;
                allocatedElem.width = (time * scaleX) - allocatedElem.x;
                allocatedElem.deallocatedAt = time;
                if (allocatedElem.isInput && allocatedElem.isOutput)
                    inOutStackTop += allocatedElem.height;
                else if (allocatedElem.isInput)
                    inStackTop += allocatedElem.height;
                else if (allocatedElem.isOutput)
                    outStackTop += allocatedElem.height;
                else
                    stackTop += allocatedElem.height;

                allocationBoundingPolygon.push({
                    x: allocatedElem.x + allocatedElem.width,
                    y: allocatedElem.y,
                });
                allocationBoundingPolygon.push({
                    x: allocatedElem.x + allocatedElem.width,
                    y: allocatedElem.y + allocatedElem.height,
                });

                elemMap.delete(data);
            }
        } else {
            const accessEvent = event as DataAccessEvent;
            const allocatedElem = elemMap.get(accessEvent.alloc_name)!;
            const accessElem = new ContainerAccess(
                renderer, renderer.ctx,
                accessEvent.mode, accessEvent.subset, time, scaleX,
                allocatedElem, accessEvent.conditional
            );
            if (accessEvent.mode === 'read')
                readAccesses.push(accessElem);
            else
                writeAccesses.push(accessElem);
            time++;
        }
    }

    if (elemMap.size > 0) {
        let finalFootprint = 0;
        for (const [_, elem] of elemMap)
            finalFootprint += elem.height;

        for (const leftOverContainers of elemMap.keys()) {
            const allocElem = elemMap.get(leftOverContainers)!;
            allocElem.width = (time * scaleX) - allocElem.x;
            allocElem.deallocatedAt = time;
        }
        allocationBoundingPolygon.push({
            x: time * scaleX,
            y: finalFootprint,
        });
        allocationBoundingPolygon.push({
            x: time * scaleX,
            y: 0,
        });
    }

    const scopes = collectScopes(renderer, rootScope, 0, scaleX);

    // Smooth out the allocation bounding polygon.
    // For any three points p1, p2, and p3 that all lie on the same
    // x-coordinate, we remove p2.
    let cleanedAllocationBoundingPolygon: Point2D[] = [];
    if (allocationBoundingPolygon.length >= 3) {
        const allocPolygon: Point2D[] = [allocationBoundingPolygon[0]];
        for (let i = 1; i < allocationBoundingPolygon.length - 1; i++) {
            const p1 = allocationBoundingPolygon[i - 1];
            const p2 = allocationBoundingPolygon[i];
            const p3 = allocationBoundingPolygon[i + 1];
            if (p1.x === p2.x && p2.x === p3.x)
                continue;
            allocPolygon.push({
                x: p2.x,
                y: p2.y,
            });
        }
        const lastPoint = allocationBoundingPolygon[
            allocationBoundingPolygon.length - 1
        ];
        allocPolygon.push({
            x: lastPoint.x,
            y: lastPoint.y,
        });
        cleanedAllocationBoundingPolygon = allocPolygon;
    }

    return new TimelineChart(
        xAxis, yAxis, nEvents, maxFootprint,
        containers, readAccesses, writeAccesses,
        scopes, scaleX, scaleY,
        cleanedAllocationBoundingPolygon,
        renderer
    );
}


export class TimelineChart extends TimelineViewElement {

    private medianReuse: number = Infinity;
    private medianRatio: number = 0.0;

    public readonly deferredDrawCalls = new Set<DrawCall>();

    protected _type: string = 'TimelineChart';


    public constructor(
        public readonly xAxis: ChartAxis,
        public readonly yAxis: ChartAxis,

        public readonly nEvents: number,
        public readonly maxFootprint: number,

        public readonly containers: AllocatedContainer[],
        public readonly readAccesses: ContainerAccess[],
        public readonly writeAccesses: ContainerAccess[],
        public readonly scopes: ScopeElement[],

        public readonly scaleX: number,
        public readonly scaleY: number,

        protected readonly _allocBoundingPolygon: Point2D[],

        renderer: AccessTimelineRenderer
    ) {
        super(renderer, renderer.ctx, renderer.minimapCtx);
        this.height = this.yAxis.height;
        this.width = this.xAxis.width;
        this.x = 0;
        this.y = 0 - this.height;
        let maxY = 0;
        for (const scope of this.scopes) {
            const scopeMaxY = scope.y + scope.height;
            if (scopeMaxY > maxY)
                maxY = scopeMaxY;
        }
        this.height = maxY - this.y;
        this.calculateMetrics();

        for (const container of this.containers)
            container.chart = this;
    }

    static fromTrace(
        timeline: CATSEvent[], renderer: AccessTimelineRenderer
    ): TimelineChart {
        return parseTrace(timeline, renderer);
    }

    static fromLegacyTrace(
        timeline: MemoryEvent[], rootScope: MemoryTimelineScope,
        renderer: AccessTimelineRenderer
    ): TimelineChart {
        return parseTraceLegacy(timeline, rootScope, renderer);
    }

    public topleft(): Point2D {
        return { x: this.xAxis.x, y: this.y };
    }

    public setTemporaryContext(ctx: CanvasRenderingContext2D): void {
        super.setTemporaryContext(ctx);
        this.xAxis.setTemporaryContext(ctx);
        this.yAxis.setTemporaryContext(ctx);
        for (const container of this.containers)
            container.setTemporaryContext(ctx);
        for (const access of this.readAccesses)
            access.setTemporaryContext(ctx);
        for (const access of this.writeAccesses)
            access.setTemporaryContext(ctx);
        for (const scope of this.scopes)
            scope.setTemporaryContext(ctx);
    }

    public restoreContext(): void {
        super.restoreContext();
        this.xAxis.restoreContext();
        this.yAxis.restoreContext();
        for (const container of this.containers)
            container.restoreContext();
        for (const access of this.readAccesses)
            access.restoreContext();
        for (const access of this.writeAccesses)
            access.restoreContext();
        for (const scope of this.scopes)
            scope.restoreContext();
    }

    private calculateMetrics(): void {
        const allReuse = [];
        const allRatios = [];
        for (const container of this.containers) {
            const res = container.calculateReuse();
            allRatios.push(res[0]);
            allReuse.push(res[1]);
        }
        this.medianRatio = median(allRatios);
        this.medianReuse = median(allReuse);
    }

    public drawDeferred(mousepos?: Point2D): void {
        for (const deferredCall of this.deferredDrawCalls)
            deferredCall(mousepos);
        this.deferredDrawCalls.clear();
    }

    public get axes(): ChartAxis[] {
        return [this.xAxis, this.yAxis];
    }

    public minimapDraw(): void {
        if (this.minimapCxt) {
            this.minimapCxt.fillStyle = 'gray';
            this.minimapCxt.beginPath();
            this.minimapCxt.moveTo(
                this._allocBoundingPolygon[0].x,
                this._allocBoundingPolygon[0].y
            );
            for (const point of this._allocBoundingPolygon)
                this.minimapCxt.lineTo(point.x, point.y);
            this.minimapCxt.closePath();
            this.minimapCxt.fill();

            this.xAxis.minimapDraw();
            this.yAxis.minimapDraw();
        }
    }

    protected _internalDraw(mousepos?: Point2D): void {
        for (const elem of this.containers)
            elem.draw(mousepos);

        // Batch access drawing.
        const deferredEdges = [];
        this.ctx.beginPath();
        this.ctx.setLineDash([1, 1]);
        for (const access of this.readAccesses) {
            if (access.hovered) {
                deferredEdges.push(access);
                continue;
            }
            this.ctx.moveTo(access.x, access.y);
            this.ctx.lineTo(access.x, access.y + access.height);
        }
        this.ctx.strokeStyle = 'blue';
        this.ctx.fillStyle = 'blue';
        this.ctx.stroke();

        this.ctx.beginPath();
        if ('pdf' in this.ctx && this.ctx.pdf)
            this.ctx.setLineDash([1, 0]);
        else
            this.ctx.setLineDash([]);
        for (const access of this.writeAccesses) {
            if (access.hovered) {
                deferredEdges.push(access);
                continue;
            }
            this.ctx.moveTo(access.x, access.y);
            this.ctx.lineTo(access.x, access.y + access.height);
        }
        this.ctx.strokeStyle = 'black';
        this.ctx.fillStyle = 'black';
        this.ctx.stroke();

        for (const deferred of deferredEdges)
            deferred.draw(mousepos);

        this.drawDeferred(mousepos);

        this.xAxis.draw(mousepos);
        this.yAxis.draw(mousepos);

        for (const scope of this.scopes)
            scope.draw(mousepos);

        this.ctx.fillStyle = 'black';
        this.ctx.globalAlpha = 1.0;
        this.ctx.fillText(
            'Median reuse: ' + this.medianReuse.toString(),
            this.x + this.xAxis.width + 50, this.y
        );
        this.ctx.fillText(
            'Median use / allocation ratio: ' + this.medianRatio.toString(),
            this.x + this.xAxis.width + 50, this.y + 20
        );
    }

}

export class ChartAxis extends TimelineViewElement {

    protected _type: string = 'ChartAxis';

    public constructor(
        renderer: AccessTimelineRenderer,
        ctx: CanvasRenderingContext2D,
        public readonly direction: 'vertical' | 'horizontal',
        public readonly min: number = 0,
        public readonly max: number = 100,
        public readonly tickSpacing: number = 1
    ) {
        super(renderer, ctx);

        const delta = this.max - this.min;
        const deltaPxs = delta * this.tickSpacing;
        this.x = 0;
        this.y = 0;
        if (this.direction === 'vertical') {
            this.width = 1;
            this.height = deltaPxs;
        } else {
            this.width = deltaPxs;
            this.height = 1;
        }
    }


    public get label(): string {
        return 'Chart axis (' + this.direction + ')';
    }

    protected drawArrow(
        ctx: CanvasRenderingContext2D, p1: Point2D, p2: Point2D, size: number,
        offset: number = 0, padding: number = 0
    ): void {
        // Rotate the context to point along the path
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const rot = Math.atan2(dy, dx);
        ctx.translate(p2.x, p2.y);
        ctx.rotate(rot);

        // arrowhead
        ctx.beginPath();
        ctx.moveTo(0 + padding + offset, 0);
        ctx.lineTo(((-2 * size) - padding) - offset, -(size + padding));
        ctx.lineTo(((-2 * size) - padding) - offset, (size + padding));
        ctx.closePath();
        ctx.fill();

        // Restore context
        ctx.rotate(-rot);
        ctx.translate(-p2.x, -p2.y);
    }

    public topleft(): Point2D {
        if (this.direction === 'vertical')
            return { x: this.x, y: this.y - this.height };
        else
            return { x: this.x, y: this.y };
    }

    protected _internalDraw(_mousepos?: Point2D): void {
        this.ctx.beginPath();
        if ('pdf' in this.ctx && this.ctx.pdf)
            this.ctx.setLineDash([1, 0]);
        else
            this.ctx.setLineDash([]);
        this.ctx.moveTo(this.x, this.y);
        if (this.direction === 'vertical') {
            this.ctx.lineTo(this.x, -this.height);
            this.ctx.strokeStyle = 'black';
            this.ctx.fillStyle = 'black';
            this.ctx.stroke();
            this.drawArrow(
                this.ctx, { x: this.x, y: this.y },
                { x: this.x, y: -this.height }, 3
            );
        } else {
            this.ctx.lineTo(this.width, this.y);
            this.ctx.strokeStyle = 'black';
            this.ctx.fillStyle = 'black';
            this.ctx.stroke();
            this.drawArrow(
                this.ctx, { x: this.x, y: this.y },
                { x: this.width, y: this.y }, 3
            );
        }
    }

}

export class ContainerAccess extends TimelineViewElement {

    protected _type: string = 'ContainerAccess';

    public constructor(
        renderer: AccessTimelineRenderer,
        ctx: CanvasRenderingContext2D,
        public readonly mode: 'read' | 'write',
        public readonly subset: AccessSubset | string,
        public readonly timestep: number,
        public readonly scaleX: number,
        public readonly container: AllocatedContainer,
        public readonly conditional: boolean
    ) {
        super(renderer, ctx);

        this.x = timestep * scaleX;
        this.width = 1 * scaleX;
        this.y = container.y;
        this.height = container.height;

        this.container.registerAccess(this);
    }

    public get label(): string {
        if (typeof this.subset === 'string')
            return this.subset;
        return accessSubsetToString(this.subset);
    }

    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        // First, check bounding box
        if (!super.intersect(x, y, w, h))
            return false;

        // Then (if point), check distance from line
        if (w === 0 || h === 0) {
            const dist = ptLineDistance(
                { x: x, y: y }, { x: this.x, y: this.y },
                { x: this.x, y: this.y + this.height }
            );
            if (dist <= 2 * this.scaleX)
                return true;
            return false;
        } else {
            // It is a rectangle. Check if any of the rectangles, spanned by
            // pairs of points of the line, intersect the input rectangle.
            // This is needed for long Interstate edges that have a huge
            // bounding box and intersect almost always with the viewport even
            // if they are not visible. This is only an approximation to detect
            // if a line is in the viewport and could be made more accurate at
            // the cost of more computation.
            const origin = { x: this.x, y: this.y };
            const destination = { x: this.x, y: this.y + this.height };
            // Rectangle spanned by the two line points
            const r = {
                x: Math.min(origin.x, destination.x),
                y: Math.min(origin.y, destination.y),
                w: Math.abs(destination.x - origin.x),
                h: Math.abs(destination.y - origin.y),
            };

            // Check if the two rectangles intersect
            if (r.x + r.w >= x && r.x <= x + w &&
                r.y + r.h >= y && r.y <= y + h)
                return true;
            return false;
        }
    }

    protected _internalDraw(_mousepos?: Point2D): void {
        if (this.mode === 'read') {
            this.ctx.beginPath();
            this.ctx.setLineDash([1, 1]);
            this.ctx.moveTo(this.x, this.y);
            this.ctx.lineTo(this.x, this.y + this.height);
            this.ctx.strokeStyle = this.hovered ? 'red' : 'blue';
            this.ctx.fillStyle = 'blue';
            this.ctx.stroke();
        } else {
            this.ctx.beginPath();
            if ('pdf' in this.ctx && this.ctx.pdf)
                this.ctx.setLineDash([1, 0]);
            else
                this.ctx.setLineDash([]);
            this.ctx.moveTo(this.x, this.y);
            this.ctx.lineTo(this.x, this.y + this.height);
            this.ctx.strokeStyle = this.hovered ? 'red' : 'black';
            this.ctx.fillStyle = 'black';
            this.ctx.stroke();
        }

        if (this.hovered)
            this.renderer.showTooltipAtMouse(this.label);
    }

}

export class AllocatedContainer extends TimelineViewElement {

    public allocatedAt: number = 0;
    public deallocatedAt: number = 0;

    private allocationTimespan: number = 0;
    private totalUseTimespan: number = 0;
    private reuseDistances: number[] = [];
    private tooltipText: string;

    public readonly accesses: ContainerAccess[] = [];

    private firstUseX?: number;
    private lastUseX?: number;

    protected _type: string = 'AllocatedContainer';

    private _chart?: TimelineChart;

    public constructor(
        renderer: AccessTimelineRenderer,
        ctx: CanvasRenderingContext2D,
        private readonly color: string,
        private readonly conditional: boolean,
        private readonly dataName: string,
        private readonly dataBytes: number,
        private readonly dataShape: string | undefined,
        public readonly isInput: boolean,
        public readonly isOutput: boolean
    ) {
        super(renderer, ctx);

        this.tooltipText = this.label;
        if (this.dataShape)
            this.tooltipText += '\n' + this.dataShape;
        if (this.isInput && this.isOutput)
            this.tooltipText += '\nProgram Input & Output';
        else if (this.isInput)
            this.tooltipText += '\nProgram Input';
        else if (this.isOutput)
            this.tooltipText += '\nProgram Output';
    }

    public set chart(chart: TimelineChart | undefined) {
        this._chart = chart;
    }

    public topleft(): Point2D {
        return { x: this.x, y: this.y };
    }

    public get label(): string {
        return this.dataName + ' (' + bytesToString(this.dataBytes) + ')';
    }

    public registerAccess(access: ContainerAccess): void {
        this.accesses.push(access);
        if (this.firstUseX === undefined || access.x < this.firstUseX)
            this.firstUseX = access.x;
        if (this.lastUseX === undefined || access.x > this.lastUseX)
            this.lastUseX = access.x;
    }

    private createStripedPattern(
        lineWidth: number, spacing: number, slope: number, color: string
    ) {
        const can = document.createElement('canvas');
        const len = Math.hypot(1, slope);

        const w = can.width = 1 / len + spacing + 0.5 | 0;
        const h = can.height = slope / len + spacing * slope + 0.5 | 0;

        const ctx = can.getContext('2d')!;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();

        // Line through top left and bottom right corners
        ctx.moveTo(0, 0);
        ctx.lineTo(w, h);
        // Line through top right corner to add missing pixels
        ctx.moveTo(0, -h);
        ctx.lineTo(w * 2, h);
        // Line through bottom left corner to add missing pixels
        ctx.moveTo(-w, 0);
        ctx.lineTo(w, h * 2);

        ctx.stroke();
        return ctx.createPattern(can, 'repeat');
    };

    protected _internalDraw(_mousepos?: Point2D): void {
        if (this.conditional) {
            this.ctx.fillStyle = this.createStripedPattern(
                8, 16, 1, this.color
            )!;
        } else {
            this.ctx.fillStyle = this.color;
        }

        let solidStartX = this.x;
        let solidEndX = this.x + this.width;
        if (!this.isInput && this.firstUseX !== undefined) {
            this.ctx.globalAlpha = 0.3;
            this.ctx.fillRect(
                this.x, this.y, this.firstUseX - this.x, this.height
            );
            solidStartX = this.firstUseX;
        }
        if (!this.isOutput && this.lastUseX !== undefined) {
            this.ctx.globalAlpha = 0.3;
            this.ctx.fillRect(
                this.lastUseX, this.y,
                (this.x + this.width) - this.lastUseX, this.height
            );
            solidEndX = this.lastUseX;
        }
        if (!this.isOutput && !this.isInput && this.lastUseX === undefined &&
            this.firstUseX === undefined
        )
            this.ctx.globalAlpha = 0.3;
        else
            this.ctx.globalAlpha = 1.0;
        this.ctx.fillRect(
            solidStartX, this.y, solidEndX - solidStartX, this.height
        );

        if (this.hovered) {
            this.renderer.showTooltipAtMouse(this.tooltipText);
            this._chart?.deferredDrawCalls.add((_dMousepos) => {
                this.ctx.strokeStyle = 'black';
                this.ctx.strokeRect(this.x, this.y, this.width, this.height);
            });
        }
    }

    public calculateReuse(): [number, number] {
        let lastAccessAt = undefined;
        let firstAccessAt = undefined;
        for (const access of this.accesses) {
            firstAccessAt ??= access.timestep;
            if (lastAccessAt !== undefined)
                this.reuseDistances.push(access.timestep - lastAccessAt);
            lastAccessAt = access.timestep;
        }

        this.allocationTimespan = this.deallocatedAt - this.allocatedAt;
        if (firstAccessAt === undefined || lastAccessAt === undefined)
            this.totalUseTimespan = 0;
        else
            this.totalUseTimespan = lastAccessAt - firstAccessAt;

        const ratio = (this.totalUseTimespan / this.allocationTimespan) * 100;
        this.tooltipText += (
            '\nUse / Allocation time ratio: ' + ratio.toString() + '%'
        );
        if (this.reuseDistances.length) {
            const meanReuse = this.reuseDistances.reduce(
                (a, b) => a + b
            ) / this.reuseDistances.length;
            this.tooltipText += (
                '\nMean reuse distance: ' + meanReuse.toString()
            );
            return [ratio, meanReuse];
        } else {
            this.tooltipText += '\nNo reuse!';
            return [ratio, Infinity];
        }
    }

}

export class ScopeElement extends TimelineViewElement {

    protected _type: string = 'ScopeElement';

    public constructor(
        renderer: AccessTimelineRenderer,
        ctx: CanvasRenderingContext2D,
        private readonly _label: string,
        depth: number, public readonly start: number, end: number | undefined,
        scaleX: number
    ) {
        super(renderer, ctx);

        this.height = 100;
        this.y = (depth + 1) * this.height;
        this.x = start * scaleX;
        if (end !== undefined)
            this.setEnd(end, scaleX);
    }

    public setEnd(end: number, scaleX: number): void {
        this.width = (end * scaleX) - this.x;
    }

    public topleft(): Point2D {
        return { x: this.x, y: this.y };
    }

    public get label(): string {
        return this._label;
    }

    protected _internalDraw(_mousepos?: Point2D): void {
        if (this.label.startsWith('Loop'))
            this.ctx.fillStyle = 'red';
        else if (this.label.startsWith('Conditional'))
            this.ctx.fillStyle = 'blue';
        else if (this.label.startsWith('Parallel'))
            this.ctx.fillStyle = 'green';
        else
            this.ctx.fillStyle = 'gray';
        this.ctx.fillRect(this.x, this.y, this.width, this.height);

        if (this.hovered)
            this.renderer.showTooltipAtMouse(this.label);
    }

}
