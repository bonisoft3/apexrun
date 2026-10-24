// The outcome column holds an ending's letter or time_over.
(value) => [value === "time_over" ? "TIME OVER" : `GOAL ${value}`];
