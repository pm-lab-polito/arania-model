import {CalendarSharedState} from "./project.shared-state";

/**
 * Project calendar: the ONLY place where the rule "which days are worked" lives.
 * Everything else (CPM, Gantt, Start/End columns, report) talks to it and knows nothing about weekends.
 * For a more sophisticated calendar (holidays, per-resource calendars...) only this class
 * and the options in CalendarSharedState need to change.
 *
 * Three coordinate systems:
 *  - linear: WORKING days from day 0. It is the unit of the CPM: durations, task start/end.
 *  - adj:    CALENDAR days from day 0, weekends included. It is the unit of the Gantt and of dates.
 *  - Date:   real date = startDate + adj (only with unit === "day").
 *
 * Calendar day 0 is startDate (unit "day") or an artificial Monday (unit "linear").
 * Working day n (linear) is the n-th working day counting from day 0:
 * if day 0 is not a working day, linear 0 falls on the first following working day.
 * Fractions of a day (durations like 2.5) stay inside the working day they belong to.
 */
export class Calendar {
    readonly unit: "linear" | "day";
    readonly startDate: Date;       // Invalid Date if linear or start missing

    // Date.getDay() of day 0 (0 = Sunday ... 6 = Saturday); in linear it is a Monday
    private readonly startWeekday: number;
    // index = Date.getDay(): true if worked
    private readonly workingWeek: boolean[];
    // offsets (0..6) of the working days in the week starting at day 0, in order
    private readonly workingOffsets: number[];

    constructor(calendar?: CalendarSharedState) {
        this.unit = calendar?.unit === "day" ? "day" : "linear"; // default: linear
        // `start` is meaningful only with unit === "day": in linear it must be ignored even if the
        // shared state still holds a value for it
        this.startDate = new Date(this.unit === "day" ? (calendar?.start ?? NaN) : NaN);

        const MONDAY = 1;
        this.startWeekday = isNaN(this.startDate.getTime()) ? MONDAY : this.startDate.getDay();

        // Mon-Fri always worked; Saturday and Sunday unless explicitly excluded (default 7/7: no interruption)
        this.workingWeek = [calendar?.workSunday ?? true, true, true, true, true, true, calendar?.workSaturday ?? true];
        this.workingOffsets = [0, 1, 2, 3, 4, 5, 6].filter(d => this.workingWeek[this.weekdayOf(d)]);
    }

    private get workingPerWeek(): number {
        return this.workingOffsets.length;
    }

    // Date.getDay() of calendar day `adj`
    private weekdayOf(adj: number): number {
        return (((this.startWeekday + adj) % 7) + 7) % 7;
    }

    isWorkingDay(adj: number): boolean {
        return this.workingWeek[this.weekdayOf(Math.floor(adj))];
    }

    /* ── linear ⇄ adj ── */

    /** Calendar day on which working day `linear` starts. */
    linearToAdj(linear: number): number {
        if (!Number.isFinite(linear)) return NaN;
        const day = Math.floor(linear);
        const frac = linear - day;
        const weeks = Math.floor(day / this.workingPerWeek);
        const rest = day - weeks * this.workingPerWeek; // 0 .. workingPerWeek-1
        return weeks * 7 + this.workingOffsets[rest] + frac;
    }

    /**
     * Working days in [0, adj): inverse of linearToAdj on working days.
     * A non-working day "collapses" onto the next working day
     * (Saturday and Monday give the same linear).
     */
    adjToLinear(adj: number): number {
        if (!Number.isFinite(adj)) return NaN;
        const day = Math.floor(adj);
        const frac = adj - day;
        // the fraction only counts inside a working day
        return this.countWorkingDays(this.startWeekday, day) + (this.isWorkingDay(day) ? frac : 0);
    }

    // working days in `days` consecutive days starting from a day with Date.getDay() = weekday
    // (days can be negative: counts backwards)
    private countWorkingDays(weekday: number, days: number): number {
        const weeks = Math.floor(days / 7);
        const rest = days - weeks * 7; // 0 .. 6
        let count = weeks * this.workingPerWeek;
        for (let d = 0; d < rest; d++)
            if (this.workingWeek[(weekday + d) % 7]) count++;
        return count;
    }

    /**
     * Working interval [start, end) → calendar interval [adjStart, adjEnd).
     * The bar goes from the start of the first working day to the END of the last one: a task
     * that ends on Friday ends on Friday, not on Monday. Duration 0 → point on adjStart
     * (a milestone after a Friday sits on Monday, like the task that follows it).
     */
    linearSpanToAdj(start: number, end: number): {start: number, end: number} {
        const adjStart = this.linearToAdj(start);
        if (!(end > start)) return {start: adjStart, end: adjStart};
        const lastDay = Math.ceil(end) - 1; // last working day occupied (even partially)
        return {start: adjStart, end: this.linearToAdj(lastDay) + (end - lastDay)};
    }

    /* ── adj ⇄ Date (only unit "day") ── */

    adjToDate(adj: number): Date {
        const d = new Date(this.startDate);
        d.setDate(d.getDate() + adj);
        return d;
    }

    /** Calendar days between startDate and `date` (NaN if either is invalid). */
    dateToAdj(date: Date): number {
        return diffDays(this.startDate, date);
    }

    dateToLinear(date: Date): number {
        return this.adjToLinear(this.dateToAdj(date));
    }

    /** Working days in [a, b) between two real dates, independent of startDate (also valid in linear). */
    workingDaysBetween(a: Date, b: Date): number {
        const days = diffDays(a, b);
        if (!Number.isFinite(days)) return NaN;
        return this.countWorkingDays(a.getDay(), days);
    }

    /* ── for the Gantt ── */

    /** Contiguous blocks of non-working days in [0, adjMax), e.g. for the weekend background. */
    nonWorkingRanges(adjMax: number): {start: number, length: number}[] {
        const ranges: {start: number, length: number}[] = [];
        let day = 0;
        while (day < adjMax) {
            if (this.isWorkingDay(day)) { day++; continue; }
            let length = 1;
            while (day + length < adjMax && !this.isWorkingDay(day + length)) length++;
            ranges.push({start: day, length});
            day += length;
        }
        return ranges;
    }
}

// whole days between two dates, comparing local dates at midnight (immune to DST)
function diffDays(a: Date, b: Date): number {
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return NaN;
    return (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
        Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5;
}
