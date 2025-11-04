import { describe, expect, it } from "vitest"
import { Aggregate, Func, PropRef, Value } from "../../src/query/ir.js"
import { compileExpression } from "../../src/query/compiler/evaluators.js"

describe("Nested aggregates bug reproduction", () => {
  it("should fail when trying to compile add() with sum() aggregates", () => {
    // This simulates: add(sum(ind.payoutPieceRate), sum(ind.payoutDavisBacon))
    const sumExpr1 = new Aggregate("sum", [new PropRef(["ind", "payoutPieceRate"])])
    const sumExpr2 = new Aggregate("sum", [new PropRef(["ind", "payoutDavisBacon"])])
    const addExpr = new Func("add", [sumExpr1, sumExpr2])

    // This should throw "Unknown expression type: agg"
    expect(() => {
      compileExpression(addExpr as any)
    }).toThrow("Unknown expression type: agg")
  })

  it("should fail with coalesce and nested add+sum", () => {
    // This simulates: coalesce(add(sum(ind.payoutPieceRate), sum(ind.payoutDavisBacon)), 0)
    const sumExpr1 = new Aggregate("sum", [new PropRef(["ind", "payoutPieceRate"])])
    const sumExpr2 = new Aggregate("sum", [new PropRef(["ind", "payoutDavisBacon"])])
    const addExpr = new Func("add", [sumExpr1, sumExpr2])
    const coalesceExpr = new Func("coalesce", [addExpr, new Value(0)])

    // This should throw "Unknown expression type: agg"
    expect(() => {
      compileExpression(coalesceExpr as any)
    }).toThrow("Unknown expression type: agg")
  })
})
