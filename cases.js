'use strict';
const els = {
  tbody:document.querySelector('#caseRows'), message:document.querySelector('#caseMessage'),
  search:document.querySelector('#searchInput'), form:document.querySelector('#searchForm'),
  count:document.querySelector('#caseCount'), selected:document.querySelector('#selectedId'),
  next:document.querySelector('#nextPage'), previous:document.querySelector('#previousPage'),
  page:document.querySelector('#pageInfo'), details:document.querySelector('#detailPanel'),
  title:document.querySelector('#detailTitle'),meta:document.querySelector('#detailMeta'),
  note:document.querySelector('#detailNote'),events:document.querySelector('#detailEvents')
};
const state={offset:0,limit:20,total:0,selected:null};
async function api(url) {
  const response=await fetch(url,{credentials:'same-origin'});
  const data=await response.json();
  if(response.status===401) {location.replace('login.html?next=cases.html');throw Error('Sign in required');}
  if(!response.ok) throw Error(data.error||'Request failed');
  return data;
}
function td(row,value,className=''){const cell=document.createElement('td');cell.textContent=String(value??'');cell.className=className;row.append(cell);return cell;}
function dateLabel(date){const d=new Date(date);return Number.isNaN(d.getTime())?'—':d.toLocaleString();}
async function load(){
  const params=new URLSearchParams({search:els.search.value.trim(),offset:String(state.offset),limit:String(state.limit)});
  els.message.textContent='Loading cases…';
  try{
    const data=await api('/api/cases?'+params);
    state.total=data.total;
    els.count.textContent=String(data.total);
    els.tbody.replaceChildren();
    if(!data.cases.length){const row=document.createElement('tr');td(row,'No cases found').colSpan=5;els.tbody.append(row);}
    for(const item of data.cases){
      const row=document.createElement('tr');
      const first=td(row,'');
      const link=document.createElement('button');
      link.type='button';link.textContent=item.caseId;link.addEventListener('click',()=>openCase(item.caseId));
      first.append(link);
      td(row,item.inquiry);td(row,item.outcome);td(row,item.reviewStatus.replaceAll('_',' '));td(row,dateLabel(item.createdAt));
      els.tbody.append(row);
    }
    els.message.textContent=data.total?'Select any Case ID to inspect the original note.':'No cases match this search.';
    els.page.textContent=data.total?String(state.offset+1)+'–'+String(state.offset+data.cases.length)+' of '+String(data.total):'0 cases';
    els.previous.disabled=state.offset===0;
    els.next.disabled=state.offset+data.cases.length>=data.total;
  }catch(error){els.message.textContent=error.message;}
}
async function openCase(caseId){
  els.details.hidden=false;
  els.title.textContent='Loading '+caseId+'…';
  try{
    const data=await api('/api/cases/'+encodeURIComponent(caseId));
    const item=data.case;
    state.selected=caseId;
    els.selected.textContent=caseId;
    els.title.textContent=caseId;
    els.meta.textContent=item.department+' · '+item.inquiry+' · '+item.outcome+' · '+dateLabel(item.createdAt)+' · QC: '+item.reviewStatus.replaceAll('_',' ');
    els.note.textContent=item.note;
    els.events.replaceChildren();
    if(!item.events.length)els.events.textContent='No additional workflow outcomes recorded.';
    else {const list=document.createElement('ol');for(const text of item.events){const li=document.createElement('li');li.textContent=text;list.append(li);}els.events.append(list);}
    els.details.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){els.details.hidden=true;els.message.textContent=error.message;}
}
document.querySelector('#copyCaseId').addEventListener('click',async()=>{
 if(!state.selected)return;
 try{await navigator.clipboard.writeText(state.selected);document.querySelector('#copyCaseId').textContent='Copied!';}
 catch(_){document.querySelector('#copyCaseId').textContent='Select Case ID above to copy';}
});
els.form.addEventListener('submit',e=>{e.preventDefault();state.offset=0;load();});
els.previous.addEventListener('click',()=>{if(state.offset>=state.limit){state.offset-=state.limit;load();}});
els.next.addEventListener('click',()=>{if(state.offset+state.limit<state.total){state.offset+=state.limit;load();}});
(async()=>{
 try{
  const {user}=await api('/api/auth/me');
  if(!user){location.replace('login.html?next=cases.html');return;}
  if(!['agent','admin'].includes(user.role)){location.replace('index.html');return;}
  if(user.role==='admin'){
   document.querySelector('#caseHeading').textContent='All documented cases.';
   document.querySelector('#caseScope').textContent='ADMINISTRATOR VIEW';
  }else document.querySelector('#caseScope').textContent='AGENT VIEW';
  await load();
  const requested=new URLSearchParams(location.search).get('case');
  if(requested&&/^CR-\d{8}-\d{6,}$/.test(requested))await openCase(requested);
 }catch(error){els.message.textContent=error.message;}
})();