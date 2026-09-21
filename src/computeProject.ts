import {
    Indent, DependencySharedState, ProjectSharedState, WorkSharedState
} from "./project.shared-state";
import type {TaskCPM} from "./computeCpm";
import {computeTasksCPM} from "./computeCpm";
import {collectCycleErrors, collectManualDateWarnings} from "./projectErrors";
import {Calendar} from "./calendar";
import {ManualTask, Project, ProjectError, Summary, Work} from "./project";

export function computeProject(
    baseProject: ProjectSharedState
): Project {

    const calendar = new Calendar(baseProject.calendar);

    /**
     * Error catalog — every error ends up in Project._errors; row-level ones
     * (workId set) are also mirrored in Work._error and shown as ERR tag:
     * - `"<name>": fixed dates are not allowed in a linear calendar` — Manual task in a linear calendar (row)
     * - `"<name>": invalid or missing fixed dates` — Manual task with missing/unparsable dates (row)
     * - `"<name>": predecessor "<summary>" is a summary that contains this row. Remove it
     *   from the predecessors` — pred pointing to one of the row's own parent summaries (row)
     * - `"<name>": dependency cycle "A" → "B" → "A". Break one of these links` — row with a
     *   user-made dependency inside a real cycle; only the rows where the dependency was
     *   typed get blamed (row)
     * - `Circular reference` — fallback when the CPM fails but no row could be blamed (project-wide)
     * - `"<name>": starts before its predecessor "<pred>" ends. Fixed dates ignore the
     *   dependency` — Manual task whose fixed start is earlier than a predecessor end (row, WARNING)
     * Cycle/date diagnostics are built in projectErrors.ts (generic error-handling home).
     */
    const _errors: ProjectError[] = [];

    // freshly created / not yet initialized doc: no crash
    baseProject.works ??= [];
    baseProject.dependencies ??= [];

    /**
     * PART A
     * parse the user data, take the model and turn it
     * into a "clean" model for Kahn/CPM
     * with standard (semi-standard) objects
     */

    if (baseProject.works[0])
        baseProject.works[0].indent = -1;
    // baseProject.works.forEach(work => {
    //     work.indent = work.indent === "+" ? "+" : parseInt(work.indent.toString())
    // })

    let _cpmTasks = parseAndAbstract(
        baseProject.works, baseProject.dependencies, calendar, _errors);

    const CPMProject = computeTasksCPM(_cpmTasks);
    if (CPMProject.onError) {
        collectCycleErrors(_cpmTasks, _errors);
    }
    // non-blocking warnings: fixed dates that contradict the dependencies
    collectManualDateWarnings(_cpmTasks, _errors);

    /**
     * PART B
     * Stitch back: from the CPM abstraction return to the real values
     *
     * SUMMARY: from a milestone at the end I become a task whose start
     * is the max start of my children
     *
     * visual start = Max(...children.start)
     *
     *      CPM:                     *
     *      Visual:    |             |
     *      Children:  [......] [....]
     *
     * CHECKPOINT: from a task that starts with the parent and ends
     * on the CP, to a "milestone" at the end
     *
     *      Parent:   [............]
     *      CPM:      |     |
     *      Visual:         *
     *
     * visual start <= parent.start + duration
     *
     */

    const works: Work[] = CPMProject.tasks.map((cpmTask, index) => {

        // Start depend on the abstraction
        let linearStart;
        const recursiveMinStart: (t: TaskCPM) => number = t =>
            Math.min(t.start, ...[...t.children]
                .filter(c => !isZombieCpm(c)) // empty rows (start 0) do not widen the summary
                .map(recursiveMinStart));

        if (cpmTask.isSummary) {
            linearStart = recursiveMinStart(cpmTask);
        } else if (cpmTask.isCheckpoint) {
            linearStart = cpmTask.end
        } else {
            linearStart = cpmTask.start
        }

        // End is just end
        const linearEnd = cpmTask.end;
        const linearDuration = linearEnd - linearStart; // working days

        // From working days (CPM) to calendar days (Gantt/dates): weekends included.
        // Only the Calendar knows which days are worked.
        const {start: calendarStart, end: calendarEnd} = calendar.linearSpanToAdj(linearStart, linearEnd);

        // paranoid check: the fixed dates of a Manual task must land back on the same
        // working days they started from (roundtrip Date → linear → adj → Date → linear)
        if (cpmTask.isManualScheduled && calendar.unit === "day" && !cpmTask.error) {
            const startBack = calendar.dateToLinear(calendar.adjToDate(calendarStart));
            const endBack = calendar.dateToLinear(calendar.adjToDate(calendarEnd));
            console.assert(startBack === linearStart, "start mismatch:", {name: cpmTask.base.name, actual: startBack, expected: linearStart});
            console.assert(endBack === linearEnd, "end mismatch:", {name: cpmTask.base.name, actual: endBack, expected: linearEnd});
        }

        // todo: fix with real numbers
        let wbs = ""
        let tmp: any = cpmTask;
        while (tmp = tmp.parent) { wbs += "_." }

        let work: Work;
        let commonWork = {
            id: cpmTask.base.id,
            name: cpmTask.base.name,
            _wbs: wbs,
            _cpmTask: cpmTask,
            _base: cpmTask.base,
            _index: index,
            _error: cpmTask.error,
            _warning: cpmTask.warning,

            _linearStart: linearStart,
            _linearEnd: linearEnd,
            _linearDuration: linearDuration,

            _calendarStart: calendarStart,
            _calendarEnd: calendarEnd,
            _calendarDuration: calendarEnd - calendarStart,
        }

        if (isZombieCpm(cpmTask)) {
            work = {
                kind: "zombie",
                ...commonWork,
                name: "" // useless, but avoid ts alert
            }
        }
        else if (cpmTask.isCheckpoint) {
            work = {
                kind: "checkpoint",
                ...commonWork,
                parent: (null as unknown as ManualTask),
                checkpointSlack: cpmTask.base.checkpointSlack || 0,
                successors: []
            }
        }
        else if (cpmTask.isSummary) {
            if (cpmTask.parent) {
                work = {
                    kind: "summary",
                    ...commonWork,
                    children: [],
                    successors: [],
                    parent: (null as unknown as Summary),
                }
            } else {
                work = {
                    kind: "rootSummary",
                    ...commonWork,
                    children: [],
                }
            }
        } else { // is task
            const commonTask = {
                predecessors: [],
                successors: [],
                checkpoints: [],
                _isMilestone: calendarStart === calendarEnd,
                parent: (null as unknown as Summary),
            }
            if (cpmTask.base.scheduleMode === "Manual") {
                work = {
                    kind: "manualTask",
                    ...commonWork,
                    ...commonTask,
                    manualStart: new Date(cpmTask.base.manualStart || ""),
                    manualEnd: new Date(cpmTask.base.manualEnd || ""),
                }
            } else {
                work = {
                    kind: "autoTask",
                    ...commonWork,
                    ...commonTask,
                    scheduleMode: cpmTask.base.scheduleMode,
                    duration: cpmTask.duration
                }
            }
        }

        cpmTask._fwRef = work;
        return work;
    });

    works.forEach(work => {

        // @ts-expect-error
        work.parent = work._cpmTask.parent?._fwRef!

        // @ts-expect-error
        work.children = [...work._cpmTask.children].map(t => t._fwRef)

        if (work.kind !== "zombie") {
            if (work.kind !== "rootSummary") {

                // @ts-expect-error
                work.successors = [...work._cpmTask.successors]
                    .filter(t => !t.isSummary) // summaries have no preds
                    .map(t => t._fwRef)
            }
        }

        if (work.kind === "checkpoint") {

        } else if (work.kind === "summary" || work.kind === "rootSummary") {

        } else {
            // @ts-expect-error
            work.predecessors = [...work._cpmTask.predecessors].map(t => t._fwRef)
            // @ts-expect-error
            work.checkpoints = [...work._cpmTask.checkpoints].map(t => t._fwRef)
        }
    })

    return <Project>{
        works,
        duration: CPMProject.duration, // working days
        calendarDuration: calendar.linearSpanToAdj(0, CPMProject.duration).end, // calendar days
        calendarStartDate: calendar.startDate, // Invalid Date if the calendar is linear

        _errors,
        _base: baseProject,
        _calendar: calendar,
    }
}

// an empty row, which does not take part in scheduling
function isZombieCpm(t: TaskCPM): boolean {
    return t.base.name === ""
        && t.duration === 0
        && t.predecessors.size === 0
        && [...t.successors].filter(s => !s.isSummary).length === 0 // todo: improve this shit
        && !t.isManualScheduled;
}

function parseAndAbstract(_tasks: WorkSharedState[], dependencies: DependencySharedState[], calendar: Calendar, _errors: ProjectError[]) {

    const tasksCPM: TaskCPM[] = _tasks.map(baseTask => {
        let error: string | undefined;
        let linearManStart = NaN;
        let linearManEnd = NaN;

        if (baseTask.scheduleMode === "Manual") {
            if (calendar.unit === "linear") {
                // in a linear calendar fixed dates are not allowed:
                // error, task forced to start 0 (duration preserved if computable)
                error = `"${baseTask.name}": fixed dates are not allowed in a linear calendar`;
                const days = calendar.workingDaysBetween(new Date(baseTask.manualStart!), new Date(baseTask.manualEnd!));
                linearManStart = 0;
                linearManEnd = Number.isFinite(days) ? Math.max(0, days) : 0;
            } else {
                linearManStart = calendar.dateToLinear(new Date(baseTask.manualStart!));
                linearManEnd = calendar.dateToLinear(new Date(baseTask.manualEnd!));
            }

            if (!Number.isFinite(linearManStart) || !Number.isFinite(linearManEnd)) {
                // missing/invalid dates: without a fallback the NaN propagates to all successors
                error = error || `"${baseTask.name}": invalid or missing fixed dates`;
                linearManStart = 0;
                linearManEnd = 0;
            }

            if (linearManEnd < linearManStart) {
                linearManEnd = linearManStart;
                console.error("LinearManEnd before Start. This should not happens.")
            }

            if (error) _errors.push({message: error, severity: "error", workId: baseTask.id});
        }

        return {
            base: baseTask,
            error,

            isManualScheduled: baseTask.scheduleMode === "Manual",
            isSummary: false,
            isCheckpoint: false,

            parent: undefined,
            children: new Set(),
            checkpoints: new Set(),
            predecessors: new Set(),
            successors: new Set(),

            linearManStart,
            linearManEnd,

            ES: NaN, EF: NaN, LS: NaN, LF: NaN,
            start: NaN, end: NaN, duration: NaN
        }
    })

    const taskById: Record<string, TaskCPM> = Object.fromEntries(
        tasksCPM.map<[string, TaskCPM]>(task => [task.base.id, task])
    );

    /*
     * Parse Indent and detect Task Hierarchy
     */

    let waitForParent: TaskCPM[] = [];
    let parentFound = (parentTask: TaskCPM, onlyCheckpoints = false) => {
        waitForParent
            .filter(task => !task.parent // if already assigned, ignore
                && (task.base.indent === "+"
                    || (!onlyCheckpoints && Number(parentTask.base.indent) < task.base.indent))) // adopt those below me, not equal or above
            .forEach(task => {
                task.parent = parentTask;
                if (task.base.indent === "+") parentTask.checkpoints.add(task);
                else parentTask.children.add(task);
            });
    }

    let lastIndent: Indent = 0;
    for (const task of [...tasksCPM].reverse()) {
        let indent = task.base.indent;
        if (indent === "+") { // i'm a checkpoint
            task.isCheckpoint = true;
        } else if (lastIndent === "+") {
            // I'm not a checkpoint, next element(s) is/are checkpoints => i'm a task.
            // A task with checkpoints cannot be a summary: adopt only the checkpoints.
            // Any more-indented rows after the checkpoints have no right to
            // the indentation: they stay waiting and the summary above me adopts them.
            parentFound(task, true)
        } else if (indent < lastIndent) {
            task.isSummary = true;
            parentFound(task)
        } else {

        }
        waitForParent.push(task)
        lastIndent = indent;
    }

    /*
     * Turn into a regular network for (semi)standard Kahn
     */

    // everyone keeps their regular successors
    tasksCPM.forEach((task) => {
        task.successors = new Set(dependencies
            .filter(dep => dep.predecessorId === task.base.id) // I am the pred -> find my succs
            .map(dep => taskById[dep.successorId])
            // deps towards summary/checkpoint are ignored on the preds side (below):
            // they must be ignored here too or the Kahn count gets unbalanced
            .filter(succ => !succ?.isSummary && !succ?.isCheckpoint))
    })

    // Predecessors are interpreted
    const pushSuccs = (targets: Set<TaskCPM>, succ: TaskCPM) =>
        targets.forEach(target =>  target?.successors.add(succ)) // TODO: the ? after target is due to zombie preds

    tasksCPM.forEach((task) => {
        if (task.isSummary) {
            // a summary is always scheduled by its children: any
            // Manual mode on the row must be ignored (dates never parsed here,
            // ES/EF would stay NaN and poison the whole CPM)
            task.isManualScheduled = false;
            // I become a milestone between my children and my successors
            task.predecessors = new Set(task.children)
            pushSuccs(task.predecessors, task)
            task.duration = 0

        } else {
            if (task.isManualScheduled) {
                task.ES = task.LS = task.start = task.linearManStart
                task.EF = task.LF = task.end = task.linearManEnd
                task.duration = task.end - task.start
            }

            let idToFindPreds = task.base.id

            if (task.isCheckpoint
                && task.parent // paranoid Ts check
            ) {
                // if checkpoint
                // I become a task with the same predecessors as my parent
                idToFindPreds = task.parent.base.id
                task.duration = Number(task.base.checkpointSlack) || 0
            } else if (!task.isCheckpoint) {
                task.duration = Number(task.base.duration) || 0
            }

            task.predecessors = new Set(dependencies
                .filter(dep => dep.successorId === idToFindPreds) // I am the succ -> find my preds
                .map(dep => taskById[dep.predecessorId]))
            pushSuccs(task.predecessors, task)
        }
    })

    // remove non-existent preds and succs
    // todo: resolve zombie dependencies
    tasksCPM.forEach((task) => {
        // @ts-expect-error -- remove invalid entry
        task.predecessors.delete(undefined)
        // @ts-expect-error -- remove invalid entry
        task.successors.delete(undefined)
    })

    return tasksCPM;
}
