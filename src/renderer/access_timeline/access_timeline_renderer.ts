// Copyright (c) ETH Zurich and the cats-viz authors. All rights reserved.

import {
    HTMLCanvasRenderer,
} from 'rendure/src/renderer/core/html_canvas/html_canvas_renderer';
import {
    CATSEvent,
    InputOutputMap,
    MemoryEvent,
    MemoryTimelineScope,
} from '../../access_timeline_view';
import {
    AllocatedContainer,
    ContainerAccess,
    TimelineChart,
    TimelineViewElement,
    TimelineViewElementClasses,
} from './access_timeline_elements';
import type { SimpleRect } from 'rendure/src/types';
import { RendererUI } from 'rendure/src/renderer/core/common/renderer_ui';


export class AccessTimelineRenderer extends HTMLCanvasRenderer {

    public inputOutputDefinitions?: InputOutputMap;

    private chart?: TimelineChart;

    private hoveredElement?: TimelineViewElement;

    public constructor(
        container: JQuery,
        extMouseHandler: (
            (...args: any[]) => boolean
        ) | null = null,
        initialUserTransform: DOMMatrix | null = null,
        backgroundColor: string | null = null
    ) {
        super(
            container,
            extMouseHandler,
            initialUserTransform,
            backgroundColor
        );

        this.canvas.id = 'timeline-canvas';

        const ui = new RendererUI(this.container, this, {
            minimap: true,
            zoomToFit: true,
            zoomToFitWidth: true,
            zoomBtns: true,
        });
        this.initUI(ui);
    }

    public setTimelineFromLegacyTrace(
        timeline: MemoryEvent[], scopes: MemoryTimelineScope[]
    ): void {
        this.chart = TimelineChart.fromLegacyTrace(timeline, scopes[0], this);
        this.zoomToFitContents();
        this.drawAsync();
    }

    public setTimeline(timeline: CATSEvent[]): void {
        this.chart = TimelineChart.fromTrace(timeline, this);
        this.zoomToFitContents();
        this.drawAsync();
    }

    public internalDraw(dt?: number, ctx?: CanvasRenderingContext2D): void {
        this.chart?.draw(this.mousePos);
    }

    protected setTemporaryContext(ctx: CanvasRenderingContext2D): void {
        this.chart?.setTemporaryContext(ctx);
    }

    protected restoreContext(): void {
        this.chart?.restoreContext();
    }

    public doForIntersectedElements(
        x: number, y: number, w: number, h: number,
        func: (el: TimelineViewElement, cat: TimelineViewElementClasses) => any
    ): void {
        if (!this.chart?.intersect(x, y, w, h))
            return;

        for (const ax of this.chart.axes) {
            if (ax.intersect(x, y, w, h))
                func(ax, 'axes');
        }

        for (const cont of this.chart.containers) {
            if (cont.intersect(x, y, w, h)) {
                func(cont, 'container');
                for (const access of cont.accesses) {
                    if (access.intersect(x, y, w, h))
                        func(access, 'access');
                }
            }
        }

        for (const scope of this.chart.scopes) {
            if (scope.intersect(x, y, w, h))
                func(scope, 'axes');
        }
    }

    public elementsInRect(
        x: number, y: number, w: number, h: number
    ): Set<TimelineViewElement> {
        const elements = new Set<TimelineViewElement>();
        this.doForIntersectedElements(x, y, w, h, (elem, _cat) => {
            elements.add(elem);
        });
        return elements;
    }

    private findElementsUnderCursor(mouseX: number, mouseY: number): {
        elements: Set<TimelineViewElement>,
        foregroundElement?: TimelineViewElement,
    } {
        // Find all elements under the cursor.
        const elements = this.elementsInRect(mouseX, mouseY, 0, 0);
        let foregroundElement = undefined;
        // The foreground element is always an access, if one exists. If not,
        // it will be an allocation, and if no such item exists, it will be a
        // meta element, such as chart axes.
        for (const elem of elements) {
            if (elem instanceof ContainerAccess)
                foregroundElement = elem;
        }
        if (!foregroundElement) {
            for (const elem of elements) {
                if (elem instanceof AllocatedContainer)
                    foregroundElement = elem;
            }
        }
        foregroundElement ??= elements.values().next().value;

        return { elements, foregroundElement };
    }

    protected _drawMinimapContents(): void {
        this.chart?.minimapDraw();
    }

    protected onMouseMove(event: MouseEvent): boolean {
        if (!this.chart)
            return true;

        // Calculate the change in mouse position in canvas coordinates
        this.mousePos = this.getMouseEventRealCoords(event);
        this.realMousePos = { x: event.clientX, y: event.clientY };
        const mouseElements = this.findElementsUnderCursor(
            this.mousePos.x, this.mousePos.y
        );

        // Only accept the primary mouse button as dragging source
        if (this.dragStart && this.dragStart instanceof MouseEvent &&
            event.buttons & 1) {
            this.dragging = true;

            // Mouse move in panning mode
            this.panOnMouseMove(event);
            return true;
        } else if (this.dragStart && event.buttons & 4) {
            // Pan the view with the middle mouse button.
            this.dragging = true;
            this.panOnMouseMove(event);
            return true;
        } else {
            this.dragStart = undefined;
            if (event.buttons & 1 || event.buttons & 4)
                return true; // Don't stop propagation

            this.clearHovered();
            if (mouseElements.foregroundElement)
                this.hoverRenderable(mouseElements.foregroundElement);
            else
                this.hideTooltip();

            this.drawAsync();

            return false;
        }
    }

    public getContentsBoundingBox(): SimpleRect {
        if (this.chart) {
            return {
                x: this.chart.x,
                y: this.chart.y,
                w: this.chart.width,
                h: this.chart.height,
            };
        } else {
            return {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
            };
        }
    }

    protected initUI(ui?: RendererUI): void {
        this._ui = ui ?? new RendererUI(this.container, this);
    }

}
