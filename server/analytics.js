'use strict';
// Analytics for fictional Cricket demo records. All returned data is aggregate;
// caller numbers, case notes and protected QC figures are never in agent reports.
const MS_DAY = 86_400_000;
const AGENT_DEPARTMENTS = new Set(['all','inbound','outbound','other']);
const OUTCOMES = new Set(['all','resolved','pending']);
const QC_DECISIONS = new Set(['all','approved','coaching','flagged']);
const CHANNEL_SQL = `CASE
  WHEN lower(trim(c.department)) LIKE 'outbound%' THEN 'outbound'
  WHEN lower(trim(c.department)) LIKE 'inbound%'
    OR lower(trim(c.department)) IN ('appointment inquiry','clinic information','scheduling inquiry')
    THEN 'inbound'
  ELSE 'other' END`;

function fail(message){const error=new Error(message);error.status=400;throw error;}
function validDate(s){
  if (typeof s!=='string'|| !/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const d=new Date(s+'T00:00:00.000Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
}
function parseRange(params,current=new Date()){
  const range=params.get('range')||'7';
  if(!['7','30','90','custom'].includes(range))fail('Choose 7, 30, 90 or a custom date range');
  const currentDay=Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),current.getUTCDate());
  let fromDay,toDay;
  if(range==='custom'){
    const from=params.get('from'),to=params.get('to');
    if(!validDate(from)||!validDate(to))fail('Enter valid start and end dates (YYYY-MM-DD)');
    fromDay=Date.parse(from+'T00:00:00.000Z');
    toDay=Date.parse(to+'T00:00:00.000Z');
    if(toDay<fromDay||toDay-fromDay>365*MS_DAY)fail('Custom range must be 1–366 days, in chronological order');
  }else{
    const days=Number(range);
    fromDay=currentDay-(days-1)*MS_DAY;
    toDay=currentDay;
  }
  const dayCount=Math.round((toDay-fromDay)/MS_DAY)+1;
  const first=new Date(fromDay).toISOString().slice(0,10);
  const last=new Date(toDay).toISOString().slice(0,10);
  const next=new Date(toDay+MS_DAY).toISOString().slice(0,10);
  return {
    key:range,from:first,to:last,days:dayCount,
    start:first+'T00:00:00.000Z',
    endExclusive:next+'T00:00:00.000Z',
    labels:Array.from({length:dayCount},(_,i)=>new Date(fromDay+i*MS_DAY).toISOString().slice(0,10))
  };
}
function parseId(params,key){
  const input=params.get(key);
  if(!input)return null;
  if(!/^[1-9]\d{0,14}$/.test(input)||!Number.isSafeInteger(Number(input)))fail('Invalid employee filter');
  return Number(input);
}
function choose(params,key,set){
  const value=params.get(key)||'all';
  if(!set.has(value))fail('Invalid '+key+' filter');
  return value;
}
function employeeOptions(db,roles,officeId){
  const placeholders=roles.map(()=>'?').join(',');
  return db.prepare(`SELECT id,display_name AS displayName,email,theme_color AS themeColor FROM users WHERE role IN (${placeholders}) AND office_id=? ORDER BY display_name COLLATE NOCASE,email`).all(...roles,officeId)
    .map(row=>({id:row.id,name:row.displayName||'Employee #'+row.id,color:row.themeColor||'ocean'}));
}
function baseSeries(range,fields){
  return range.labels.map(date=>({date,...fields}));
}
function analyticsAgents(db,params,officeId){
  const range=parseRange(params);
  const agentId=parseId(params,'agentId');
  const department=choose(params,'department',AGENT_DEPARTMENTS);
  const outcome=choose(params,'outcome',OUTCOMES);
  const agents=employeeOptions(db,['agent'],officeId);
  if(agentId&&!agents.some(a=>a.id===agentId))fail('Selected agent does not exist');
  const filters=['u.role=\'agent\'','c.office_id=?','u.office_id=?','c.deleted_at IS NULL','c.created_at>=?','c.created_at<?'];
  const values=[officeId,officeId,range.start,range.endExclusive];
  if(agentId){filters.push('u.id=?');values.push(agentId);}
  if(department!=='all'){filters.push(CHANNEL_SQL+'=?');values.push(department);}
  if(outcome!=='all'){filters.push('c.outcome=?');values.push(outcome);}
  const records=db.prepare(`SELECT substr(c.created_at,1,10) AS day,u.id AS employeeId,
    ${CHANNEL_SQL} AS channel,c.outcome,COUNT(*) AS total
    FROM cases c JOIN users u ON u.id=c.agent_id
    WHERE ${filters.join(' AND ')}
    GROUP BY day,employeeId,channel,c.outcome ORDER BY day`).all(...values);
  const zero={total:0,inbound:0,outbound:0,other:0,resolved:0,pending:0};
  const daily=baseSeries(range,zero);
  const byDate=new Map(daily.map(item=>[item.date,item]));
  const byAgent=new Map(agents.filter(a=>agentId===null||a.id===agentId)
    .map(a=>[a.id,{id:a.id,name:a.name,color:a.color,...zero}]));
  // Per-agent UTC daily series use the same filtered records as the summary and cubes.
  // A complete date range, including zero-call days, makes agent line charts consistent.
  const agentDays=new Map([...byAgent.keys()].map(id=>[
    id,new Map(range.labels.map(date=>[date,{date,total:0,inbound:0,outbound:0}]))
  ]));
  const totals={...zero};
  const apply=(target,row)=>{
    target.total+=row.total;
    target[row.channel]+=row.total;
    target[row.outcome]+=row.total;
  };
  for(const row of records){
    apply(totals,row);
    const day=byDate.get(row.day);
    const agent=byAgent.get(row.employeeId);
    if(day)apply(day,row);
    if(agent)apply(agent,row);
    const dailyAgent=agentDays.get(row.employeeId)?.get(row.day);
    if(dailyAgent){
      dailyAgent.total+=row.total;
      if(row.channel==='inbound'||row.channel==='outbound'){
        dailyAgent[row.channel]+=row.total;
      }
    }
  }
  const sorted=Array.from(byAgent.values()).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  const peak=daily.reduce((best,day)=>day.total>best.total?day:best,{date:null,total:0});
  return {
    kind:'agents',
    generatedAt:new Date().toISOString(),
    range:{key:range.key,from:range.from,to:range.to,days:range.days,timezone:'UTC'},
    filters:{agentId,department,outcome},
    options:{agents,departments:['all','inbound','outbound','other'],outcomes:['all','resolved','pending']},
    totals:{...totals,activeAgents:sorted.filter(a=>a.total>0).length,
      averagePerDay:Math.round(totals.total/range.days*10)/10,peakDay:peak.total?peak.date:null},
    daily,byAgent:sorted,
    agentSeries:sorted.map(agent=>({
      id:agent.id,name:agent.name,color:agent.color,
      daily:[...agentDays.get(agent.id).values()]
    })),
    notes:{outbound:'Outbound route handling is not implemented yet. Outbound totals reflect only saved case records explicitly tagged as Outbound.',deleted:'Soft-deleted cases are excluded from agent analytics.'}
  };
}
function analyticsQc(db,params,officeId){
  const range=parseRange(params);
  const reviewerId=parseId(params,'reviewerId');
  const decision=choose(params,'decision',QC_DECISIONS);
  const reviewers=employeeOptions(db,['qc','admin'],officeId);
  if(reviewerId&&!reviewers.some(r=>r.id===reviewerId))fail('Selected reviewer does not exist');
  const filters=['u.role IN (\'qc\',\'admin\')','c.office_id=?','r.office_id=?','u.office_id=?','c.deleted_at IS NULL','r.created_at>=?','r.created_at<?'];
  const values=[officeId,officeId,officeId,range.start,range.endExclusive];
  if(reviewerId){filters.push('u.id=?');values.push(reviewerId);}
  if(decision!=='all'){filters.push('r.decision=?');values.push(decision);}
  const fromWhere=`FROM reviews r JOIN cases c ON c.id=r.case_id JOIN users u ON u.id=r.reviewer_id
    WHERE ${filters.join(' AND ')}`;
  const records=db.prepare(`SELECT substr(r.created_at,1,10) AS day,r.reviewer_id AS employeeId,
    r.decision,COUNT(*) AS total,SUM(r.score) AS scoreSum
    ${fromWhere} GROUP BY day,employeeId,r.decision ORDER BY day`).all(...values);
  const distinct=db.prepare(`SELECT COUNT(DISTINCT r.case_id) AS n ${fromWhere}`).get(...values).n;
  const byReviewerDistinct=db.prepare(`SELECT r.reviewer_id AS id,COUNT(DISTINCT r.case_id) AS n
    ${fromWhere} GROUP BY r.reviewer_id`).all(...values);
  const distinctMap=new Map(byReviewerDistinct.map(x=>[x.id,x.n]));
  const zero={total:0,approved:0,coaching:0,flagged:0,scoreSum:0};
  const daily=baseSeries(range,zero);
  const byDate=new Map(daily.map(x=>[x.date,x]));
  const byReviewer=new Map(reviewers.filter(x=>reviewerId===null||x.id===reviewerId)
    .map(x=>[x.id,{id:x.id,name:x.name,...zero,uniqueCases:distinctMap.get(x.id)||0}]));
  const totals={...zero};
  for(const row of records){
    for(const target of [totals,byDate.get(row.day),byReviewer.get(row.employeeId)]){
      if(!target)continue;
      target.total+=row.total;
      target[row.decision]+=row.total;
      target.scoreSum+=row.scoreSum;
    }
  }
  const avg=target=>target.total?Math.round(target.scoreSum/target.total):null;
  const format=obj=>{
    const {scoreSum,...rest}=obj;
    return {...rest,averageScore:avg(obj)};
  };
  return {
    kind:'qc',generatedAt:new Date().toISOString(),
    range:{key:range.key,from:range.from,to:range.to,days:range.days,timezone:'UTC'},
    filters:{reviewerId,decision},
    options:{reviewers,decisions:['all','approved','coaching','flagged']},
    totals:{...format(totals),uniqueCases:distinct,
      activeReviewers:Array.from(byReviewer.values()).filter(x=>x.total>0).length},
    daily:daily.map(format),
    byReviewer:Array.from(byReviewer.values()).map(format)
      .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name)),
    notes:{reviews:'QC totals count submitted evaluations, not calls handled or agent documentation.',deleted:'Reviews of soft-deleted cases are excluded from QC analytics.'}
  };
}
module.exports={analyticsAgents,analyticsQc,parseRange};
