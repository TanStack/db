import { router, authedProcedure } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { eq, and } from "drizzle-orm"
import {
  columnsTable,
  boardsTable,
  createColumnSchema,
  updateColumnSchema,
} from "@/db/schema"

export const columnsRouter = router({
  getByBoardId: authedProcedure
    .input(z.object({ boardId: z.number() }))
    .query(async ({ ctx, input }) => {
      // First verify user owns the board
      const [board] = await ctx.db
        .select()
        .from(boardsTable)
        .where(
          and(
            eq(boardsTable.id, input.boardId),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )

      if (!board) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found",
        })
      }

      const columns = await ctx.db
        .select()
        .from(columnsTable)
        .where(eq(columnsTable.boardId, input.boardId))

      return columns
    }),

  create: authedProcedure
    .input(createColumnSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify user owns the board
      const [board] = await ctx.db
        .select()
        .from(boardsTable)
        .where(
          and(
            eq(boardsTable.id, input.boardId),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )

      if (!board) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to add columns to this board",
        })
      }

      const [newColumn] = await ctx.db
        .insert(columnsTable)
        .values(input)
        .returning()

      return newColumn
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateColumnSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get column to verify board ownership
      const [column] = await ctx.db
        .select()
        .from(columnsTable)
        .where(eq(columnsTable.id, input.id))

      if (!column) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Column not found",
        })
      }

      // Verify user owns the board
      const [board] = await ctx.db
        .select()
        .from(boardsTable)
        .where(
          and(
            eq(boardsTable.id, column.boardId),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )

      if (!board) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to update this column",
        })
      }

      const [updatedColumn] = await ctx.db
        .update(columnsTable)
        .set(input.data)
        .where(eq(columnsTable.id, input.id))
        .returning()

      return updatedColumn
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get column to verify board ownership
      const [column] = await ctx.db
        .select()
        .from(columnsTable)
        .where(eq(columnsTable.id, input.id))

      if (!column) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Column not found",
        })
      }

      // Verify user owns the board
      const [board] = await ctx.db
        .select()
        .from(boardsTable)
        .where(
          and(
            eq(boardsTable.id, column.boardId),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )

      if (!board) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to delete this column",
        })
      }

      const [deletedColumn] = await ctx.db
        .delete(columnsTable)
        .where(eq(columnsTable.id, input.id))
        .returning()

      return deletedColumn
    }),
})
