import { router, authedProcedure } from "@/lib/trpc"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { eq, and, sql } from "drizzle-orm"
import {
  projectsTable,
  createProjectSchema,
  updateProjectSchema,
} from "@/db/schema"

export const projectsRouter = router({
  getAll: authedProcedure.query(async ({ ctx }) => {
    const projects = await ctx.db
      .select()
      .from(projectsTable)
      .where(
        sql`owner_id = ${ctx.session.user.id} OR ${ctx.session.user.id} = ANY(shared_user_ids)`
      )
    return projects
  }),

  create: authedProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.owner_id !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only create projects you own",
        })
      }

      const [newItem] = await ctx.db
        .insert(projectsTable)
        .values(input)
        .returning()

      return newItem
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.number(),
        data: updateProjectSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updatedItem] = await ctx.db
        .update(projectsTable)
        .set(input.data)
        .where(
          and(
            eq(projectsTable.id, input.id),
            eq(projectsTable.owner_id, ctx.session.user.id)
          )
        )
        .returning()

      if (!updatedItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Project not found or you do not have permission to update it",
        })
      }

      return updatedItem
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [deletedItem] = await ctx.db
        .delete(projectsTable)
        .where(
          and(
            eq(projectsTable.id, input.id),
            eq(projectsTable.owner_id, ctx.session.user.id)
          )
        )
        .returning()

      if (!deletedItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Project not found or you do not have permission to delete it",
        })
      }

      return deletedItem
    }),
})
