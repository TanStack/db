import {createFileRoute} from '@tanstack/react-router'
import {useEffect,useState} from 'react'
import {DbClient} from '@tanstack/db'
import {DbProvider} from '@tanstack/react-db'
import {TodoApp} from '../endpoint'
export const Route=createFileRoute('/')({component:Page})
function Page(){
 const [client,setClient]=useState<DbClient|null>(null)
 useEffect(()=>{setClient(new DbClient({endpointScope:new URLSearchParams(location.search).get('scope')==='bob'?'bob':'alice'}))},[])
 return client?<DbProvider client={client}><TodoApp/></DbProvider>:<p>Opening notebook…</p>
}
