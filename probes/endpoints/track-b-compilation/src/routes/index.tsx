import {createFileRoute} from '@tanstack/react-router'
import {useState,useEffect} from 'react'
import {addTodo} from '../endpoint'
export const Route=createFileRoute('/')({component:Page})
function Page(){
 useEffect(()=>{document.body.dataset.ready='true'},[])
 const [optimistic,setOptimistic]=useState('');const [result,setResult]=useState('')
 return <main><button onClick={async()=>{setOptimistic(addTodo.onMutate({text:'test'}));setResult(JSON.stringify(await addTodo({text:'test'})))}}>Run</button><output id="optimistic">{optimistic}</output><output id="result">{result}</output></main>
}
