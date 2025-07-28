import { createFileRoute } from "@tanstack/react-router"
import { TodoApp } from "../components/TodoApp"
import {
  firebaseTodoCollection,
  firebaseConfigCollection,
} from "../lib/collections"

export const Route = createFileRoute("/firebase")({
  component: Firebase,
})

function Firebase() {
  return (
    <TodoApp
      todoCollection={firebaseTodoCollection}
      configCollection={firebaseConfigCollection}
      type="Firebase"
    />
  )
}
