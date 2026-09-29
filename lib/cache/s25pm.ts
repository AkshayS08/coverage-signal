import { parseMoneyAmount } from "../events/position";
for (const s of ["$549", "549", "$ 549", "1,406", "$1,406", "\u2014", "$\u2014", "43"]) {
  console.log(JSON.stringify(s).padEnd(10), "->", String(parseMoneyAmount(s)));
}
