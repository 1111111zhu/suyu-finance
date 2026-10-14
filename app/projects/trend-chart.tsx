"use client";

import { useEffect, useState } from "react";

export type MonthlyPoint = { month:string; total:number };

const money=(value:number)=>"¥"+value.toLocaleString("zh-CN",{maximumFractionDigits:0});

export function TrendChart({points,label="研发费用趋势"}:{points:MonthlyPoint[];label?:string}){
  const rows=points.slice(-12);
  if(!rows.length)return <div className="rd-trend-empty">确认月度测算后，这里会显示费用变化。</div>;
  const width=720,height=220,pad={top:30,right:24,bottom:36,left:76};
  const chartWidth=width-pad.left-pad.right,chartHeight=height-pad.top-pad.bottom;
  const cumulative:number[]=[];rows.reduce((sum,item,index)=>{const next=sum+item.total;cumulative[index]=next;return next;},0);
  const values=[0,...rows.map(item=>item.total),...cumulative];
  const min=Math.min(0,...values),peak=Math.max(1,...values);
  const magnitude=10**Math.floor(Math.log10(peak));
  const max=Math.ceil(peak/(magnitude/2))*(magnitude/2),range=max-min||1;
  const y=(value:number)=>pad.top+(max-value)/range*chartHeight;
  const slot=chartWidth/rows.length,barWidth=Math.min(48,Math.max(8,slot*.42)),zeroY=y(0);
  const linePoints=cumulative.map((value,index)=>`${pad.left+slot*index+slot/2},${y(value)}`).join(" ");
  const grid=[0,.25,.5,.75,1].map(ratio=>min+(max-min)*ratio);
  return <div className="rd-trend-wrap">
    <svg className="rd-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <title>{label}</title>
      {grid.map((value,index)=><g key={index}><line className="rd-trend-grid" x1={pad.left} x2={width-pad.right} y1={y(value)} y2={y(value)}/><text className="rd-trend-tick" x={pad.left-10} y={y(value)+4} textAnchor="end">{money(value)}</text></g>)}
      <line className="rd-trend-zero" x1={pad.left} x2={width-pad.right} y1={zeroY} y2={zeroY}/>
      {rows.map((point,index)=>{
        const barValue=point.total,barY=barValue>=0?y(barValue):zeroY,barHeight=Math.max(1,Math.abs(y(barValue)-zeroY));
        return <g key={point.month}><rect className="rd-trend-bar" x={pad.left+slot*index+(slot-barWidth)/2} y={barY} width={barWidth} height={barHeight} rx="4"><title>{point.month} 当月 {money(barValue)}</title></rect><text className="rd-trend-month" x={pad.left+slot*index+slot/2} y={height-10} textAnchor="middle">{point.month.replace("-", ".")}月</text></g>;
      })}
      <polyline className="rd-trend-line" points={linePoints}/>
      {rows.length===1&&<text className="rd-trend-value" x={pad.left+slot/2} y={y(cumulative[0])-12} textAnchor="middle">{money(cumulative[0])}</text>}
      {cumulative.map((value,index)=><circle className="rd-trend-point" key={rows[index].month} cx={pad.left+slot*index+slot/2} cy={y(value)} r="4"><title>{rows[index].month} 累计 {money(value)}</title></circle>)}
    </svg>
    <div className="rd-trend-legend"><span><i className="rd-trend-legend-bar"/>当月费用</span><span><i className="rd-trend-legend-line"/>累计费用</span></div>
  </div>;
}

export function AnimatedAmount({value}:{value:number}){
  const [displayed,setDisplayed]=useState(0);
  useEffect(()=>{
    const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(reduce){setDisplayed(value);return;}
    const from=displayed,start=performance.now(),duration=650;
    let frame=0;
    const animate=(now:number)=>{const progress=Math.min(1,(now-start)/duration),eased=1-Math.pow(1-progress,3);setDisplayed(from+(value-from)*eased);if(progress<1)frame=requestAnimationFrame(animate);};
    frame=requestAnimationFrame(animate);
    return()=>cancelAnimationFrame(frame);
  },[value]);
  return <span className="rd-animated-amount">{money(displayed)}</span>;
}
