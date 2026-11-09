// Clock port (03b section 3, rule 5): the only place that reads the current time.
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
