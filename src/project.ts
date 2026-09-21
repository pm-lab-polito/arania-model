// PROJECT

import {ProjectSharedState, WorkSharedState} from "./project.shared-state";
import {TaskCPM} from "./computeCpm";
import {Calendar} from "./calendar";

export type ProjectError = {
    message: string;
    severity: "error" | "warning";
    workId?: string;    // set when the error concerns a specific row
}

export type Project = {
    works: Work[];

    calendarStartDate: Date;    // Invalid Date with a "linear" calendar
    calendarDuration: number;   // calendar days (weekends included): extent of the Gantt
    duration: number;           // working days

    _errors: ProjectError[];
    _base: ProjectSharedState;
    _calendar: Calendar;        // working days ⇄ calendar rules (Gantt, report)
}

// WORKS

type _BaseWork = {
    id: string;
    name: string;

    /* implementation-specific intermediate fields */
    _wbs: string;
    _cpmTask: TaskCPM
    _base: WorkSharedState
    _index: number;
    _error?: string;    // scheduling error on the single work (also in Project._errors)
    _warning?: string;  // non-blocking warning on the single work (also in Project._errors, severity "warning")

    _linearStart: number;
    _linearEnd: number;
    _linearDuration: number;

    _calendarStart: number;
    _calendarEnd: number;
    _calendarDuration: number;
}

export type RootSummary = _BaseWork & {
    kind: "rootSummary";
    children: (Summary | AutoTask | ManualTask)[];
}

export type Summary = _BaseWork & {
    kind: "summary";
    parent: Summary | RootSummary;
    children: (Summary | AutoTask | ManualTask)[];
    successors: (AutoTask | ManualTask)[];
}

type _BaseTask = {
    parent: Summary | RootSummary;
    predecessors: (AutoTask | ManualTask | Summary)[];
    successors: (AutoTask | ManualTask)[];
    checkpoints: Checkpoint[];
    _isMilestone: boolean;
}

export type AutoTask = _BaseWork & _BaseTask & {
    kind: "autoTask";
    scheduleMode: "Asap" | "Late";
    duration: number;           // working days
};

export type ManualTask = _BaseWork & _BaseTask & {
    kind: "manualTask";
    manualStart: Date;
    manualEnd: Date;
};

export type Checkpoint = _BaseWork & {
    kind: "checkpoint";
    parent: AutoTask | ManualTask;
    successors: (AutoTask | ManualTask)[];
    checkpointSlack: number;
}

export type ZombieWork = _BaseWork & {
    kind: "zombie";
    name: "";
}

export type Work =
    | RootSummary
    | Summary
    | AutoTask
    | ManualTask
    | Checkpoint
    | ZombieWork;
