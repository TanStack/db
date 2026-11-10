// src/index.ts
var d = (e) => String(e);
d.open = d.close = "";
var i = () => d, t = "\x1B[39m", o = "\x1B[49m", F = (e, r, a, n, l) => {
  let m = "", g = 0;
  do
    m += e.substring(g, n) + a, g = n + l, n = e.indexOf(r, g);
  while (~n);
  return m + e.substring(g);
}, u = (e, r, a = e, n = e.length) => {
  let l = r.length, m = (g) => {
    let s = g + "", x = s.indexOf(r, n);
    return ~x ? e + F(s, r, a, x, l) + r : e + s + r;
  };
  return m.open = e, m.close = r, m;
}, B = (e, r) => u(e, r, e, 5), c = (e) => {
  let r = e.charCodeAt(0) === 35 ? e.slice(1) : e, a = parseInt(r, 16) || 0;
  return r.length < 6 ? `${(a >> 8 & 15) * 17};${(a >> 4 & 15) * 17};${(a & 15) * 17}` : `${a >> 16 & 255};${a >> 8 & 255};${a & 255}`;
};
function y(e) {
  let r = e ? u : i;
  return {
    isColorSupported: e,
    reset: r("\x1B[0m", "\x1B[0m"),
    bold: r("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
    dim: r("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
    italic: r("\x1B[3m", "\x1B[23m"),
    underline: r("\x1B[4m", "\x1B[24m"),
    inverse: r("\x1B[7m", "\x1B[27m"),
    hidden: r("\x1B[8m", "\x1B[28m"),
    strikethrough: r("\x1B[9m", "\x1B[29m"),
    black: r("\x1B[30m", t),
    red: r("\x1B[31m", t),
    green: r("\x1B[32m", t),
    yellow: r("\x1B[33m", t),
    blue: r("\x1B[34m", t),
    magenta: r("\x1B[35m", t),
    cyan: r("\x1B[36m", t),
    white: r("\x1B[37m", t),
    gray: r("\x1B[90m", t),
    bgBlack: r("\x1B[40m", o),
    bgRed: r("\x1B[41m", o),
    bgGreen: r("\x1B[42m", o),
    bgYellow: r("\x1B[43m", o),
    bgBlue: r("\x1B[44m", o),
    bgMagenta: r("\x1B[45m", o),
    bgCyan: r("\x1B[46m", o),
    bgWhite: r("\x1B[47m", o),
    blackBright: r("\x1B[90m", t),
    redBright: r("\x1B[91m", t),
    greenBright: r("\x1B[92m", t),
    yellowBright: r("\x1B[93m", t),
    blueBright: r("\x1B[94m", t),
    magentaBright: r("\x1B[95m", t),
    cyanBright: r("\x1B[96m", t),
    whiteBright: r("\x1B[97m", t),
    bgBlackBright: r("\x1B[100m", o),
    bgRedBright: r("\x1B[101m", o),
    bgGreenBright: r("\x1B[102m", o),
    bgYellowBright: r("\x1B[103m", o),
    bgBlueBright: r("\x1B[104m", o),
    bgMagentaBright: r("\x1B[105m", o),
    bgCyanBright: r("\x1B[106m", o),
    bgWhiteBright: r("\x1B[107m", o),
    rgb: e ? (n, l, m) => B(`\x1B[38;2;${n};${l};${m}m`, t) : i,
    bgRgb: e ? (n, l, m) => B(`\x1B[48;2;${n};${l};${m}m`, o) : i,
    hex: e ? (n) => B(`\x1B[38;2;${c(n)}m`, t) : i,
    bgHex: e ? (n) => B(`\x1B[48;2;${c(n)}m`, o) : i
  };
}
function f() {
  return y(!1);
}
function C() {
  let e = typeof process != "undefined" ? process : void 0, r = (e == null ? void 0 : e.env) || {}, a = r.FORCE_TTY !== "false", n = (e == null ? void 0 : e.argv) || [];
  return !("NO_COLOR" in r || n.includes("--no-color")) && ("FORCE_COLOR" in r || n.includes("--color") || (e == null ? void 0 : e.platform) === "win32" || a && r.TERM !== "dumb" || "CI" in r) || typeof window != "undefined" && !!window.chrome;
}
function h({ force: e } = {}) {
  let r = e || C();
  return y(r);
}
var b = h();
function w() {
  Object.assign(b, f());
}
function p() {
  Object.assign(b, h({ force: !0 }));
}
var $ = b;
export {
  h as createColors,
  $ as default,
  w as disableDefaultColors,
  p as enabledDefaultColors,
  f as getDefaultColors,
  C as isSupported
};
