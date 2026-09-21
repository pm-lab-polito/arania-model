import type {WorkSharedState} from "./project.shared-state";
import {Work} from "./project";

export type TaskCPM = {
    base: WorkSharedState;

    // Parsed model Attrs
    isManualScheduled: boolean;
    isSummary: boolean;
    isCheckpoint: boolean;

    error?: string;                    // parsing/scheduling error (e.g. fixed dates in a linear calendar)
    warning?: string;                  // non-blocking warning (e.g. Manual task starting before its predecessor)

    parent: TaskCPM | undefined;       // refs
    children: Set<TaskCPM>;            // refs
    checkpoints: Set<TaskCPM>;         // refs
    predecessors: Set<TaskCPM>;        // refs
    successors: Set<TaskCPM>;          // refs

    linearManStart: number
    linearManEnd: number

    // CPM attrs
    duration: number;

    ES: number;
    EF: number;
    LS: number;
    LF: number;

    slack?: number;
    isCritical?: boolean;

    start: number;
    end: number;

    // Kahn/CPM temp attrs
    _remainingPreds?: number;

    _fwRef?: Work
};

type ProjectCPMComputed = {
    tasks: TaskCPM[],
    duration: number,
    onError: boolean
}

/**
 * Kahn/CPM (with a small modification for checkpoints)
 *
 * in Late Schedule the end-slack of tasks with checkpoints
 * is Min(task.end-slack, task.cp[0].end-slack, task.cp[1].end-slack ...)
 * to avoid the task shifting right when it has a checkpoint blocked by a successor
 *
 * E.g.:
 *   1  Task: [_____]          Succ: []
 *   2   cp: ...|              Succ: [2]
 *   3          [_______]      Pred: [2]
 *
 *  Task 1 could slide but is blocked by its checkpoint
 */

export function computeTasksCPM(
    tasks: TaskCPM[]
): ProjectCPMComputed {

    // STEP 1: Topological sort

    // Queue with the "initial" nodes, without predecessors
    const queue: TaskCPM[] = [];
    const topoOrder: TaskCPM[] = [];

    // Init Kahn
    tasks.forEach(task => {
        // Manual tasks have ES/EF/LS/LF already fixed in parseAndAbstract: do not reset them
        if (!task.isManualScheduled) {
            task.ES = 0; task.EF = 0; task.LS = 0; task.LF = 0;
        }
        // checkpoints of a Manual task start with the parent: LS fixed like its own
        if (task.isCheckpoint && task.parent?.isManualScheduled)
            task.LS = task.parent.LS;
        task.slack = 0; task.isCritical = false;

        task._remainingPreds = task.predecessors.size;
        if (task._remainingPreds === 0)
            queue.push(task);
    });

    let current;
    while (current = queue.shift()) {
        topoOrder.push(current);
        current.successors.forEach(succ => {
            // @ts-ignore
            const count = succ._remainingPreds--;
            if (count === 1) // when going from 1 to 0, all predecessors have been consumed
                queue.push(succ);
        });
    }

    let onError = false;
    if (topoOrder.length !== tasks.length) {
        console.error("computeProjectCPM: incomplete topological order (cycle or inconsistent graph).");
        onError = true;
    }

    // STEP 2: CPM

    // ES/EF
    topoOrder
        .filter(t => !t.isManualScheduled)
        .forEach((task,i) => {
        task.ES = Math.max(0, ...[...task.predecessors]
            .map(pred => pred.EF))
        // checkpoints of a Manual task start with the parent (fixed), not with their preds
        if (task.isCheckpoint && task.parent?.isManualScheduled)
            task.ES = task.parent.ES;
        task.EF = task.ES + task.duration;
    });

    // 0 avoid -Infinity project duration in case of 0 tasks
    let projectFinish = Math.max(
        0, ...tasks.map(t => t.EF));

    // LS/LF
    ([...topoOrder]).reverse()
        .filter(task => !task.isManualScheduled && !task.isCheckpoint)
        .forEach( task=> {

            // Modified CPM: the slack of a task with checkpoints and of all its checkpoints
            // is the same, and equals the minimum of all of them
            const taskAndHisCheckpoints = [task, ...task.checkpoints];
            const taskAndHisCheckpointsSlacks = taskAndHisCheckpoints.map(t => {
                const LF = Math.min(projectFinish, ...[...t.successors]
                    .map(pred => pred.LS))
                return LF - t.duration - t.ES;
            })
            let minSlack = Math.min(...taskAndHisCheckpointsSlacks)

            taskAndHisCheckpoints.forEach((t, index) => {
                // SLACK IS SHARED BETWEEN TASK AND CHECKPOINTS
                t.slack = minSlack;
                t.LS = minSlack + t.ES;

                // CRITICALITY IS INDIVIDUAL
                t.isCritical = (taskAndHisCheckpointsSlacks[index] === 0);
            })
        });

    // Actual Start / End

    [...topoOrder]
        .filter(task => !task.isManualScheduled)
        .forEach( task=> {
            const schedMode =
                task.isSummary ? 'Asap' : // summaries always follow their children (their preds)
                (task.isCheckpoint && task.parent) ? // task.parent only 4 ts, every cp have parent
                    task.parent.base.scheduleMode :
                    task.base.scheduleMode;

            if (schedMode === 'Asap') {
                task.start = Math.max(0, ...[...task.predecessors]
                    .map(pred => pred.end))
                task.end = task.start + task.duration
            }
            if (schedMode === 'Late') {
                task.start = task.LS
                task.end = task.start + task.duration
            }
            if (schedMode === 'Manual') {
                // only checkpoints get here (Manual tasks are filtered above):
                // the checkpoint starts with its fixed parent
                task.start = task.parent!.start
                task.end = task.start + task.duration
            }
        });


    return <ProjectCPMComputed> {
        tasks: tasks,
        duration: projectFinish,
        onError
    };
}
