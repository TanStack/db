import { router, authedProcedure } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { eq, and, arrayContains } from "drizzle-orm"
import { todosTable, createTodoSchema, updateTodoSchema } from "@/db/schema"

export const todosRouter = router({
  getAll: authedProcedure.query(async ({ ctx }) => {
    const todos = await ctx.db
      .select()
      .from(todosTable)
      .where(arrayContains(todosTable.user_ids, [ctx.session.user.id]))
    return todos
  }),

  create: authedProcedure
    .input(createTodoSchema)
    .mutation(async ({ ctx, input }) => {
      const [newItem] = await ctx.db
        .insert(todosTable)
        .values(input)
        .returning()
      return newItem
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.number(),
        data: updateTodoSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updatedItem] = await ctx.db
        .update(todosTable)
        .set(input.data)
        .where(
          and(
            eq(todosTable.id, input.id),
            arrayContains(todosTable.user_ids, [ctx.session.user.id])
          )
        )
        .returning()

      if (!updatedItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Todo not found or you do not have permission to update it",
        })
      }

      return updatedItem
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [deletedItem] = await ctx.db
        .delete(todosTable)
        .where(
          and(
            eq(todosTable.id, input.id),
            arrayContains(todosTable.user_ids, [ctx.session.user.id])
          )
        )
        .returning()

      if (!deletedItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Todo not found or you do not have permission to delete it",
        })
      }

      return deletedItem
    }),
})
