import {addTodo} from '../src/endpoint'
addTodo({text:'ok'})
// @ts-expect-error input text must be a string
addTodo({text:42})
// @ts-expect-error unknown property is not accepted
addTodo({wrong:'x'})
async function resultType(){const result=await addTodo({text:'x'});const text:string=result.text;return text}
