// Copyright (c) ETH Zurich and the cats-viz authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../scss/cats-viz.scss';
import {
    AccessTimelineRenderer,
} from './renderer/access_timeline/access_timeline_renderer';
import { AccessSubset } from './utils/display';
import { readOrDecompress } from './utils/data_loading';


export interface MemoryTimelineScope {
    label: string;
    scope: string;
    children: MemoryTimelineScope[];
    start_time: number;
    end_time: number;
}

export interface MemoryEvent {
    type: 'DataAccessEvent' | 'AllocationEvent' | 'DeallocationEvent';
}

export interface DataAccessEvent extends MemoryEvent {
    type: 'DataAccessEvent';
    alloc_name: string;
    data: string;
    container_sdfg: number;
    sdfg: number;
    block?: string;
    anode?: string;
    edge?: string;
    subset: AccessSubset;
    mode: 'write' | 'read';
    conditional: boolean;
}

export interface AllocationEvent extends MemoryEvent {
    type: 'AllocationEvent';
    data: [string, number][];
    sdfg: number;
    scope: string;
    conditional: boolean;
}

export interface DeallocationEvent extends MemoryEvent {
    type: 'DeallocationEvent';
    data: string[];
    sdfg: number;
    scope: string;
    conditional: boolean;
}

export type InputOutputMap = Record<('inout' | 'in' | 'out'),
    (string | { type: 'regex', expr: string })[]>;

export class AccessTimelineView {

    private readonly renderer: AccessTimelineRenderer;

    public constructor() {
        const timelineContainer = $('.access-timeline');

        $(document).on(
            'change.cats-viz', '#inputs-file-input',
            this.loadInputsOutputsFile.bind(this)
        );
        $(document).on(
            'change.cats-viz', '#trace-file-input',
            this.loadTrace.bind(this)
        );

        const container = timelineContainer.find('#contents');
        this.renderer = new AccessTimelineRenderer(container);

        $('#save-access-timeline-as-pdf-btn').on(
            'click', () => {
                this.renderer.saveAsPDF('timeline.pdf', true);
            }
        );
        $('#save-access-timeline-view-as-pdf-btn').on(
            'click', () => {
                this.renderer.saveAsPDF('timeline.pdf', false);
            }
        );
    }

    public loadInputsOutputsFile(changeEvent: JQuery.TriggeredEvent): void {
        const target = changeEvent.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1)
            return;
        const file = target?.files?.[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                const packedResult = readOrDecompress(result);
                this.renderer.inputOutputDefinitions = JSON.parse(
                    packedResult[0]
                ) as InputOutputMap;
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    public loadTrace(changeEvent: JQuery.TriggeredEvent): void {
        const target = changeEvent.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1)
            return;
        const file = target?.files?.[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                const packedResult = readOrDecompress(result);
                const data = JSON.parse(
                    packedResult[0]
                ) as Record<string, unknown>;
                const trace = data.events as MemoryEvent[] | undefined;
                const scopes = data.scopes as MemoryTimelineScope[] | undefined;
                if (trace && scopes)
                    this.renderer.setTimeline(trace, scopes);
                else
                    console.error('Failed to load trace');
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

}

$(() => {
    new AccessTimelineView();
});
