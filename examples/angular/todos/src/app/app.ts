import { Component } from '@angular/core';
import { injectLiveQuery } from '@tanstack/angular-db';
import { eq } from '@tanstack/db';
import { todosCollection } from '../collections/todos-collection';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, CommonModule],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div class="container mx-auto px-4 py-8 max-w-2xl">
        <!-- Header -->
        <div class="text-center mb-8">
          <h1 class="text-4xl font-bold text-gray-800 mb-2">Todo App</h1>
          <p class="text-gray-600">Stay organized and productive</p>
        </div>

        <!-- Add Todo Form -->
        <div class="bg-white rounded-xl shadow-lg p-6 mb-8">
          <form (ngSubmit)="addTodo()" class="flex gap-3">
            <input
              [(ngModel)]="newTodoText"
              name="newTodo"
              type="text"
              placeholder="What needs to be done?"
              class="flex-1 px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              required
            />
            <button
              type="submit"
              [disabled]="!newTodoText.trim()"
              class="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
            >
              Add
            </button>
          </form>
        </div>

        <!-- Todos List -->
        <div class="bg-white rounded-xl shadow-lg overflow-hidden">
          @if (todoQuery.isReady()) {
            @if (todoQuery.data().length === 0) {
              <div class="p-8 text-center text-gray-500">
                <div class="text-6xl mb-4">📝</div>
                <p class="text-lg">No todos yet. Add one above to get started!</p>
              </div>
            } @else {
              <div class="divide-y divide-gray-100">
                @for (todo of todoQuery.data(); track todo.id) {
                  <div class="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                    <!-- Complete Button -->
                    <button
                      (click)="toggleTodo(todo.id)"
                      [class]="
                        todo.completed
                          ? 'w-6 h-6 rounded-full bg-blue-600 border-2 border-blue-600 flex items-center justify-center text-white'
                          : 'w-6 h-6 rounded-full border-2 border-gray-300 hover:border-blue-500 transition-colors'
                      "
                    >
                      @if (todo.completed) {
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fill-rule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      }
                    </button>

                    <!-- Todo Text -->
                    <span
                      [class]="
                        todo.completed
                          ? 'flex-1 text-gray-500 line-through'
                          : 'flex-1 text-gray-800'
                      "
                    >
                      {{ todo.text }}
                    </span>

                    <!-- Delete Button -->
                    <button
                      (click)="deleteTodo(todo.id)"
                      class="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                }
              </div>
            }

            <!-- Stats -->
            <div class="bg-gray-50 px-4 py-3 text-sm text-gray-600 border-t">
              {{ getCompletedCount() }} of {{ todoQuery.data().length }} completed
            </div>
          } @else {
            <div class="p-8 text-center">
              <div
                class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
              ></div>
              <p class="mt-2 text-gray-500">Loading todos...</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class App {
  todoQuery = injectLiveQuery((q) =>
    q.from({ todo: todosCollection }).where(({ todo }) => eq(todo.completed, false)),
  );
  newTodoText = '';

  addTodo() {
    if (!this.newTodoText.trim()) return;

    const newTodo = {
      id: Date.now(),
      text: this.newTodoText.trim(),
      completed: false,
      created_at: new Date(),
    };

    todosCollection.insert(newTodo);
    this.newTodoText = '';
  }

  toggleTodo(id: number) {
    todosCollection.update(id, (draft: any) => {
      draft.completed = !draft.completed;
    });
  }

  deleteTodo(id: number) {
    todosCollection.delete(id);
  }

  getCompletedCount(): number {
    return this.todoQuery.data().filter((todo) => todo.completed).length;
  }
}
