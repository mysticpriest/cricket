'use strict';
// Cricket Analytics: accessible, animated SVG graphs. No external chart service.
const A={
  account:document.querySelector('#analyticsAccount'),
  status:document.querySelector('#analyticsLiveStatus'),
  refresh:document.querySelector('#analyticsRefresh'),
  clear:document.querySelector('#analyticsClearFilters'),
  filters:document.querySelector('#analyticsFilters'),
  presets:Array.from(document.querySelectorAll('[data-range]')),
  dates:document.querySelector('#analyticsCustomDates'),
  from:document.querySelector('#analyticsFrom'),to:document.querySelector('#analyticsTo'),
  employee:document.querySelector('#analyticsEmployee'),
  employeeLabel:document.querySelector('#employeeFilterLabel'),
  departmentField:document.querySelector('#analyticsDepartmentField'),
  department:document.querySelector('#analyticsDepartment'),
  outcomeLabel:document.querySelector('#outcomeFilterLabel'),
  outcome:document.querySelector('#analyticsOutcome'),
  error:document.querySelector('#analyticsFilterError'),
  scopeLabel:document.querySelector('#analyticsScopeLabel'),
  scopeTitle:document.querySelector('#analyticsScopeTitle'),
  scopeCaption:document.querySelector('#analyticsScopeCaption'),
  stats:document.querySelector('#analyticsStats'),
  chartTitle:document.querySelector('#analyticsChartTitle'),
  chartSubtitle:document.querySelector('#analyticsChartSubtitle'),
  lineView:document.querySelector('#analyticsLineView'),
  barView:document.querySelector('#analyticsBarView'),
  metrics:document.querySelector('#analyticsMetrics'),
  chart:document.querySelector('#analyticsTrendSvg'),
  tooltip:document.querySelector('#analyticsGraphTooltip'),
  dayDetail:document.querySelector('#analyticsDayDetail'),
  donut:document.querySelector('#analyticsDonut'),
  legend:document.querySelector('#analyticsLegend'),
  breakdownTitle:document.querySelector('#analyticsBreakdownTitle'),
  breakdownCaption:document.querySelector('#analyticsBreakdownCaption'),
  breakdownNote:document.querySelector('#analyticsBreakdownNote'),
  leaderTitle:document.querySelector('#analyticsLeaderboardTitle'),
  leaderCaption:document.querySelector('#analyticsLeaderboardCaption'),
  teamSearch:document.querySelector('#analyticsTeamSearch'),
  cubeRows:document.querySelector('#analyticsAgentCubes'),
  updated:document.querySelector('#analyticsUpdatedAt')
};
const state={
  role:null,mode:'agents',range:'7',from:'',to:'',agentId:'',reviewerId:'',
  department:'all',outcome:'all',decision:'all',view:'line',metric:'total',
  sort:'total',descending:true,selectedDay:null,data:null,request:0,loading:false
};
const NS='http://www.w3.org/2000/svg';
const PALETTE={total:'#2563eb',inbound:'#2563eb',outbound:'#8b5cf6',other:'#94a3b8',
  resolved:'#16a34a',pending:'#f59e0b',approved:'#10b981',coaching:'#f59e0b',flagged:'#ef4444'};
const AGENT_METRICS=[['total','All calls'],['inbound','Inbound'],['outbound','Outbound'],['resolved','Resolved'],['pending','Pending']];
const QC_METRICS=[['total','All reviews'],['approved','Approved'],['coaching','Coaching'],['flagged','Flagged']];
const STAT_INFO={
  agents:[
    ['total','Documented calls','Saved case records','▤'],
    ['inbound','Inbound cases','Saved Inbound documentation','↙'],
    ['outbound','Outbound cases','Only recorded Outbound cases','↗'],
    ['resolved','Resolved calls','Cases marked resolved','✓'],
    ['activeAgents','Contributing agents','Agents with cases in range','♙']
  ],
  qc:[
    ['total','QC evaluations','Submitted review records','◎'],
    ['uniqueCases','Unique cases reviewed','Distinct cases evaluated','▤'],
    ['approved','Approved reviews','Decision: approved','✓'],
    ['averageScore','Average QC score','Average evaluation percentage','%'],
    ['activeReviewers','Active reviewers','Reviewers with evaluations','♙']
  ]
};
function elt(tag,klass,text){
  const e=document.createElement(tag);
  if(klass)e.className=klass;
  if(text!==undefined)e.textContent=String(text);
  return e;
}
function svg(tag,attrs={},text){
  const e=document.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attrs))e.setAttribute(key,String(value));
  if(text!==undefined)e.textContent=String(text);
  return e;
}
async function api(path){
  const response=await fetch(path,{credentials:'same-origin'});
  let data;
  try{data=await response.json();}
  catch(_){throw Error('The Cricket server is unavailable.');}
  if(response.status===401){location.replace('login.html?next=analytics.html');throw Error('Session expired. Sign in again.');}
  if(response.status===403)throw Error('Your account is not permitted to view these analytics.');
  if(!response.ok)throw Error(data.error||'Could not load analytics.');
  return data;
}
function utcDate(date){return new Date(date).toISOString().slice(0,10);}
function formatDate(date){
  const d=new Date(date+'T00:00:00Z');
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
}
function formatLongDate(date){
  const d=new Date(date+'T00:00:00Z');
  return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}
function number(value){return Number(value||0).toLocaleString();}
function chartPaletteColor(key){
  if(key==='total'||key==='inbound'){
    const theme=document.documentElement.dataset.cricketTheme;
    if(theme==='personal'){
      const color=getComputedStyle(document.documentElement).getPropertyValue('--cricket-accent').trim();
      if(/^#[0-9a-f]{6}$/i.test(color))return color;
    }
  }
  return PALETTE[key]||PALETTE.total;
}
function metricColor(){return chartPaletteColor(state.metric);}
function isQc(){return false;}
function metricChoices(){return isQc()?QC_METRICS:AGENT_METRICS;}
function activeLabel(){return metricChoices().find(x=>x[0]===state.metric)?.[1]||'Total';}
function setStatus(text,busy=false){
  A.status.replaceChildren(elt('span','an-online-dot'),document.createTextNode(' '+text));
  A.status.setAttribute('aria-busy',String(busy));
}
function defaultCustomRange(){
  const today=new Date();
  const start=new Date(today.getTime()-6*86400000);
  A.from.value=utcDate(start);
  A.to.value=utcDate(today);
  A.to.max=utcDate(today);
}
function renderPresetControls(){
  A.presets.forEach(button=>{
    const active=button.dataset.range===state.range;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  A.dates.hidden=state.range!=='custom';
}
function buildSelect(select,items,selected,empty){
  select.replaceChildren();
  const opt=elt('option','',empty);opt.value='';select.append(opt);
  for(const item of items){
    const el=elt('option','',item.name);
    el.value=String(item.id);
    select.append(el);
  }
  select.value=String(selected||'');
}
function changeMode() {
  state.mode='agents';
  state.metric='total';
  state.selectedDay=null;
  state.sort='total';state.descending=true;
  A.employeeLabel.textContent='Agent';
  A.departmentField.hidden=false;
  A.outcomeLabel.textContent='Resolution';
  A.outcome.replaceChildren();
  for(const [value,label] of [['all','All outcomes'],['resolved','Resolved'],['pending','Pending']]){
    const option=elt('option','',label);option.value=value;A.outcome.append(option);
  }
  A.outcome.value=state.outcome;
  A.employee.value=state.agentId;
  A.teamSearch.value='';
  A.error.textContent='';
  void load();
}
function applyFilters(){
  if(state.range==='custom'){
    if(!A.from.value||!A.to.value){
      A.error.textContent='Choose both dates for a custom range.';
      return;
    }
    const from=Date.parse(A.from.value+'T00:00:00Z');
    const to=Date.parse(A.to.value+'T00:00:00Z');
    const days=Math.round((to-from)/86400000)+1;
    if(!Number.isFinite(days)||days<1||days>366){
      A.error.textContent='Choose 1–366 days, with the start date before the end date.';
      return;
    }
    state.from=A.from.value;state.to=A.to.value;
  }
  state[isQc()?'reviewerId':'agentId']=A.employee.value;
  if(isQc())state.decision=A.outcome.value;
  else{state.department=A.department.value;state.outcome=A.outcome.value;}
  state.selectedDay=null;A.error.textContent='';
  void load();
}
function query(){
  const params=new URLSearchParams({range:state.range});
  if(state.range==='custom'){params.set('from',state.from);params.set('to',state.to);}
  if(state.agentId)params.set('agentId',state.agentId);
  params.set('department',state.department);
  params.set('outcome',state.outcome);
  return '/api/analytics/agents?'+params;
}
async function load(){
  const serial=++state.request;
  setStatus('Updating figures…',true);
  state.loading=true;A.refresh.disabled=true;
  try{
    const data=await api(query());
    if(serial!==state.request)return;
    state.data=data;
    A.error.textContent='';
    render(data);
    setStatus('Updated · '+new Date().toLocaleTimeString());
  }catch(error){
    if(serial!==state.request)return;
    A.error.textContent=error.message;
    setStatus('Could not refresh');
    if(!state.data){
      A.stats.replaceChildren(elt('p','an-table-empty',error.message));
      A.chart.replaceChildren();
    }
  }finally{
    if(serial===state.request){state.loading=false;A.refresh.disabled=false;}
  }
}
function drawStats(data){
  A.stats.replaceChildren();
  for(const [key,title,hint,icon] of STAT_INFO[state.mode]){
    const item=elt('article','an-stat-card');
    const head=elt('div','an-stat-head');
    head.append(elt('span','an-stat-title',title),elt('span','an-stat-icon',icon));
    let value=data.totals[key];
    if(key==='averageScore')value=value===null?'—':number(value)+'%';
    else value=number(value);
    item.append(head,elt('div','an-stat-value',value),elt('div','an-stat-helper',hint));
    A.stats.append(item);
  }
}
function renderMetricButtons(){
  A.metrics.replaceChildren();
  for(const [value,label] of metricChoices()){
    const button=elt('button','an-metric-button'+(state.metric===value?' active':''),label);
    button.type='button';
    button.setAttribute('aria-pressed',String(state.metric===value));
    button.addEventListener('click',()=>{
      if(value===state.metric)return;
      state.metric=value;
      renderMetricButtons();
      drawChart(state.data);
    });
    A.metrics.append(button);
  }
}
function tooltipFor(point,x,y){
  A.tooltip.replaceChildren(elt('strong','',formatLongDate(point.date)),
    elt('span','',activeLabel()+': '+number(point[state.metric])));
  A.tooltip.hidden=false;
  const rect=A.chart.getBoundingClientRect();
  const tooltipWidth=170;
  let left=x/920*rect.width+5;
  left=Math.min(Math.max(5,left),Math.max(5,rect.width-tooltipWidth));
  A.tooltip.style.left=left+'px';
  A.tooltip.style.top=Math.max(12,y/330*rect.height-53)+'px';
}
function detailFor(day){
  state.selectedDay=day.date;
  const pieces=isQc()?
    ['QC evaluations: '+number(day.total),'Approved: '+number(day.approved),'Coaching: '+number(day.coaching),'Flagged: '+number(day.flagged)]
    :['Documented calls: '+number(day.total),'Inbound: '+number(day.inbound),'Outbound: '+number(day.outbound),'Resolved: '+number(day.resolved),'Pending: '+number(day.pending)];
  A.dayDetail.textContent=formatLongDate(day.date)+' · '+pieces.join('  ·  ');
}
function drawChart(data){
  const days=data.daily;
  A.chart.replaceChildren();
  A.chart.setAttribute('aria-label',(isQc()?'QC evaluations':'Documented calls')+' by day, '+data.range.from+' to '+data.range.to);
  const width=920,height=330,left=47,right=17,top=24,bottom=42;
  const plotW=width-left-right,plotH=height-top-bottom;
  const values=days.map(item=>Number(item[state.metric])||0);
  const high=Math.max(1,...values);
  const yMax=Math.max(1,Math.ceil(high/4)*4);
  const x=i=>days.length===1?left+plotW/2:left+i*plotW/(days.length-1);
  const y=value=>top+plotH-plotH*value/yMax;
  for(let index=0;index<=4;index++){
    const numberAt=Math.round(yMax*index/4);
    const yy=yMax===0?top:y(numberAt);
    A.chart.append(svg('line',{x1:left,y1:yy,x2:width-right,y2:yy,class:'an-chart-grid'}));
    A.chart.append(svg('text',{x:left-11,y:yy+4,'text-anchor':'end',class:'an-chart-label'},number(numberAt)));
  }
  const step=Math.ceil(days.length/(days.length<=7?7:days.length<=30?8:10));
  for(let i=0;i<days.length;i++){
    if(i%step===0||i===days.length-1){
      A.chart.append(svg('text',{x:x(i),y:height-15,'text-anchor':'middle',class:'an-chart-label'},formatDate(days[i].date)));
    }
  }
  const valuesPath=days.map((d,i)=>(i?'L':'M')+x(i).toFixed(2)+','+y(values[i]).toFixed(2)).join(' ');
  const area=valuesPath+' L'+x(days.length-1)+','+(top+plotH)+' L'+x(0)+','+(top+plotH)+' Z';
  if(state.view==='line'){
    const defs=svg('defs');
    const grad=svg('linearGradient',{id:'anLineFill',x1:'0%',x2:'0%',y1:'0%',y2:'100%'});
    grad.append(svg('stop',{offset:'0%','stop-color':metricColor(),'stop-opacity':'.25'}));
    grad.append(svg('stop',{offset:'100%','stop-color':metricColor(),'stop-opacity':'.012'}));
    defs.append(grad);A.chart.append(defs);
    A.chart.append(svg('path',{d:area,class:'an-chart-area'}));
    const line=svg('path',{d:valuesPath,class:'an-chart-line',stroke:metricColor()});
    line.style.stroke=metricColor();
    A.chart.append(line);
    try{line.style.setProperty('--an-line-length',String(Math.ceil(line.getTotalLength()+10)));}catch(_){}
    line.classList.add('animated');
  }
  const spacing=days.length===1?80:Math.min(68,plotW/days.length);
  days.forEach((day,i)=>{
    const xx=x(i),yy=y(values[i]);
    if(state.view==='bar'){
      const h=Math.max(2,(top+plotH)-yy);
      const bar=svg('rect',{x:xx-spacing*.34,y:yy,width:spacing*.68,height:h,rx:Math.min(3,spacing*.1),class:'an-chart-bar',fill:metricColor()});
      bar.style.fill=metricColor();
      bar.style.animationDelay=Math.min(i*18,350)+'ms';
      A.chart.append(bar);
    }else if(days.length<=31){
      A.chart.append(svg('circle',{cx:xx,cy:yy,r:3.6,class:'an-chart-dot'}));
    }
    const rangeW=Math.max(7,days.length===1?80:Math.min(50,plotW/days.length));
    const hit=svg('rect',{x:xx-rangeW/2,y:top,width:rangeW,height:plotH,class:'an-chart-hit',
      tabindex:'0',role:'button','aria-label':formatLongDate(day.date)+': '+activeLabel()+' '+number(values[i])});
    const t=svg('title',{},formatLongDate(day.date)+', '+activeLabel()+': '+number(values[i]));
    hit.append(t);
    hit.addEventListener('pointerenter',()=>tooltipFor(day,xx,yy));
    hit.addEventListener('pointerleave',()=>{A.tooltip.hidden=true;});
    hit.addEventListener('focus',()=>tooltipFor(day,xx,yy));
    hit.addEventListener('blur',()=>{A.tooltip.hidden=true;});
    hit.addEventListener('click',()=>detailFor(day));
    hit.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();detailFor(day);}
    });
    A.chart.append(hit);
  });
  const day=days.find(x=>x.date===state.selectedDay);
  if(day)detailFor(day);
  else A.dayDetail.textContent='Select a day in the chart to inspect '+(isQc()?'review decisions':'call activity')+'.';
}
function drawDonut(data){
  const types=isQc()?[
    ['approved','Approved',data.totals.approved],
    ['coaching','Needs coaching',data.totals.coaching],
    ['flagged','Flagged',data.totals.flagged]
  ]:[
    ['inbound','Inbound',data.totals.inbound],
    ['outbound','Outbound',data.totals.outbound],
    ['other','Other / legacy',data.totals.other]
  ];
  A.donut.replaceChildren();A.legend.replaceChildren();
  const total=data.totals.total;
  const R=83,C=2*Math.PI*R;
  A.donut.append(svg('circle',{cx:120,cy:120,r:R,fill:'none',stroke:'#eef2f7','stroke-width':25}));
  let offset=0;
  for(const [key,label,value] of types){
    const fraction=total?value/total:0;
    const length=fraction*C;
    if(length){
      const arc=svg('circle',{cx:120,cy:120,r:R,class:'an-donut-ring an-donut-segment',
        stroke:chartPaletteColor(key), 'stroke-dasharray':length+' '+(C-length),
        'stroke-dashoffset':-offset,'aria-label':label+': '+number(value)});
      A.donut.append(arc);
    }
    offset+=length;
    const row=elt('button','an-legend-row');
    row.type='button';
    row.title='Filter by '+label;
    const bullet=elt('span','an-legend-bullet');bullet.style.background=chartPaletteColor(key);
    row.append(bullet,elt('span','an-legend-name',label),
      elt('span','an-legend-number',number(value)+' · '+(total?Math.round(value/total*100):0)+'%'));
    row.addEventListener('click',()=>{
      if(isQc()){A.outcome.value=key;}else{A.department.value=key;}
      applyFilters();
    });
    A.legend.append(row);
  }
  A.donut.append(svg('text',{x:120,y:117,class:'an-donut-center-number'},number(total)));
  A.donut.append(svg('text',{x:120,y:141,class:'an-donut-center-label'},isQc()?'EVALUATIONS':'CASES'));
  A.breakdownTitle.textContent=isQc()?'QC decision breakdown':'Call type breakdown';
  A.breakdownCaption.textContent='Click a category to filter the entire report.';
  A.breakdownNote.textContent=isQc()
    ? 'QC figures count submitted evaluations. One case may receive multiple evaluations.'
    : 'Outbound calls appear only when an actual Outbound case record exists. Outbound workflows are not implemented yet.';
}
const AGENT_COLORS={
  ocean:'#0759a6',violet:'#7137b6',emerald:'#147a58',rose:'#b91b65',
  amber:'#976213',teal:'#08777a',indigo:'#3944a8',coral:'#b74630'
};
const CUBE_METRICS=[
  ['total','Total','#0759a6','#e9f3ff'],
  ['inbound','Inbound','#3944a8','#edf0ff'],
  ['outbound','Outbound','#7137b6','#f5edff'],
  ['resolved','Resolved','#147a58','#e9f8f0'],
  ['pending','Pending','#976213','#fff5dc']
];
function createLeaderboard(data){
  const container=A.cubeRows;
  container.replaceChildren();
  const needle=A.teamSearch.value.trim().toLocaleLowerCase();
  const matching=data.byAgent.filter(row=>row.name.toLocaleLowerCase().includes(needle));
  if(!matching.length){
    container.append(elt('p','an-agent-cube-empty',needle?'No agents match that name.':'No agents available for this filter.'));
    return;
  }
  const max=Math.max(1,...matching.map(a=>a.total||0));
  for(const agent of matching){
    const row=elt('article','an-agent-cube-row');
    const identity=elt('div','an-agent-cube-name');
    const initials=elt('span','an-agent-cube-avatar',(agent.name||'A').slice(0,1).toUpperCase());
    initials.style.setProperty('--cube-employee-accent',AGENT_COLORS[agent.color]||AGENT_COLORS.ocean);
    const info=elt('div','an-agent-cube-identity');
    info.append(elt('strong','',agent.name),elt('span','',agent.total
      ? Math.round(agent.total/max*100)+'% of leading agent'
      : 'No documented calls in this period'));
    identity.append(initials,info);
    const cubes=elt('div','an-agent-cubes');
    for(const [key,label,color,background] of CUBE_METRICS){
      const cube=elt('div','an-agent-stat-cube');
      cube.setAttribute('aria-label',agent.name+' · '+label+': '+number(agent[key]));
      cube.style.setProperty('--cube-ink',color);
      cube.style.setProperty('--cube-bg',background);
      cube.append(elt('strong','',number(agent[key])),elt('small','',label));
      cubes.append(cube);
    }
    row.append(identity,cubes);
    container.append(row);
  }
}
function render(data){
  buildSelect(A.employee,data.options.agents,state.agentId,'All agents');
  A.employee.value=state.agentId;
  A.scopeLabel.textContent='AGENT PERFORMANCE';
  A.scopeTitle.textContent='Documented call analytics';
  A.scopeCaption.textContent='Track real Cricket case documentation, not unrecorded telephone calls.';
  A.chartTitle.textContent='Daily documented calls';
  A.chartSubtitle.textContent=formatDate(data.range.from)+' – '+formatDate(data.range.to)+' · '+data.range.days+' days · UTC';
  A.leaderTitle.textContent='Agent statistics';
  A.leaderCaption.textContent='Compact color-coded totals per employee for the selected period.';
  A.updated.textContent='Last updated '+new Date(data.generatedAt).toLocaleString()+
    ' · Reporting days in UTC · '+data.range.days+' days included';
  drawStats(data);renderMetricButtons();drawChart(data);drawDonut(data);createLeaderboard(data);
}
A.filters.addEventListener('submit',event=>{event.preventDefault();applyFilters();});
A.presets.forEach(button=>button.addEventListener('click',()=>{
  state.range=button.dataset.range;
  renderPresetControls();
  if(state.range!=='custom')applyFilters();
}));
A.clear.addEventListener('click',()=>{
  state.range='7';state.department='all';state.outcome='all';state.decision='all';
  state.agentId='';state.reviewerId='';
  state.metric='total';state.sort='total';state.descending=true;
  A.employee.value='';A.department.value='all';A.outcome.value='all';A.teamSearch.value='';
  state.selectedDay=null;defaultCustomRange();renderPresetControls();applyFilters();
});
A.refresh.addEventListener('click',()=>void load());
A.teamSearch.addEventListener('input',()=>{if(state.data)createLeaderboard(state.data);});
A.lineView.addEventListener('click',()=>{
  state.view='line';
  A.lineView.classList.add('active');A.barView.classList.remove('active');
  A.lineView.setAttribute('aria-pressed','true');A.barView.setAttribute('aria-pressed','false');
  if(state.data)drawChart(state.data);
});
A.barView.addEventListener('click',()=>{
  state.view='bar';
  A.barView.classList.add('active');A.lineView.classList.remove('active');
  A.lineView.setAttribute('aria-pressed','false');A.barView.setAttribute('aria-pressed','true');
  if(state.data)drawChart(state.data);
});
window.addEventListener('cricket-theme-updated',()=>{
  if(state.data){drawChart(state.data);drawDonut(state.data);}
});
window.setInterval(()=>{if(!document.hidden&&!state.loading)void load();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!state.loading)void load();});
(async()=>{
  defaultCustomRange();
  renderPresetControls();
  try{
    const {user}=await api('/api/auth/me');
    if(!user||!['agent','qc','admin'].includes(user.role)){
      location.replace('login.html?next=analytics.html');return;
    }
    state.role=user.role;
    A.account.textContent=(user.displayName||user.email)+' · '+user.role.toUpperCase();
    changeMode();
  }catch(error){A.error.textContent=error.message;setStatus('Connection unavailable');}
})();
