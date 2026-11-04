'use strict';
// Compact QC insights. All totals originate from the authenticated QC-only API.
(() => {
  const root=document.querySelector('.qc-insights');
  if(!root)return;
  const el={
    range:root.querySelector('#qcInsightsRange'),
    reviewer:root.querySelector('#qcInsightsReviewer'),
    refresh:root.querySelector('#qcInsightsRefresh'),
    stats:root.querySelector('#qcInsightsStats'),
    chart:root.querySelector('#qcInsightsChart'),
    span:root.querySelector('#qcInsightsDateSpan'),
    people:root.querySelector('#qcInsightsReviewers'),
    status:root.querySelector('#qcInsightsStatus')
  };
  const NS='http://www.w3.org/2000/svg';
  const COLORS={
    total:['#0759a6','#e9f3ff'],uniqueCases:['#3944a8','#edf0ff'],
    approved:['#147a58','#e9f8f0'],averageScore:['#7137b6','#f5edff'],
    coaching:['#976213','#fff5dc'],flagged:['#b53e3e','#fff0ee']
  };
  let current=null,busy=false;
  function node(tag,className,value){
    const n=document.createElement(tag);
    if(className)n.className=className;
    if(value!==undefined)n.textContent=String(value);
    return n;
  }
  function element(tag,attrs={}){
    const n=document.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));
    return n;
  }
  const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString();
  function cube(key,label,value){
    const n=node('div','qc-insights-cube');
    const palette=COLORS[key];
    n.style.setProperty('--qc-cube-ink',palette[0]);
    n.style.setProperty('--qc-cube-bg',palette[1]);
    n.append(node('strong','',key==='averageScore'
      ? value===null?'—':fmt(value)+'%'
      : fmt(value)));
    n.append(node('small','',label));
    return n;
  }
  function drawStats(data){
    el.stats.replaceChildren(
      cube('total','Evaluations',data.totals.total),
      cube('uniqueCases','Unique cases',data.totals.uniqueCases),
      cube('approved','Approved',data.totals.approved),
      cube('averageScore','Avg. score',data.totals.averageScore)
    );
  }
  function drawTrend(data){
    el.chart.replaceChildren();
    const values=data.daily.map(day=>day.total||0);
    const max=Math.max(1,...values);
    const width=560,height=98,left=7,right=7,top=13,bottom=13;
    const usableWidth=width-left-right, usableHeight=height-top-bottom;
    const space=usableWidth/Math.max(1,values.length);
    const barWidth=Math.max(2,Math.min(17,space*.62));
    const lead=element('line',{x1:left,y1:height-bottom,x2:width-right,y2:height-bottom,stroke:'#e5eaf3','stroke-width':'1'});
    el.chart.append(lead);
    values.forEach((value,index)=>{
      const barH=Math.max(1,usableHeight*value/max);
      const rect=element('rect',{
        x:left+index*space+space/2-barWidth/2,
        y:height-bottom-barH,
        width:barWidth,height:barH,rx:Math.min(3,barWidth/3),
        fill:'var(--cricket-accent,#2563eb)'
      });
      const title=element('title');
      title.textContent=data.daily[index].date+' · '+fmt(value)+' evaluations';
      rect.append(title);
      el.chart.append(rect);
    });
    el.span.textContent=data.range.from+' – '+data.range.to;
  }
  function drawReviewers(data){
    el.people.replaceChildren();
    const reviewers=data.byReviewer.filter(person=>person.total>0);
    if(!reviewers.length){
      el.people.append(node('p','qc-insights-empty','No QC evaluations recorded for this period.'));
      return;
    }
    for(const person of reviewers.slice(0,8)){
      const row=node('div','qc-insights-person');
      row.append(node('span','qc-insights-person-name',person.name));
      const figures=node('div','qc-insights-mini-cubes');
      figures.append(
        cube('total','Total',person.total),
        cube('approved','Pass',person.approved),
        cube('coaching','Coach',person.coaching),
        cube('flagged','Flag',person.flagged)
      );
      row.append(figures);
      el.people.append(row);
    }
    if(reviewers.length>8)el.people.append(node('small','qc-insights-more','Showing the top 8 reviewers for this filter.'));
  }
  function updateReviewerOptions(data){
    const previous=el.reviewer.value;
    el.reviewer.replaceChildren();
    const all=node('option','','All reviewers');all.value='';el.reviewer.append(all);
    for(const person of data.options.reviewers){
      const option=node('option','',person.name);option.value=String(person.id);el.reviewer.append(option);
    }
    el.reviewer.value=previous;
    if(el.reviewer.value!==previous && previous)el.reviewer.value='';
  }
  async function load(){
    if(document.hidden||busy)return;
    busy=true;el.refresh.disabled=true;el.status.textContent='Updating QC statistics…';
    const params=new URLSearchParams({range:el.range.value});
    if(el.reviewer.value)params.set('reviewerId',el.reviewer.value);
    try{
      const response=await fetch('/api/analytics/qc?'+params,{credentials:'same-origin'});
      if(response.status===401){window.CricketSession?.expire('idle');return;}
      if(response.status===403){root.hidden=true;return;}
      if(!response.ok)throw Error('QC statistics could not be loaded.');
      const data=await response.json();
      if(data.kind!=='qc')throw Error('Unexpected analytics response.');
      current=data;
      updateReviewerOptions(data);drawStats(data);drawTrend(data);drawReviewers(data);
      el.status.textContent='Updated '+new Date(data.generatedAt).toLocaleTimeString()+' · Evaluations, not calls handled · Soft-deleted cases excluded.';
    }catch(error){
      el.status.textContent=error.message;
    }finally{busy=false;el.refresh.disabled=false;}
  }
  el.range.addEventListener('change',load);
  el.reviewer.addEventListener('change',load);
  el.refresh.addEventListener('click',load);
  window.addEventListener('cricket-qc-refresh',()=>void load());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
  window.setInterval(()=>{if(!document.hidden)void load();},30000);
  void load();
})();
