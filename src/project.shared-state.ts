/**
 * Arania Project
 *
 * This file defines the core data structures that represent the
 * persistent state of a project. These types describe the raw,
 * authoritative domain entities (tasks, resources, dependencies, etc.)
 * without any computed or derived values.
 *
 * Computed fields, view models, and selectors are defined separately
 * in: project.ts
 */

export type Indent = number | "+";
export type ScheduleMode = "Asap" | "Late" | "Manual";
export type ISODate = string;

export type WorkSharedState = {
    id: string;
    name: string;
    indent: Indent;
    duration: number | "";
    scheduleMode: ScheduleMode;

    note?: string;                  // free-text note

    checkpointSlack?: number;       // only checkpoint

    manualStart?: ISODate;          // only manual scheduled
    manualEnd?: ISODate;            // only manual scheduled

    costs?: CostSharedState[]
};

export type CostSharedState = {
    name: string;
    unit: string;
    qty: number;
};

export type DependencySharedState = {
    predecessorId: string; // must come first
    successorId: string;   // comes after
};

export type CalendarSharedState = {
    unit: "linear" | "day",    // linear: no real dates (day 1, 2...); day: real dates starting from start
    start: ISODate,            // meaningful only with unit === "day"

    // Working days of the weekend. They also apply in a linear calendar:
    // there day 0 is an artificial Monday, but days are still days.
    // Absent => working (7/7, no interruption): they are excluded explicitly with false.
    workSaturday?: boolean,
    workSunday?: boolean
}

export type ProjectSharedState = {
    works: WorkSharedState[];
    dependencies: DependencySharedState[];
    calendar: CalendarSharedState;
    settings: Record<string, unknown>;
    layout: Record<string, unknown>;
};
