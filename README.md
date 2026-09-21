# arania-model

The data model and the scheduling engine of [Arania](https://github.com/pm-lab-polito/arania), a real-time collaborative Gantt editor developed at the Polytechnic University of Turin.

This repository is published so that your project data is never locked in: the format is documented, and the engine that turns it into a schedule can be read, run and verified outside the app.

> **Read-only mirror.** This is a snapshot of the `model` folder of the Arania codebase. Issues and pull requests are disabled here. For questions, bug reports or contributions, write to **massimo.rebuglio@polito.it**.

## What is in here

Two things, and nothing else. No UI, no networking, no dependencies.

### 1. The data model

`src/project.shared-state.ts` defines `ProjectSharedState`: the raw, authoritative state of a project, exactly as it is stored and synchronized between users. It contains only user input, never derived values.

- **Works** are a flat list of rows. The hierarchy is not nested: it comes from an `indent` number. A row followed by rows with a larger indent becomes a summary. The first row is always the project root.
- A row with `indent: "+"` is a **checkpoint** of the task above it: it starts with its parent and sits `checkpointSlack` working days after the parent's start.
- **Dependencies** are finish-to-start links between row ids.
- The **calendar** is either `linear` (day 0, 1, 2, no real dates) or `day` (real dates from a start date). Saturday and Sunday can be excluded from working days.
- Each work has a `scheduleMode`: `Asap` and `Late` are computed by the scheduler, `Manual` uses fixed dates.

### 2. The scheduler

`computeProject(shared)` is a pure function. It takes a `ProjectSharedState` and returns a `Project`: a fully resolved view model with parents, children, predecessors, successors, start and end of every row.

```
ProjectSharedState  ──►  computeProject()  ──►  Project
   (raw input)          (parse + CPM)         (view model)
```

Internally it:

1. parses the indented list into a tree (`computeProject.ts`),
2. rewrites summaries and checkpoints into a regular dependency network,
3. runs a Critical Path Method pass on it: Kahn topological sort, forward and backward pass (`computeCpm.ts`),
4. maps working days to calendar days and dates through `Calendar` (`calendar.ts`),
5. reports dependency cycles and inconsistent fixed dates as readable errors (`projectErrors.ts`).

Working days are the unit of the scheduler. Calendar days and real dates are derived from them by the `Calendar` class only, which is the single place where the "which days are worked" rule lives.

## Try it

```sh
npm install
npm run example      # runs examples/basic.ts
npm run typecheck
```

The example builds a small project by hand and prints the computed schedule.

## Citing

If you use Arania or this model in scientific work, please cite this repository. Citation metadata is in `CITATION.cff` (GitHub shows a "Cite this repository" button from it).

## License

MIT. See `LICENSE`.
"# arania-model" 
