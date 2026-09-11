import {createFileRoute} from '@tanstack/react-router'
import {control,evidence} from '../database.server'
export const Route=createFileRoute('/probe-control')({server:{handlers:{
 POST:async({request})=>Response.json(await control(await request.json())),
 GET:async()=>Response.json(await evidence()),
}}})
