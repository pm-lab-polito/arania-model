import type {TaskCPM} from "./computeCpm";
import type {ProjectError} from "./project";

/**
 * Project error handling: here live the functions that turn the problems
 * detected by the scheduler into user-readable errors
 * (Project._errors + Work._error). Future diagnostic functions → here.
 */

/**
 * Dependency cycles → per-row errors, blaming ONLY the right rows.
 *
 * Two refinements over the Kahn leftover:
 * 1. Tarjan (SCC) finds the tasks actually in the cycle, not the ones blocked downstream.
 * 2. Inside the cycle, only the row where the user WROTE the dependency is blamed
 *    (the successor of a non-structural edge): the internal summary/children and
 *    parent/checkpoint links are not dependencies visible to the user.
 *    Typical case: pred = a summary that contains the row → for the user it is not
 *    a loop at all, so a dedicated message and the summary is NOT flagged.
 */
export function collectCycleErrors(tasks: TaskCPM[], _errors: ProjectError[]) {
    let flagged = false;

    findDependencyCycles(tasks).forEach(({members, path}) => {
        const scc = new Set(members);
        const tip = [...path, path[0]].map(t => `"${t.base.name}"`).join(" → ");

        members.forEach(w => {
            // incoming edges inside the cycle created by the user (non-structural)
            const userPreds = [...w.predecessors].filter(v => scc.has(v) && !isStructuralEdge(v, w));
            userPreds.forEach(v => {
                if (w.error) return; // already reported, no duplicates
                w.error = isAncestorOf(v, w)
                    ? `"${w.base.name}": predecessor "${v.base.name}" is a summary that contains this row. Remove it from the predecessors`
                    : `"${w.base.name}": dependency cycle ${tip}. Break one of these links`;
                _errors.push({message: w.error, severity: "error", workId: w.base.id});
                flagged = true;
            });
        });
    });

    // should not happen: the CPM failed but no row can be blamed
    if (!flagged)
        _errors.push({message: "Circular reference", severity: "error"});
}

// edge v→w internal to the structure (not created by the user):
// child→summary (summaries follow their children) or parent→checkpoint
function isStructuralEdge(v: TaskCPM, w: TaskCPM): boolean {
    return v.parent === w || (w.parent === v && w.isCheckpoint);
}

function isAncestorOf(v: TaskCPM, w: TaskCPM): boolean {
    for (let p = w.parent; p; p = p.parent) if (p === v) return true;
    return false;
}

type DependencyCycle = {
    members: TaskCPM[];  // all the tasks actually inside the cycle (SCC)
    path: TaskCPM[];     // a simple cycle inside the SCC, ordered: used for the tip to the user
};

/**
 * Precise cycle detection (Tarjan, strongly connected components):
 * an SCC with more than one node (or a self-loop) contains exactly the tasks
 * that are part of a cycle. The graph is the same as the CPM one (successors), so
 * it also includes the structural summary/children and checkpoint/parent edges.
 *
 * Note: recursive — depth equals the longest chain, fine for real projects.
 */
function findDependencyCycles(tasks: TaskCPM[]): DependencyCycle[] {
    let nextIndex = 0;
    const index = new Map<TaskCPM, number>();
    const lowlink = new Map<TaskCPM, number>();
    const onStack = new Set<TaskCPM>();
    const stack: TaskCPM[] = [];
    const cycles: DependencyCycle[] = [];

    const strongConnect = (v: TaskCPM) => {
        index.set(v, nextIndex);
        lowlink.set(v, nextIndex);
        nextIndex++;
        stack.push(v);
        onStack.add(v);

        v.successors.forEach(w => {
            if (!index.has(w)) {
                strongConnect(w);
                lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
            } else if (onStack.has(w)) {
                lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
            }
        });

        if (lowlink.get(v) === index.get(v)) {
            const scc: TaskCPM[] = [];
            let w: TaskCPM;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                scc.push(w);
            } while (w !== v);

            // "real" SCC: multiple nodes, or a single node that depends on itself
            if (scc.length > 1 || scc[0].successors.has(scc[0]))
                cycles.push({members: scc, path: orderCycle(new Set(scc))});
        }
    };

    tasks.forEach(t => { if (!index.has(t)) strongConnect(t); });
    return cycles;
}

// From any node, follow the successors inside the SCC until reaching
// an already-seen node: from there on it is a simple, ordered cycle.
function orderCycle(scc: Set<TaskCPM>): TaskCPM[] {
    const path: TaskCPM[] = [];
    const seen = new Set<TaskCPM>();
    let cur: TaskCPM = scc.values().next().value!;
    while (!seen.has(cur)) {
        seen.add(cur);
        path.push(cur);
        cur = [...cur.successors].find(s => scc.has(s))!;
    }
    return path.slice(path.indexOf(cur));
}
/**
 * Manual task starting BEFORE the end of one of its predecessors: fixed dates
 * win over the dependency, so it is not a CPM error but the user must be warned
 * (WARN tag on the row + entry in the popover). One warning per row, with all the
 * "overtaken" predecessors. With the CPM in error (start NaN) the comparison is false: no warnings.
 */
export function collectManualDateWarnings(tasks: TaskCPM[], _errors: ProjectError[]) {
    tasks
        .filter(t => t.isManualScheduled && !t.isSummary && !t.error)
        .forEach(t => {
            const overtaken = [...t.predecessors].filter(p => p.end > t.start);
            if (overtaken.length === 0) return;
            const names = overtaken.map(p => `"${p.base.name}"`).join(", ");
            t.warning = `"${t.base.name}": starts before its predecessor${overtaken.length > 1 ? "s" : ""} ${names} end${overtaken.length > 1 ? "" : "s"}. Fixed dates ignore the dependency`;
            _errors.push({message: t.warning, severity: "warning", workId: t.base.id});
        });
}
