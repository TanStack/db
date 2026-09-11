import { parse } from '@babel/parser'
import MagicString from 'magic-string'

// Explicit test-mode instrumentation for this fixture, before endpoint lifting.
export function todoTestHarness() {
  return {
    name: 'todo-browser-test-harness',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/endpoint.tsx')) return
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
      const component = ast.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'TodoApp')?.declaration
      const declaration = component?.body.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0]?.id.name === 'addTodo')
      if (!declaration) throw Error('Todo harness could not find bound mutation')
      const output = new MagicString(code)
      output.prepend("import {useTodoProbe as __testTodoProbe} from '../tests/browser-harness';\n")
      output.appendLeft(declaration.end, '\n__testTodoProbe(dbClient,listTodos,addTodo);\n')
      return { code: output.toString(), map: output.generateMap({ hires: true, source: id, includeContent: true }) }
    },
  }
}
