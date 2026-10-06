"use client";
import {useEffect,useState} from 'react';
export function useAccess(){
 const [access,setAccess]=useState<{loaded:boolean;manager:boolean}>({loaded:false,manager:false});
 useEffect(()=>{let live=true;const refresh=()=>fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.json()).then(value=>{const data=value as {capabilities?:{payroll?:boolean}};if(live)setAccess({loaded:true,manager:data.capabilities?.payroll===true});}).catch(()=>{if(live)setAccess({loaded:true,manager:false});});refresh();const timer=setInterval(refresh,60000);return()=>{live=false;clearInterval(timer);};},[]);
 return access;
}
