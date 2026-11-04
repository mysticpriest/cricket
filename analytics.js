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
  error:document.querySelector('#analyticsFilterError'),
  scopeLabel:document.querySelector('#analyticsScopeLabel'),
  scopeTitle:document.querySelector('#analyticsScopeTitle'),
  scopeCaption:document.querySelector('#analyticsScopeCaption'),
  stats:document.querySelector('#analyticsStats'),
  chartTitle:document.querySelector('#analyticsChartTitle'),
  chartSubtitle:document.querySelector('#analyticsChartSubtitle'),
  metrics:document.querySelector('#analyticsMetrics'),
  seriesLegend:document.querySelector('#analyticsSeriesLegend'),
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
  role:null,range:'7',from:'',to:'',agentId:'',
  department:'all',metric:'total',selectedDay:null,
  hiddenAgents:new Set(),data:null,request:0,loading:false
};
const NS='http://www.w3.org/2000/svg';
const PALETTE={total:'#2563eb',inbound:'#3944a8',outbound:'#7137b6',other:'#94a3b8'};

const AGENT_COLORS={
  ocean:'#0759a6',violet:'#7137b6',emerald:'#147a58',rose:'#b91b65',
  amber:'#976213',teal:'#08777a',indigo:'#3944a8',coral:'#b74630'
};
const AGENT_METRICS=[['total','Total'],['inbound','Inbound'],['outbound','Outbound']];
const CUBE_METRICS=[
  ['total','Total','#0759a6','#e9f3ff'],
  ['inbound','Inbound','#3944a8','#edf0ff'],
  ['outbound','Outbound','#7137b6','#f5edff']
];
const STAT_INFO=[
  ['total','Documented calls','All saved case records','▤'],
  ['inbound','Inbound cases','Recorded Inbound documentation','↙'],
  ['outbound','Outbound cases','Recorded Outbound documentation','↗']
];
function agentColor(color){return AGENT_COLORS[color]||AGENT_COLORS.ocean;}
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
  if(response.status===401){
    location.replace('login.html?next=analytics.html');
    throw Error('Session expired. Sign in again.');
  }
  if(response.status===403)throw Error('Your account is not permitted to view these analytics.');
  if(!response.ok)throw Error(data.error||'Could not load analytics.');
  return data;
}
function utcDate(date){return new Date(date).toISOString().slice(0,10);}
function formatDate(date){
  return new Date(date+'T00:00:00Z')
    .toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
}
function formatLongDate(date){
  return new Date(date+'T00:00:00Z')
    .toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}
function number(value){return Number(value||0).toLocaleString();}
function chartPaletteColor(key){
  if(key==='inbound'&&document.documentElement.dataset.cricketTheme==='personal'){
    const value=getComputedStyle(document.documentElement).getPropertyValue('--cricket-accent').trim();
    if(/^#[0-9a-f]{6}$/i.test(value))return value;
  }
  return PALETTE[key]||PALETTE.total;
}
function activeLabel(){return AGENT_METRICS.find(x=>x[0]===state.metric)?.[1]||'Total';}
function setStatus(text,busy=false){
  A.status.replaceChildren(elt('span','an-online-dot'),document.createTextNode(' '+text));
  A.status.setAttribute('aria-busy',String(busy));
}
function defaultCustomRange(){
  const today=new Date();
  A.from.value=utcDate(new Date(today.getTime()-6*86400000));
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
  const option=elt('option','',empty);option.value='';
  select.append(option);
  for(const item of items){
    const child=elt('option','',item.name);
    child.value=String(item.id);select.append(child);
  }
  select.value=String(selected||'');
}
function startAnalytics(){
  state.metric='total';
  state.selectedDay=null;
  A.employee.value=state.agentId;
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
  state.agentId=A.employee.value;
  state.department=A.department.value;
  state.selectedDay=null;
  state.hiddenAgents.clear();
  A.error.textContent='';
  void load();
}
function query(){
  const params=new URLSearchParams({range:state.range});
  if(state.range==='custom'){
    params.set('from',state.from);
    params.set('to',state.to);
  }
  if(state.agentId)params.set('agentId',state.agentId);
  params.set('department',state.department);
  return '/api/analytics/agents?'+params.toString();
}
async function load(){
  const serial=++state.request;
  setStatus('Updating figures…',true);
  state.loading=true;A.refresh.disabled=true;
  try{
    const data=await api(query());
    if(serial!==state.request)return;
    state.data=data;A.error.textContent='';
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
    if(serial===state.request){
      state.loading=false;
      A.refresh.disabled=false;
    }
  }
}
function drawStats(data){
  A.stats.replaceChildren();
  for(const [key,label,description,icon] of STAT_INFO){
    const card=elt('article','an-stat-card');
    const header=elt('div','an-stat-head');
    header.append(elt('span','an-stat-title',label),elt('span','an-stat-icon',icon));
    card.append(header,elt('div','an-stat-value',number(data.totals[key])),
      elt('div','an-stat-helper',description));
    A.stats.append(card);
  }
}
function renderMetricButtons(){
  A.metrics.replaceChildren();
  for(const [value,label] of AGENT_METRICS){
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
function agentSeries(data){
  return Array.isArray(data.agentSeries)?data.agentSeries:[];
}
function visibleSeries(data){
  const needle=A.teamSearch.value.trim().toLocaleLowerCase();
  return agentSeries(data).filter(agent=>!state.hiddenAgents.has(agent.id)
    && agent.name.toLocaleLowerCase().includes(needle));
}
function renderAgentLegend(data){
  A.seriesLegend.replaceChildren();
  const needle=A.teamSearch.value.trim().toLocaleLowerCase();
  const matching=agentSeries(data).filter(agent=>agent.name.toLocaleLowerCase().includes(needle));
  if(!matching.length){
    A.seriesLegend.append(elt('span','an-series-empty','No agents match this selection.'));
    return;
  }
  const byColor=new Map();
  for(const agent of matching){
    const color=agentColor(agent.color);
    const repeat=byColor.get(color)||0;
    byColor.set(color,repeat+1);
    const button=elt('button','an-series-item',agent.name);
    button.type='button';
    button.classList.toggle('muted',state.hiddenAgents.has(agent.id));
    button.setAttribute('aria-pressed',String(!state.hiddenAgents.has(agent.id)));
    button.title='Show or hide '+agent.name+' on the graph';
    const swatch=elt('span','an-series-swatch');
    swatch.style.background=color;
    if(repeat)swatch.classList.add('striped');
    button.prepend(swatch);
    button.addEventListener('click',()=>{
      if(state.hiddenAgents.has(agent.id))state.hiddenAgents.delete(agent.id);
      else state.hiddenAgents.add(agent.id);
      renderAgentLegend(data);
      drawChart(data);
    });
    A.seriesLegend.append(button);
  }
}
function tooltipForDay(data,day,index){
  A.tooltip.replaceChildren(elt('strong','',formatLongDate(day.date)));
  const series=visibleSeries(data);
  for(const agent of series.slice(0,10)){
    const row=elt('div','an-series-tooltip-row');
    const dot=elt('span','an-series-tooltip-dot');
    dot.style.background=agentColor(agent.color);
    row.append(dot,elt('span','',agent.name),
      elt('b','',number(agent.daily[index]?.[state.metric])));
    A.tooltip.append(row);
  }
  if(series.length>10)A.tooltip.append(elt('small','',series.length-10+' more agents'));
  if(!series.length)A.tooltip.append(elt('span','', 'Select an agent from the legend.'));
  A.tooltip.hidden=false;
  const rect=A.chart.getBoundingClientRect();
  const pointX=47+(data.daily.length===1?428:index*856/(data.daily.length-1));
  A.tooltip.style.left=Math.min(Math.max(5,pointX/920*rect.width),Math.max(5,rect.width-195))+'px';
  A.tooltip.style.top='15px';
}
function detailFor(data,day,index){
  state.selectedDay=day.date;
  A.dayDetail.replaceChildren(elt('strong','',formatLongDate(day.date)+' · '+activeLabel()));
  const visible=visibleSeries(data);
  if(!visible.length){
    A.dayDetail.append(elt('span','', ' · No agents selected.'));
    return;
  }
  const results=elt('div','an-day-agent-values');
  for(const agent of visible){
    const item=elt('span','an-day-agent');
    const dot=elt('i');
    dot.style.background=agentColor(agent.color);
    item.append(dot,document.createTextNode(agent.name+': '+number(agent.daily[index]?.[state.metric])));
    results.append(item);
  }
  A.dayDetail.append(results);
}
function drawChart(data){
  const days=data.daily;
  const series=visibleSeries(data);
  A.chart.replaceChildren();
  A.tooltip.hidden=true;
  A.chart.setAttribute('aria-label',activeLabel()+' documented calls per agent from '+
    data.range.from+' through '+data.range.to);
  if(!days.length)return;
  const width=920,height=330,left=47,right=17,top=24,bottom=42;
  const plotW=width-left-right,plotH=height-top-bottom;
  const high=Math.max(1,...series.flatMap(agent=>agent.daily.map(day=>Number(day[state.metric])||0)));
  const yMax=Math.max(1,Math.ceil(high/4)*4);
  const x=i=>days.length===1?left+plotW/2:left+i*plotW/(days.length-1);
  const y=value=>top+plotH-plotH*value/yMax;
  for(let index=0;index<=4;index++){
    const quantity=Math.round(yMax*index/4),yy=y(quantity);
    A.chart.append(svg('line',{x1:left,y1:yy,x2:width-right,y2:yy,class:'an-chart-grid'}));
    A.chart.append(svg('text',{x:left-11,y:yy+4,'text-anchor':'end',class:'an-chart-label'},number(quantity)));
  }
  const dateStep=Math.max(1,Math.ceil(days.length/(days.length<=7?7:days.length<=30?8:10)));
  days.forEach((day,i)=>{
    if(i%dateStep===0||i===days.length-1){
      A.chart.append(svg('text',{x:x(i),y:height-15,'text-anchor':'middle',class:'an-chart-label'},formatDate(day.date)));
    }
  });
  // Use the saved color for each agent, not the viewing employee's theme color.
  // A different dash pattern distinguishes accounts that happen to share a color.
  const repeatsByColor=new Map();
  for(const [index,agent] of series.entries()){
    const color=agentColor(agent.color);
    const repeated=repeatsByColor.get(color)||0;
    repeatsByColor.set(color,repeated+1);
    const values=agent.daily.map(day=>Number(day[state.metric])||0);
    const points=values.map((value,i)=>(i?'L':'M')+
      x(i).toFixed(2)+','+y(value).toFixed(2)).join(' ');
    const group=svg('g',{class:'an-agent-line-group'});
    group.style.animationDelay=Math.min(index*50,450)+'ms';
    const line=svg('path',{d:points,class:'an-agent-chart-line',
      stroke:color,'stroke-width':'3.1','stroke-linejoin':'round',
      'stroke-linecap':'round',fill:'none',
      'aria-label':agent.name+' activity trend'});
    if(repeated>0)line.setAttribute('stroke-dasharray',repeated%2===1?'9 5':'3 4');
    line.append(svg('title',{},agent.name+' · '+activeLabel()));
    group.append(line);
    if(days.length<=14){
      values.forEach((value,i)=>{
        group.append(svg('circle',{cx:x(i),cy:y(value),r:3.8,fill:'#fff',
          stroke:color,'stroke-width':2.2,class:'an-agent-chart-dot'}));
      });
    }
    A.chart.append(group);
  }
  const hitWidth=days.length===1?90:Math.min(72,plotW/(days.length-1));
  days.forEach((day,i)=>{
    const hit=svg('rect',{x:x(i)-hitWidth/2,y:top,width:hitWidth,height:plotH,
      class:'an-chart-hit',role:'button',tabindex:'0',
      'aria-label':formatLongDate(day.date)+': inspect agent statistics'});
    hit.append(svg('title',{},formatLongDate(day.date)));
    hit.addEventListener('pointerenter',()=>tooltipForDay(data,day,i));
    hit.addEventListener('pointerleave',()=>{A.tooltip.hidden=true;});
    hit.addEventListener('focus',()=>tooltipForDay(data,day,i));
    hit.addEventListener('blur',()=>{A.tooltip.hidden=true;});
    hit.addEventListener('click',()=>detailFor(data,day,i));
    hit.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();detailFor(data,day,i);}
    });
    A.chart.append(hit);
  });
  const selectedIndex=days.findIndex(day=>day.date===state.selectedDay);
  if(selectedIndex>=0)detailFor(data,days[selectedIndex],selectedIndex);
  else A.dayDetail.textContent='Select a day in the graph to compare individual agents.';
}
function drawDonut(data){
  const types=[
    ['inbound','Inbound',data.totals.inbound],
    ['outbound','Outbound',data.totals.outbound],
    ['other','Other / legacy',data.totals.other]
  ];
  A.donut.replaceChildren();A.legend.replaceChildren();
  const total=data.totals.total;
  const R=83,C=2*Math.PI*R;
  A.donut.append(svg('circle',{cx:120,cy:120,r:R,fill:'none',
    stroke:'#eef2f7','stroke-width':25}));
  let offset=0;
  for(const [key,label,value] of types){
    const fraction=total?value/total:0,length=fraction*C;
    if(length){
      A.donut.append(svg('circle',{cx:120,cy:120,r:R,
        class:'an-donut-ring an-donut-segment',
        stroke:chartPaletteColor(key),'stroke-dasharray':length+' '+(C-length),
        'stroke-dashoffset':-offset,'aria-label':label+': '+number(value)}));
    }
    offset+=length;
    const button=elt('button','an-legend-row');
    button.type='button';button.title='Filter by '+label;
    const dot=elt('span','an-legend-bullet');
    dot.style.background=chartPaletteColor(key);
    button.append(dot,elt('span','an-legend-name',label),
      elt('span','an-legend-number',number(value)+' · '+
        (total?Math.round(value/total*100):0)+'%'));
    button.addEventListener('click',()=>{
      A.department.value=key;
      applyFilters();
    });
    A.legend.append(button);
  }
  A.donut.append(svg('text',{x:120,y:117,class:'an-donut-center-number'},number(total)));
  A.donut.append(svg('text',{x:120,y:141,class:'an-donut-center-label'},'CASES'));
  A.breakdownTitle.textContent='Call type breakdown';
  A.breakdownCaption.textContent='Click a category to filter the entire report.';
  A.breakdownNote.textContent='Outbound totals reflect saved Outbound records only; the full Outbound workflow is not yet implemented.';
}

function createLeaderboard(data){
  const container=A.cubeRows;
  container.replaceChildren();
  const needle=A.teamSearch.value.trim().toLocaleLowerCase();
  const matching=data.byAgent.filter(agent=>agent.name.toLocaleLowerCase().includes(needle));
  if(!matching.length){
    container.append(elt('p','an-agent-cube-empty',needle?'No agents match that name.':'No agents match the selected filters.'));
    return;
  }
  for(const agent of matching){
    const row=elt('div','an-agent-cube-row');
    const identity=elt('div','an-agent-cube-name');
    const dot=elt('i','an-agent-name-dot');
    dot.style.background=agentColor(agent.color);
    identity.append(dot,elt('strong','',agent.name));

    const cubes=elt('div','an-agent-cubes');
    for(const [key,label,ink,background] of CUBE_METRICS){
      const cube=elt('div','an-agent-stat-cube');
      cube.setAttribute('aria-label',agent.name+' · '+label+': '+number(agent[key]));
      cube.style.setProperty('--cube-ink',ink);
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
  A.scopeCaption.textContent='Compare agent call documentation across the selected period.';
  A.chartTitle.textContent='Calls by agent';
  A.chartSubtitle.textContent=formatDate(data.range.from)+' – '+formatDate(data.range.to)+' · '+data.range.days+' days · UTC';
  A.leaderTitle.textContent='Statistics by agent';
  A.leaderCaption.textContent='Total, Inbound and Outbound for each agent in this reporting period.';
  A.updated.textContent='Last updated '+new Date(data.generatedAt).toLocaleString()+
    ' · Reporting days in UTC · '+data.range.days+' days included';
  drawStats(data);renderMetricButtons();renderAgentLegend(data);
  drawChart(data);drawDonut(data);createLeaderboard(data);
}
A.filters.addEventListener('submit',event=>{event.preventDefault();applyFilters();});
A.presets.forEach(button=>button.addEventListener('click',()=>{
  state.range=button.dataset.range;
  renderPresetControls();
  if(state.range!=='custom')applyFilters();
}));
A.clear.addEventListener('click',()=>{
  state.range='7';state.department='all';state.agentId='';
  state.metric='total';state.hiddenAgents.clear();
  A.employee.value='';A.department.value='all';A.teamSearch.value='';
  state.selectedDay=null;defaultCustomRange();renderPresetControls();applyFilters();
});
A.refresh.addEventListener('click',()=>void load());
A.teamSearch.addEventListener('input',()=>{
  if(state.data){
    createLeaderboard(state.data);
    renderAgentLegend(state.data);
    drawChart(state.data);
  }
});
window.addEventListener('cricket-theme-updated',()=>{
  if(state.data)drawDonut(state.data);
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
    startAnalytics();
  }catch(error){A.error.textContent=error.message;setStatus('Connection unavailable');}
})();
