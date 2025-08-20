import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
  created_at: Date;
}

export const todosCollection = createCollection(
  localOnlyCollectionOptions<Todo>({
    getKey: (todo: Todo) => todo.id,
    initialData: [
      {
        id: 1,
        text: 'Learn Angular',
        completed: false,
        created_at: new Date(),
      },
      {
        id: 2,
        text: 'Build Todo App',
        completed: false,
        created_at: new Date(),
      },
    ],
  }),
);
