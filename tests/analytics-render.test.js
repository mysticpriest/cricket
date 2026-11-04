'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

class FakeNode {
  constructor(tag='div'){
    this.tag=tag;this.children=[];this.attrs={};this.listeners={};
    this.dataset={};this.value='';this.hidden=false;this.disabled=false;
    this._text='';
    this.className='';
    this.style={setProperty:(key,value)=>{this.style[key]=value;}};
    const classes=new Set();
    this.classList={
      add:name=>classes.add(name),
      remove:name=>classes.delete(name),
      toggle:(name,force)=>{
        const active=force===undefined?!classes.has(name):!!force;
        if(active)classes.add(name);else classes.delete(name);
        return active;
      },
      contains:name=>classes.has(name)
    };
  }
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
  append(...children){for(const child of children){if(child!==null&&child!==undefined)this.children.push(child);} }
  prepend(...children){this.children.unshift(...children);}
  replaceChildren(...children){this.children=[];this._text='';this.append(...children);}
  setAttribute(name,value){this.attrs[name]=String(value);}
  addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
  getBoundingClientRect(){return {width:800,height:320};}
  trigger(type){for(const fn of this.listeners[type]||[])fn({preventDefault(){},key:'Enter'});}
}
function descend(node){
  return [node,...node.children.flatMap(child=>child instanceof FakeNode?descend(child):[])];
}
const dates=['2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02','2026-11-03','2026-11-04'];
const alice=dates.map((date,i)=>({date,total:i===6?2:i===5?1:0,inbound:i===6?2:i===5?1:0,outbound:0}));
const bob=dates.map((date,i)=>({date,total:i===6?2:0,inbound:i===6?1:0,outbound:i===6?1:0}));
const analytics={
  kind:'agents',generatedAt:'2026-11-04T12:00:00.000Z',
  range:{key:'7',from:dates[0],to:dates.at(-1),days:7,timezone:'UTC'},
  options:{agents:[
    {id:1,name:'Agent One',color:'violet'},
    {id:2,name:'Agent Two',color:'emerald'}]},
  totals:{total:5,inbound:4,outbound:1,other:0},
  daily:dates.map((date,i)=>({date,total:alice[i].total+bob[i].total,
    inbound:alice[i].inbound+bob[i].inbound,outbound:alice[i].outbound+bob[i].outbound})),
  byAgent:[
    {id:1,name:'Agent One',color:'violet',total:3,inbound:3,outbound:0},
    {id:2,name:'Agent Two',color:'emerald',total:2,inbound:1,outbound:1}],
  agentSeries:[
    {id:1,name:'Agent One',color:'violet',daily:alice},
    {id:2,name:'Agent Two',color:'emerald',daily:bob}]
};

test('agent analytics renders compact 3-cube rows and a separate colored line per agent',async()=>{
  const elements={};
  const rangeButtons=['7','30','90','custom'].map(range=>{
    const button=new FakeNode('button');button.dataset.range=range;return button;
  });
  const document={
    hidden:false,documentElement:{dataset:{cricketTheme:'legacy'}},
    querySelector:selector=>(elements[selector]??=new FakeNode('div')),
    querySelectorAll:selector=>selector==='[data-range]'?rangeButtons:[],
    createElement:tag=>new FakeNode(tag),
    createElementNS:(ns,tag)=>new FakeNode(tag),
    createTextNode:text=>{const n=new FakeNode('#text');n.textContent=text;return n;},
    addEventListener(){}
  };
  const responses=[];
  const fetch=async url=>{
    responses.push(String(url));
    const body=url==='/api/auth/me'
      ?{user:{role:'agent',email:'agent@example.test',displayName:'Test Agent'}}
      :analytics;
    return {ok:true,status:200,json:async()=>body};
  };
  const window={setInterval(){return 0;},addEventListener(){}};
  const source=fs.readFileSync(path.join(__dirname,'..','analytics.js'),'utf8');
  vm.runInNewContext(source,{
    document,window,fetch,location:{replace(){}},URLSearchParams,
    getComputedStyle:()=>({getPropertyValue:()=>'#2563eb'})
  },{filename:'analytics.js'});
  await new Promise(resolve=>setImmediate(resolve));
  const graph=elements['#analyticsTrendSvg'];
  const rows=elements['#analyticsAgentCubes'];
  const legend=elements['#analyticsSeriesLegend'];
  assert.ok(responses.some(url=>url.startsWith('/api/analytics/agents?')));
  assert.equal(rows.children.length,2);
  for(const row of rows.children){
    const cubes=descend(row).filter(node=>node.className==='an-agent-stat-cube');
    assert.equal(cubes.length,3);
    assert.deepEqual(cubes.map(c=>c.children.at(-1).textContent),['Total','Inbound','Outbound']);
  }
  const lines=descend(graph).filter(node=>node.attrs.class==='an-agent-chart-line');
  assert.equal(lines.length,2);
  assert.deepEqual(lines.map(line=>line.attrs.stroke),['#7137b6','#147a58']);
  assert.ok(lines.every(line=>line.attrs.d.includes('L')));
  assert.equal(legend.children.length,2);
  assert.equal(descend(elements['#analyticsMetrics']).filter(x=>x.tag==='button').length,3);
  assert.equal(descend(elements['#analyticsStats']).filter(x=>x.className==='an-stat-card').length,3);

  // The legend hides just the clicked agent, leaving the other line intact.
  legend.children[0].trigger('click');
  const oneLine=descend(graph).filter(node=>node.attrs.class==='an-agent-chart-line');
  assert.equal(oneLine.length,1);
  assert.equal(oneLine[0].attrs.stroke,'#147a58');

  // Name searching filters both the cubes and the graph lines consistently.
  const search=elements['#analyticsTeamSearch'];
  search.value='Agent One';
  search.trigger('input');
  assert.equal(rows.children.length,1);
  assert.equal(legend.children.length,1);
  assert.equal(descend(graph).filter(node=>node.attrs.class==='an-agent-chart-line').length,0);

  // Re-enable the first agent and select Inbound; the violet line is restored.
  legend.children[0].trigger('click');
  assert.equal(descend(graph).filter(node=>node.attrs.class==='an-agent-chart-line').length,1);
  const inboundButton=elements['#analyticsMetrics'].children.find(b=>b.textContent==='Inbound');
  assert.ok(inboundButton);
  inboundButton.trigger('click');
  assert.equal(descend(graph).filter(node=>node.attrs.class==='an-agent-chart-line')[0].attrs.stroke,'#7137b6');
});