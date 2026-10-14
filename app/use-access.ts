"use client";
import {useEffect,useState} from 'react';
export function useAccess(){
 const [access,setAccess]=useState<{loaded:boolean;manager:boolean;rdWrite:boolean}>({loaded:false,manager:false,rdWrite:false});
 useEffect(()=>{let live=true;const refresh=()=>fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.json()).then(value=>{const data=value as {user?:{role?:string};capabilities?:{rd?:boolean}};if(live)setAccess({loaded:true,manager:data.user?.role==='manager',rdWrite:data.capabilities?.rd===true});}).catch(()=>{if(live)setAccess({loaded:true,manager:false,rdWrite:false});});refresh();const timer=setInterval(refresh,60000);return()=>{live=false;clearInterval(timer);};},[]);
 return access;
}
