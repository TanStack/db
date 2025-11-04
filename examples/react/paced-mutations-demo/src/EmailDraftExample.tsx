import { useState } from "react"
import {
  createCollection,
  debounceStrategy,
  usePacedMutations,
} from "@tanstack/react-db"
import { z } from "zod"

// ============================================================================
// Zod Schema Definition with Discriminated Union
// ============================================================================

/**
 * Define a discriminated union schema for different email draft actions.
 * Each action has a unique 'action' field that acts as the discriminator.
 */
const emailMutationSchema = z.discriminatedUnion("action", [
  // Insert a new draft email
  z.object({
    action: z.literal("insert-draft"),
    id: z.string(),
    to: z.string().email("Invalid email address"),
    subject: z.string().min(1, "Subject is required"),
    body: z.string(),
  }),
  // Update the subject/title of an existing draft
  z.object({
    action: z.literal("update-title"),
    id: z.string(),
    subject: z.string().min(1, "Subject cannot be empty"),
  }),
  // Update the body of an existing draft
  z.object({
    action: z.literal("update-body"),
    id: z.string(),
    body: z.string(),
  }),
])

// Infer TypeScript type from the Zod schema
type EmailMutation = z.infer<typeof emailMutationSchema>

// ============================================================================
// Email Draft Data Model
// ============================================================================

interface EmailDraft {
  id: string
  to: string
  subject: string
  body: string
  updatedAt: number
}

// ============================================================================
// Create Collection for Email Drafts
// ============================================================================

const emailDraftsCollection = createCollection<EmailDraft>({
  id: "email-drafts",
  getKey: (draft) => draft.id,
})

// ============================================================================
// Email Draft Example Component
// ============================================================================

export function EmailDraftExample() {
  // Local state for the form inputs
  const [draftId] = useState("draft-1")
  const [to, setTo] = useState("user@example.com")
  const [subject, setSubject] = useState("Important Meeting")
  const [body, setBody] = useState("Hi there,\n\nLet's discuss...")

  // State for validation errors
  const [validationError, setValidationError] = useState<string | null>(null)

  // State for mutation tracking
  const [mutationLog, setMutationLog] = useState<
    Array<{ timestamp: number; action: string; status: string }>
  >([])

  /**
   * Create a paced mutation with debouncing and Zod validation.
   * This hook validates inputs before applying optimistic updates.
   */
  const debouncedMutateEmail = usePacedMutations<EmailMutation>({
    onMutate: (variables) => {
      // Validate the mutation input using Zod
      try {
        const validated = emailMutationSchema.parse(variables)
        setValidationError(null)

        // Log the mutation
        setMutationLog((prev) => [
          ...prev,
          {
            timestamp: Date.now(),
            action: validated.action,
            status: "pending",
          },
        ])

        // Apply optimistic update based on the action
        if (validated.action === "insert-draft") {
          emailDraftsCollection.insert({
            id: validated.id,
            to: validated.to,
            subject: validated.subject,
            body: validated.body,
            updatedAt: Date.now(),
          })
        } else if (validated.action === "update-title") {
          emailDraftsCollection.update(validated.id, (draft) => {
            draft.subject = validated.subject
            draft.updatedAt = Date.now()
          })
        } else if (validated.action === "update-body") {
          emailDraftsCollection.update(validated.id, (draft) => {
            draft.body = validated.body
            draft.updatedAt = Date.now()
          })
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errorMessage = error.errors.map((e) => e.message).join(", ")
          setValidationError(errorMessage)
          console.error("Validation error:", errorMessage)
        }
        throw error
      }
    },
    mutationFn: async ({ transaction }) => {
      // Simulate network delay for persisting to server
      await new Promise((resolve) => setTimeout(resolve, 500))

      // In a real app, you would send the mutations to your backend here
      console.log("Persisting mutations to server:", transaction.mutations)

      // Update mutation log to show completion
      setMutationLog((prev) =>
        prev.map((log, idx) =>
          idx === prev.length - 1 ? { ...log, status: "completed" } : log
        )
      )
    },
    strategy: debounceStrategy({ wait: 1000, trailing: true }),
  })

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleInsertDraft = () => {
    debouncedMutateEmail({
      action: "insert-draft",
      id: draftId,
      to,
      subject,
      body,
    })
  }

  const handleUpdateTitle = (newTitle: string) => {
    setSubject(newTitle)
    debouncedMutateEmail({
      action: "update-title",
      id: draftId,
      subject: newTitle,
    })
  }

  const handleUpdateBody = (newBody: string) => {
    setBody(newBody)
    debouncedMutateEmail({
      action: "update-body",
      id: draftId,
      body: newBody,
    })
  }

  // Get the current draft from the collection
  const currentDraft = emailDraftsCollection.get(draftId)

  return (
    <div className="email-draft-example">
      <h1>Email Draft Example with Zod Validation</h1>
      <p className="subtitle">
        This example demonstrates using <code>usePacedMutation</code> with Zod
        schema validation for different action types (discriminated union).
      </p>

      {/* Validation Error Display */}
      {validationError && (
        <div
          style={{
            padding: "12px",
            marginBottom: "20px",
            backgroundColor: "#fee",
            border: "1px solid #fcc",
            borderRadius: "4px",
            color: "#c33",
          }}
        >
          <strong>Validation Error:</strong> {validationError}
        </div>
      )}

      {/* Email Draft Form */}
      <div className="grid">
        <div className="panel">
          <h2>Email Draft Form</h2>

          <div className="control-group">
            <label>To:</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              style={{ width: "100%" }}
            />
          </div>

          <div className="control-group">
            <label>Subject:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => handleUpdateTitle(e.target.value)}
              placeholder="Email subject"
              style={{ width: "100%" }}
            />
            <small style={{ color: "#666" }}>
              Updates are debounced by 1000ms
            </small>
          </div>

          <div className="control-group">
            <label>Body:</label>
            <textarea
              value={body}
              onChange={(e) => handleUpdateBody(e.target.value)}
              placeholder="Email body..."
              rows={8}
              style={{ width: "100%", fontFamily: "inherit" }}
            />
            <small style={{ color: "#666" }}>
              Updates are debounced by 1000ms
            </small>
          </div>

          <button
            onClick={handleInsertDraft}
            style={{
              padding: "10px 20px",
              backgroundColor: "#0066cc",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Insert/Update Draft
          </button>

          <div style={{ marginTop: "20px", fontSize: "13px" }}>
            <h3 style={{ fontSize: "14px", marginBottom: "8px" }}>
              How it works:
            </h3>
            <ul style={{ paddingLeft: "20px", lineHeight: "1.6" }}>
              <li>
                <strong>Zod Validation:</strong> Each mutation is validated
                using a discriminated union schema before being applied.
              </li>
              <li>
                <strong>Type Safety:</strong> TypeScript ensures you pass the
                correct fields for each action type.
              </li>
              <li>
                <strong>Debouncing:</strong> Changes to subject and body are
                debounced with a 1000ms wait time.
              </li>
              <li>
                <strong>Optimistic Updates:</strong> The UI updates immediately
                while the server request is in flight.
              </li>
            </ul>
          </div>
        </div>

        <div className="panel">
          <h2>Current Draft State</h2>

          {currentDraft ? (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#f5f5f5",
                borderRadius: "4px",
                fontFamily: "monospace",
                fontSize: "12px",
              }}
            >
              <div>
                <strong>ID:</strong> {currentDraft.id}
              </div>
              <div>
                <strong>To:</strong> {currentDraft.to}
              </div>
              <div>
                <strong>Subject:</strong> {currentDraft.subject}
              </div>
              <div>
                <strong>Body:</strong>
              </div>
              <pre
                style={{
                  marginTop: "8px",
                  padding: "8px",
                  backgroundColor: "white",
                  borderRadius: "4px",
                  whiteSpace: "pre-wrap",
                }}
              >
                {currentDraft.body}
              </pre>
              <div style={{ marginTop: "8px" }}>
                <strong>Last Updated:</strong>{" "}
                {new Date(currentDraft.updatedAt).toLocaleTimeString()}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              No draft created yet. Click "Insert/Update Draft" to create one.
            </div>
          )}

          <h2 style={{ marginTop: "30px" }}>Mutation Log</h2>

          {mutationLog.length === 0 ? (
            <div className="empty-state">No mutations yet</div>
          ) : (
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              {[...mutationLog].reverse().map((log, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "8px",
                    marginBottom: "8px",
                    backgroundColor:
                      log.status === "completed" ? "#efe" : "#ffa",
                    borderRadius: "4px",
                    fontSize: "12px",
                  }}
                >
                  <div>
                    <strong>Action:</strong> {log.action}
                  </div>
                  <div>
                    <strong>Status:</strong> {log.status}
                  </div>
                  <div>
                    <strong>Time:</strong>{" "}
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Code Example Display */}
      <div className="panel" style={{ marginTop: "20px" }}>
        <h2>Example Usage Code</h2>
        <pre
          style={{
            padding: "16px",
            backgroundColor: "#282c34",
            color: "#abb2bf",
            borderRadius: "4px",
            overflowX: "auto",
            fontSize: "13px",
            lineHeight: "1.5",
          }}
        >
          {`// Define Zod schema with discriminated union
const emailMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("insert-draft"),
    id: z.string(),
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string(),
  }),
  z.object({
    action: z.literal("update-title"),
    id: z.string(),
    subject: z.string().min(1),
  }),
  z.object({
    action: z.literal("update-body"),
    id: z.string(),
    body: z.string(),
  }),
])

type EmailMutation = z.infer<typeof emailMutationSchema>

// Use with usePacedMutations
const debouncedMutateEmail = usePacedMutations<EmailMutation>({
  onMutate: (variables) => {
    // Validate with Zod
    const validated = emailMutationSchema.parse(variables)

    // Apply optimistic updates based on action
    if (validated.action === "insert-draft") {
      collection.insert({ ...validated })
    } else if (validated.action === "update-title") {
      collection.update(validated.id, draft => {
        draft.subject = validated.subject
      })
    } else if (validated.action === "update-body") {
      collection.update(validated.id, draft => {
        draft.body = validated.body
      })
    }
  },
  mutationFn: async ({ transaction }) => {
    // Persist to server
    await api.syncMutations(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 1000 }),
})

// Call with type-safe actions
debouncedMutateEmail({
  action: 'insert-draft',
  id: 'draft-1',
  to: 'user@example.com',
  subject: 'Hello',
  body: 'World'
})

debouncedMutateEmail({
  action: 'update-title',
  id: 'draft-1',
  subject: 'Updated subject'
})

debouncedMutateEmail({
  action: 'update-body',
  id: 'draft-1',
  body: 'Updated body'
})`}
        </pre>
      </div>
    </div>
  )
}
