import { router, authedProcedure } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { eq, and } from "drizzle-orm"
import {
  itemsTable,
  boardsTable,
  createItemSchema,
  updateItemSchema,
} from "@/db/schema"

export const itemsRouter = router({
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

      const items = await ctx.db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.boardId, input.boardId))

      return items
    }),

  create: authedProcedure
    .input(createItemSchema)
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
          message: "You do not have permission to add items to this board",
        })
      }

      const [newItem] = await ctx.db
        .insert(itemsTable)
        .values(input)
        .returning()

      return newItem
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateItemSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get item to verify board ownership
      const [item] = await ctx.db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.id, input.id))

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item not found",
        })
      }

      // Verify user owns the board
      const [board] = await ctx.db
        .select()
        .from(boardsTable)
        .where(
          and(
            eq(boardsTable.id, item.boardId),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )

      if (!board) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to update this item",
        })
      }

      const [updatedItem] = await ctx.db
        .update(itemsTable)
        .set(input.data)
        .where(eq(itemsTable.id, input.id))
        .returning()

      return updatedItem
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get item to verify board ownership
      const [item] = await ctx.db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.id, input.id))

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item not found",
        })
      }

      // Verify user owns the board
      const [board] = await ctx.db
        .select()
        .from(boardsTable)
        .where(
          and(
            eq(boardsTable.id, item.boardId),
            eq(boardsTable.ownerId, ctx.session.user.id)
          )
        )

      if (!board) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to delete this item",
        })
      }

      const [deletedItem] = await ctx.db
        .delete(itemsTable)
        .where(eq(itemsTable.id, input.id))
        .returning()

      return deletedItem
    }),

  // Upsert for optimistic drag-and-drop operations
  upsert: authedProcedure
    .input(createItemSchema)
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
          message: "You do not have permission to modify items on this board",
        })
      }

      // Check if item exists
      const [existingItem] = await ctx.db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.id, input.id))

      if (existingItem) {
        // Update existing item
        const [updatedItem] = await ctx.db
          .update(itemsTable)
          .set({
            title: input.title,
            content: input.content,
            order: input.order,
            columnId: input.columnId,
          })
          .where(eq(itemsTable.id, input.id))
          .returning()

        return updatedItem
      } else {
        // Create new item
        const [newItem] = await ctx.db
          .insert(itemsTable)
          .values(input)
          .returning()

        return newItem
      }
    }),
})
