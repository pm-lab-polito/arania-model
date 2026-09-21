import {computeProject, ProjectSharedState} from "../src/index";

// A small project: one summary with two tasks, a task with a checkpoint, a final milestone.
// Rows are a flat list; `indent` builds the hierarchy, "+" marks a checkpoint of the row above.
const shared: ProjectSharedState = {
    calendar: {unit: "day", start: "2026-10-05", workSaturday: false, workSunday: false},
    works: [
        {id: "root",    name: "My project",    indent: -1,  duration: "", scheduleMode: "Asap"},
        {id: "design",  name: "Design",        indent: 0,   duration: "", scheduleMode: "Asap"},
        {id: "spec",    name: "Write spec",    indent: 1,   duration: 3,  scheduleMode: "Asap"},
        {id: "review",  name: "Review spec",   indent: 1,   duration: 2,  scheduleMode: "Asap"},
        {id: "build",   name: "Build",         indent: 0,   duration: 10, scheduleMode: "Asap"},
        {id: "demo",    name: "Internal demo", indent: "+", duration: "", scheduleMode: "Asap", checkpointSlack: 4},
        {id: "release", name: "Release",       indent: 0,   duration: 0,  scheduleMode: "Asap"},
    ],
    dependencies: [
        {predecessorId: "spec",   successorId: "review"},
        {predecessorId: "review", successorId: "build"},
        {predecessorId: "build",  successorId: "release"},
    ],
    settings: {},
    layout: {},
};

const project = computeProject(shared);

const day = (adj: number) => project._calendar.adjToDate(adj).toDateString();

for (const w of project.works) {
    const pad = " ".repeat(w._wbs.length);
    console.log(
        `${pad}${w.name.padEnd(16 - w._wbs.length)} ${w.kind.padEnd(11)}` +
        ` linear ${String(w._linearStart).padStart(2)} → ${String(w._linearEnd).padStart(2)}` +
        `   ${day(w._calendarStart)} → ${day(w._calendarEnd)}`
    );
}

console.log(`\nProject duration: ${project.duration} working days, ${project.calendarDuration} calendar days`);
if (project._errors.length) console.log("Errors:", project._errors);
