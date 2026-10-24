// A run's length as a lap timer reads it: minutes, seconds, tenths.
(value) => {
  const tenths = Math.floor(Number(value) / 100);
  const secs = Math.floor(tenths / 10) % 60;
  return [`${Math.floor(tenths / 600)}:${secs < 10 ? "0" : ""}${secs}.${tenths % 10}`];
};
