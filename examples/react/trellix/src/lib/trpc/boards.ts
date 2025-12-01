import { router, authedProcedure } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { eq, and } from "drizzle-orm"
import {
  boardsTable,
  createBoardSchema,
  updateBoardSchema,
} from "@/db/schema"

export const boardsRouter = router({
  getAll: authedProcedure.query(async ({ ctx }) => {
    const boards = await ctx.db
      .select()
      .from(boardsTable)
      .where(eq(boardsTable.ownerId, ctx.session.user.id))
    return boards
  }),

  getById: authedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const [board] = await ctx.db
        .select()
        .from(boardsTable)
        .where(
          and(
            eq(boardsTable.id, input.id),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )

      if (!board) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found",
        })
      }

      return board
    }),

  create: authedProcedure
    .input(createBoardSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.ownerId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only create boards you own",
        })
      }

      const [newBoard] = await ctx.db
        .insert(boardsTable)
        .values(input)
        .returning()

      return newBoard
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.number(),
        data: updateBoardSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updatedBoard] = await ctx.db
        .update(boardsTable)
        .set(input.data)
        .where(
          and(
            eq(boardsTable.id, input.id),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )
        .returning()

      if (!updatedBoard) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found or you do not have permission to update it",
        })
      }

      return updatedBoard
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [deletedBoard] = await ctx.db
        .delete(boardsTable)
        .where(
          and(
            eq(boardsTable.id, input.id),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )
        .returning()

      if (!deletedBoard) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found or you do not have permission to delete it",
        })
      }

      return deletedBoard
    }),
})
